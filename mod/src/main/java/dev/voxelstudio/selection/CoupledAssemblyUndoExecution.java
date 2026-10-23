package dev.voxelstudio.selection;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Unwired protected inverse core. A new native lease and explicit consent
 * are still required. Preserve whole changed groups AND their supports;
 * never turn a possible half mutation into an evaluated receipt or retry. */
final class CoupledAssemblyUndoExecution {
    enum State { READY,WAIT_INTENT,APPLYING,WAIT_RECEIPT,WAIT_OUTCOME,WAIT_AMBIGUITY,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    interface Log {
        CoupledAssemblyUndoJournal.Plan plan();
        CompletableFuture<CoupledAssemblyUndoJournal.Intent> intent();
        CompletableFuture<Void> evaluated(CoupledAssemblyUndoJournal.Intent token,List<CoupledAssemblyUndoJournal.Entry> rows,CoupledAssemblyJournal.ReceiptState state);
        CompletableFuture<Void> finish(CoupledAssemblyJournal.Outcome outcome);
        CompletableFuture<Void> ambiguous(CoupledAssemblyUndoJournal.Intent token,String reason);
    }
    static final class Disk implements Log {
        private final CoupledAssemblyUndoJournal.Live live;private final Executor worker;
        Disk(CoupledAssemblyUndoJournal.Live live,Executor worker){this.live=Objects.requireNonNull(live);this.worker=Objects.requireNonNull(worker);}
        public CoupledAssemblyUndoJournal.Plan plan(){return live.plan();}
        private <T> CompletableFuture<T> submit(Callable<T> call){try{return CompletableFuture.supplyAsync(()->{try{return call.call();}catch(Exception e){throw new CompletionException(e);}},worker);}catch(RuntimeException e){return CompletableFuture.failedFuture(e);}}
        public CompletableFuture<CoupledAssemblyUndoJournal.Intent> intent(){return submit(live::intent);}
        public CompletableFuture<Void> evaluated(CoupledAssemblyUndoJournal.Intent token,List<CoupledAssemblyUndoJournal.Entry> rows,CoupledAssemblyJournal.ReceiptState state){var copy=List.copyOf(rows);return submit(()->{live.evaluated(token,copy,state);return null;});}
        public CompletableFuture<Void> finish(CoupledAssemblyJournal.Outcome outcome){return submit(()->{live.finish(outcome);return null;});}
        public CompletableFuture<Void> ambiguous(CoupledAssemblyUndoJournal.Intent token,String reason){return submit(()->{live.ambiguous(token,reason);return null;});}
    }
    record Progress(State state,int evaluatedWrites,int evaluatedGroups,int restored,int preserved,int totalWrites,int steps,int maximumEntriesPerStep,long maximumStepNanos,String reason){boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}}
    private final Log log;private final CoupledAssemblyExecution.Source source;private final LongSupplier clock;private final int maximumEntries;private final long maximumNanos;
    private final SelectionBaseline baseline;private final WorldSelection selection;private final Map<SelectionRegion.Point,String> expected=new HashMap<>();private final Set<SelectionRegion.Point> preservedSupports=new HashSet<>();private final SelectionChunkFence chunks=new SelectionChunkFence();
    private final List<CoupledAssemblyUndoJournal.Entry> evaluated=new ArrayList<>(),batch=new ArrayList<>();
    private State state=State.READY;private String reason="等待原完整组撤销日志";private boolean cancelled;private long revision,pendingStarted,maxStepNanos;private int groups,batchGroups,steps,restored,maxEntriesPerStep;
    private CoupledAssemblyUndoJournal.Intent intent;private CompletableFuture<?> pending;private CoupledAssemblyJournal.ReceiptState receipt;private CoupledAssemblyJournal.Outcome outcome;
    CoupledAssemblyUndoExecution(Log log,CoupledAssemblyExecution.Source source,int maximumEntries,long maximumNanos,LongSupplier clock){
        this.log=Objects.requireNonNull(log);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);if(maximumEntries<2||maximumEntries>128||maximumNanos<1||maximumNanos>2_000_000)throw new IllegalArgumentException("Bounded complete-group inverse budget required");this.maximumEntries=maximumEntries;this.maximumNanos=maximumNanos;
        baseline=log.plan().original().compiled().baseline();selection=log.plan().original().binding().selection();revision=source.frame().contextRevision();if(!frame())throw new IllegalArgumentException("Original world/selection and current creative host required for undo");for(var w:log.plan().writes())expected.put(w.position(),w.before());
    }
    Progress progress(){return new Progress(state,evaluated.size(),groups,restored,evaluated.size()-restored,log.plan().writes().size(),steps,maxEntriesPerStep,maxStepNanos,reason);}
    void cancel(){if(!terminal())cancelled=true;}
    private boolean terminal(){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED).contains(state);}
    private boolean frame(){var f=Objects.requireNonNull(source.frame());var w=selection.world();return f.creativeHost()&&w.worldId().equals(f.worldId())&&w.dimension().equals(f.dimension())&&selection.revision()==f.selectionRevision()&&revision==f.contextRevision();}
    private void waitFor(CompletableFuture<?> future,State next){pending=Objects.requireNonNull(future);pendingStarted=clock.getAsLong();state=next;}
    private void seal(CoupledAssemblyJournal.Outcome next){outcome=next;waitFor(log.finish(next),State.WAIT_OUTCOME);}
    private void receipt(CoupledAssemblyJournal.ReceiptState next){receipt=next;waitFor(log.evaluated(intent,batch,next),State.WAIT_RECEIPT);}
    private void uncertain(String why){reason=why;waitFor(log.ambiguous(intent,why),State.WAIT_AMBIGUITY);}
    private void review(String why){reason=why;state=State.REVIEW_REQUIRED;}
    private void acknowledge(){
        if(pending==null)throw new IllegalStateException("Original inverse disk operation missing");if(!pending.isDone()){if(clock.getAsLong()-pendingStarted>=CoupledAssemblyExecution.WAIT_TIMEOUT_NANOS)review("撤销磁盘回执未知；等待的原操作不重发");return;}
        try{
            if(state==State.WAIT_INTENT){intent=(CoupledAssemblyUndoJournal.Intent)pending.getNow(null);pending=null;batch.clear();batchGroups=0;if(intent==null||!intent.belongs(log.plan())||!intent.packet().equals(log.plan().packet(groups))||intent.packet().offset()!=evaluated.size())throw new IllegalStateException("Original inverse owner/schedule differs");state=State.APPLYING;}
            else{pending.getNow(null);pending=null;if(state==State.WAIT_RECEIPT){intent=null;if(receipt==CoupledAssemblyJournal.ReceiptState.COMPLETE)state=State.READY;else seal(CoupledAssemblyJournal.Outcome.valueOf(receipt.name()));}else if(state==State.WAIT_OUTCOME){state=State.valueOf(outcome.name());reason="完整组撤销日志已封闭；后改保留，物理存盘未验证";}else if(state==State.WAIT_AMBIGUITY)review(reason);else throw new IllegalStateException("Unexpected inverse disk acknowledgement");}
        }catch(Exception e){review("撤销原磁盘回执不能确认，不重放："+e.getMessage());}
    }
    private SelectionScan.BlockFact read(SelectionRegion.Point point){
        if(!frame())throw new IllegalStateException("Inverse epoch/permission changed");var chunk=source.loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));if(chunk==null||!chunks.observe(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16),chunk))throw new IllegalStateException("Inverse chunk unloaded/replaced; no force load");var actual=source.read(point);if(!frame())throw new IllegalStateException("Inverse epoch changed during read");return actual;
    }
    private CoupledAssemblyUndoJournal.Disposition preservation(CoupledAssemblyUndoJournal.Group group){
        // Targets of EVERY member are checked before ANY inverse member.
        for(var row:group.writes()){if(preservedSupports.contains(row.position()))return CoupledAssemblyUndoJournal.Disposition.PRESERVED_DEPENDENCY;var actual=read(row.position());if(actual==null||actual.blockEntity()||!actual.state().equals(row.before()))return CoupledAssemblyUndoJournal.Disposition.PRESERVED_TARGET;}
        for(var row:group.writes())for(int axis=0;axis<3;axis++)for(int sign:new int[]{-1,1}){var p=row.position();int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=sign;var point=new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]);var before=baseline.at(point);var actual=read(point);if(before==null||actual==null||actual.blockEntity()!=before.blockEntity()||!actual.state().equals(expected.getOrDefault(point,before.state())))return CoupledAssemblyUndoJournal.Disposition.PRESERVED_NEIGHBOR;}
        return null;
    }
    Progress step(){
        if(terminal())return progress();long started=clock.getAsLong();steps++;int work=0;
        try{
            source.beginStep();if(Set.of(State.WAIT_INTENT,State.WAIT_RECEIPT,State.WAIT_OUTCOME,State.WAIT_AMBIGUITY).contains(state)){acknowledge();return progress();}
            if(state==State.READY){if(cancelled)seal(CoupledAssemblyJournal.Outcome.CANCELLED);else if(!frame())seal(CoupledAssemblyJournal.Outcome.CONFLICT);else if(evaluated.size()==log.plan().writes().size())seal(CoupledAssemblyJournal.Outcome.COMPLETED);else waitFor(log.intent(),State.WAIT_INTENT);return progress();}
            if(state!=State.APPLYING)throw new IllegalStateException("Unexpected inverse execution state");
            while(batchGroups<intent.packet().groups().size()&&clock.getAsLong()-started<maximumNanos){
                var group=intent.packet().groups().get(batchGroups);var rows=group.writes();int size=rows.size();if(work+size>maximumEntries)break;
                if(cancelled){receipt(CoupledAssemblyJournal.ReceiptState.CANCELLED);break;}if(!frame()){reason="撤销原世界/权限已变化";receipt(CoupledAssemblyJournal.ReceiptState.CONFLICT);break;}
                CoupledAssemblyUndoJournal.Disposition keep;try{keep=preservation(group);}catch(Exception e){reason="撤销原读取冲突："+e.getMessage();receipt(CoupledAssemblyJournal.ReceiptState.CONFLICT);break;}
                if(keep==null){
                    if(!source.verifyGroup(rows,false)||!frame()){reason="原生完整逆向组预检拒绝；整组不写入";receipt(CoupledAssemblyJournal.ReceiptState.CONFLICT);break;}
                    boolean whole=true;int members=0;
                    // No clock/cancel/tick boundary inside the entire pair.
                    for(var row:rows){try{boolean changed=source.set(row);var actual=source.read(row.position());var f=source.frame();var w=selection.world();
                        if(!changed&&members==0&&actual!=null&&!actual.blockEntity()&&actual.state().equals(row.before())&&frame()){reason="逆向组首写明确拒绝";receipt(CoupledAssemblyJournal.ReceiptState.CONFLICT);whole=false;break;}
                        if(!changed||actual==null||actual.blockEntity()||!actual.state().equals(row.after())||!f.creativeHost()||!w.worldId().equals(f.worldId())||!w.dimension().equals(f.dimension())||selection.revision()!=f.selectionRevision()||f.contextRevision()!=revision+1){uncertain("逆向组可能半写；保留整个原 intent，不确认或重试");whole=false;break;}revision=f.contextRevision();members++;
                    }catch(Exception e){uncertain("逆向组成员异常可能已写入："+e.getMessage());whole=false;break;}}
                    if(!whole)break;
                    for(var row:rows){var actual=source.read(row.position());if(actual==null||actual.blockEntity()||!actual.state().equals(row.after())||!frame()){whole=false;break;}}
                    if(!whole||!source.verifyGroup(rows,true)||!frame()){uncertain("完整逆向组最终状态/支撑未知");break;}
                    for(var row:rows)expected.put(row.position(),row.after());restored+=size;keep=CoupledAssemblyUndoJournal.Disposition.RESTORED;
                }else if(group.support()!=null){preservedSupports.add(group.support());}
                for(var row:rows){var entry=new CoupledAssemblyUndoJournal.Entry(row,keep);batch.add(entry);evaluated.add(entry);}groups++;batchGroups++;work+=size;
            }
            if(state==State.APPLYING&&batchGroups==intent.packet().groups().size())receipt(CoupledAssemblyJournal.ReceiptState.COMPLETE);
        }catch(Exception e){if(intent!=null&&state==State.APPLYING){try{uncertain("逆向执行异常："+e.getMessage());}catch(Exception second){review("逆向日志未知："+second.getMessage());}}else review("逆向事务不能继续："+e.getMessage());}
        finally{maxEntriesPerStep=Math.max(maxEntriesPerStep,work);maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
}
