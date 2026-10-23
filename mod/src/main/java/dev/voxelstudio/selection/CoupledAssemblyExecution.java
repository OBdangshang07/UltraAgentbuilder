package dev.voxelstudio.selection;

import java.util.*;
import java.nio.file.Path;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Grouped forward core. No installed-server gateway or source factory is
 * exposed here. A future explicit confirmation must supply the original live
 * native source. Disk inspection/JSON cannot construct such a world lease.
 * This is not yet protected undo or region-file durability verification. */
final class CoupledAssemblyExecution {
    static final long WAIT_TIMEOUT_NANOS=30_000_000_000L;
    enum State { READY,WAIT_INTENT,APPLYING,WAIT_RECEIPT,WAIT_OUTCOME,WAIT_AMBIGUITY,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    record Frame(String worldId,String dimension,long selectionRevision,long contextRevision,boolean creativeHost){}
    interface Source {
        void beginStep();Frame frame();Object loadedChunk(int x,int z);SelectionScan.BlockFact read(SelectionRegion.Point point);
        /** Native registry/state/support check; false BEFORE means no writes,
         * false AFTER means ambiguity. No caller/preview attestation suffices. */
        boolean verifyGroup(List<WorldPatchCompiler.Write> group,boolean after);
        boolean set(WorldPatchCompiler.Write write);
    }
    interface Log {
        CoupledAssemblyJournal.Plan plan();
        default Path archive(){return null;}
        default CoupledAssemblyJournal.Sealed sealed(List<WorldPatchCompiler.Write> prefix,int groups){return null;}
        CompletableFuture<CoupledAssemblyJournal.Intent> intent();
        CompletableFuture<Void> applied(CoupledAssemblyJournal.Intent token,List<WorldPatchCompiler.Write> prefix,CoupledAssemblyJournal.ReceiptState state);
        CompletableFuture<Void> finish(CoupledAssemblyJournal.Outcome outcome);
        CompletableFuture<Void> ambiguous(CoupledAssemblyJournal.Intent token,String reason);
    }
    static final class Disk implements Log {
        private final CoupledAssemblyJournal.Live live;private final Executor worker;
        Disk(CoupledAssemblyJournal.Live live,Executor worker){this.live=Objects.requireNonNull(live);this.worker=Objects.requireNonNull(worker);}
        public CoupledAssemblyJournal.Plan plan(){return live.plan();}
        public Path archive(){return live.directory();}
        public CoupledAssemblyJournal.Sealed sealed(List<WorldPatchCompiler.Write> prefix,int groups){return live.sealed(prefix,groups);}
        private <T> CompletableFuture<T> submit(Callable<T> action){try{return CompletableFuture.supplyAsync(()->{try{return action.call();}catch(Exception e){throw new CompletionException(e);}},worker);}catch(RuntimeException e){return CompletableFuture.failedFuture(e);}}
        public CompletableFuture<CoupledAssemblyJournal.Intent> intent(){return submit(live::intent);}
        public CompletableFuture<Void> applied(CoupledAssemblyJournal.Intent token,List<WorldPatchCompiler.Write> prefix,CoupledAssemblyJournal.ReceiptState state){var rows=List.copyOf(prefix);return submit(()->{live.applied(token,rows,state);return null;});}
        public CompletableFuture<Void> finish(CoupledAssemblyJournal.Outcome outcome){return submit(()->{live.finish(outcome);return null;});}
        public CompletableFuture<Void> ambiguous(CoupledAssemblyJournal.Intent token,String reason){return submit(()->{live.ambiguous(token,reason);return null;});}
    }
    record Progress(State state,int confirmedWrites,int confirmedGroups,int totalWrites,int steps,int maximumWritesPerStep,long maximumStepNanos,String reason){
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    /** Does not grant undo consent or open a native source. Only the SAME
     * closed live forward ledger can supply this complete-group witness. */
    static final class UndoOrigin {
        private final CoupledAssemblyJournal.Plan plan;private final Path archive;private final List<WorldPatchCompiler.Write> prefix;private final int groups;private final CoupledAssemblyJournal.Sealed sealed;private boolean claimed;
        private UndoOrigin(CoupledAssemblyJournal.Plan plan,Path archive,List<WorldPatchCompiler.Write> prefix,int groups,CoupledAssemblyJournal.Sealed sealed){this.plan=plan;this.archive=archive;this.prefix=List.copyOf(prefix);this.groups=groups;this.sealed=Objects.requireNonNull(sealed);if(!sealed.matches(plan,archive,this.prefix,groups))throw new IllegalStateException("Coupled undo witness differs from original complete groups");}
        CoupledAssemblyJournal.Plan plan(){return plan;}Path archive(){return archive;}List<WorldPatchCompiler.Write> prefix(){return prefix;}int groups(){return groups;}CoupledAssemblyJournal.Sealed sealed(){return sealed;}
        synchronized void claim(){if(claimed)throw new IllegalStateException("Original coupled undo already claimed; no replay");claimed=true;}
        boolean canAuthorizePlacement(){return false;}
    }
    private final Log log;private final Source source;private final LongSupplier clock;private final int maximumWrites;private final long maximumNanos;
    private final WorldSelection selection;private final SelectionBaseline baseline;private final Map<SelectionRegion.Point,String> owned=new HashMap<>();
    private final SelectionChunkFence chunks=new SelectionChunkFence();private final List<WorldPatchCompiler.Write> confirmed=new ArrayList<>();
    private State state=State.READY;private String reason="等待原完整组写前日志";private boolean cancelled;
    private long revision,pendingStarted,maxStepNanos;private int cursor,groupCursor,batchWrites,batchGroups,steps,maxWritesPerStep;
    private CoupledAssemblyJournal.Intent intent;private CompletableFuture<?> pending;private CoupledAssemblyJournal.ReceiptState receipt;private CoupledAssemblyJournal.Outcome outcome;
    private UndoOrigin undoOrigin;
    CoupledAssemblyExecution(Log log,Source source,int maximumWrites,long maximumNanos,LongSupplier clock){
        this.log=Objects.requireNonNull(log);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);
        // A two-cell group is synchronous. Never claim a one-write maximum
        // and then silently exceed it to complete a door.
        if(maximumWrites<2||maximumWrites>128||maximumNanos<1||maximumNanos>2_000_000)throw new IllegalArgumentException("Bounded complete-group execution budget required");
        this.maximumWrites=maximumWrites;this.maximumNanos=maximumNanos;var plan=log.plan();baseline=plan.compiled().baseline();selection=plan.binding().selection();revision=plan.binding().contextRevision();
    }
    Progress progress(){return new Progress(state,confirmed.size(),groupCursor,log.plan().binding().totalWrites(),steps,maxWritesPerStep,maxStepNanos,reason);}
    List<WorldPatchCompiler.Write> confirmedGroupsPrefix(){return List.copyOf(confirmed);}
    UndoOrigin undoOrigin(){
        if(!Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT).contains(state)||confirmed.isEmpty()||log.archive()==null)throw new IllegalStateException("Coupled undo requires a sealed complete-group live prefix, never ambiguity");
        if(undoOrigin==null){var sealed=log.sealed(confirmed,groupCursor);if(sealed==null)throw new IllegalStateException("Original closed live coupled ledger required; no disk Review adoption");undoOrigin=new UndoOrigin(log.plan(),log.archive(),confirmed,groupCursor,sealed);}return undoOrigin;
    }
    void cancel(){if(!terminal())cancelled=true;}
    private boolean terminal(){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED).contains(state);}
    private boolean frame(){var f=Objects.requireNonNull(source.frame());var w=selection.world();return f.creativeHost&&w.worldId().equals(f.worldId)&&w.dimension().equals(f.dimension)&&selection.revision()==f.selectionRevision&&revision==f.contextRevision;}
    private void review(String why){reason=why;state=State.REVIEW_REQUIRED;}
    private void waitFor(CompletableFuture<?> original,State next){pending=Objects.requireNonNull(original);pendingStarted=clock.getAsLong();state=next;}
    private void seal(CoupledAssemblyJournal.Outcome next){outcome=next;waitFor(log.finish(next),State.WAIT_OUTCOME);}
    private void receipt(CoupledAssemblyJournal.ReceiptState next){receipt=next;waitFor(log.applied(intent,intent.packet().writes().subList(0,batchWrites),next),State.WAIT_RECEIPT);}
    private void uncertain(String why){reason=why;waitFor(log.ambiguous(intent,why),State.WAIT_AMBIGUITY);}
    private boolean guarded(WorldPatchCompiler.Write write){
        var p=write.position();var points=new ArrayList<SelectionRegion.Point>(7);points.add(p);
        for(int axis=0;axis<3;axis++)for(int sign:new int[]{-1,1}){int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=sign;points.add(new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]));}
        for(var point:points){
            if(!frame())return false;var expected=baseline.at(point);if(expected==null)return false;
            var chunk=source.loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));if(chunk==null||!chunks.observe(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16),chunk))return false;
            var actual=source.read(point);if(actual==null||actual.blockEntity()!=expected.blockEntity()||!actual.state().equals(owned.getOrDefault(point,expected.state()))||!frame())return false;
        }return true;
    }
    private void acknowledge(){
        if(pending==null)throw new IllegalStateException("Original coupled disk operation missing");
        if(!pending.isDone()){if(clock.getAsLong()-pendingStarted>=WAIT_TIMEOUT_NANOS)review("成组磁盘回执未知；原操作可能仍在执行，不重发");return;}
        try{
            if(state==State.WAIT_INTENT){
                intent=(CoupledAssemblyJournal.Intent)pending.getNow(null);pending=null;batchWrites=batchGroups=0;
                if(intent==null||!intent.belongs(log.plan())||!intent.packet().equals(log.plan().packet(groupCursor))||intent.packet().offset()!=cursor)throw new IllegalStateException("Coupled intent belongs to another original schedule");state=State.APPLYING;
            }else{
                pending.getNow(null);pending=null;
                if(state==State.WAIT_RECEIPT){intent=null;if(receipt==CoupledAssemblyJournal.ReceiptState.COMPLETE)state=State.READY;else seal(CoupledAssemblyJournal.Outcome.valueOf(receipt.name()));}
                else if(state==State.WAIT_OUTCOME){state=State.valueOf(outcome.name());reason="完整原组日志已封闭；世界物理存盘未验证";}
                else if(state==State.WAIT_AMBIGUITY)review(reason);else throw new IllegalStateException("Unexpected coupled disk state");
            }
        }catch(Exception error){review("成组磁盘回执不能确认，不重放："+error.getMessage());}
    }
    Progress step(){
        if(terminal())return progress();long started=clock.getAsLong();steps++;int changed=0;
        try{
            source.beginStep();if(Set.of(State.WAIT_INTENT,State.WAIT_RECEIPT,State.WAIT_OUTCOME,State.WAIT_AMBIGUITY).contains(state)){acknowledge();return progress();}
            if(state==State.READY){if(cancelled)seal(CoupledAssemblyJournal.Outcome.CANCELLED);else if(!frame())seal(CoupledAssemblyJournal.Outcome.CONFLICT);else if(cursor==log.plan().binding().totalWrites())seal(CoupledAssemblyJournal.Outcome.COMPLETED);else waitFor(log.intent(),State.WAIT_INTENT);return progress();}
            if(state!=State.APPLYING)throw new IllegalStateException("Unexpected coupled execution state");
            while(batchGroups<intent.packet().groups().size()&&clock.getAsLong()-started<maximumNanos){
                var group=intent.packet().groups().get(batchGroups);int size=group.operationIndices().size();if(changed+size>maximumWrites)break;
                if(cancelled){receipt(CoupledAssemblyJournal.ReceiptState.CANCELLED);break;}
                var rows=intent.packet().writes().subList(batchWrites,batchWrites+size);boolean safe=true;
                for(var row:rows)if(!guarded(row)){safe=false;break;}
                if(!safe||!source.verifyGroup(rows,false)||!frame()){reason="成组原 BEFORE、邻接、覆盖或原生支撑冲突；整组不写入";receipt(CoupledAssemblyJournal.ReceiptState.CONFLICT);break;}
                // No clock, tick or cancellation boundary exists INSIDE a
                // group. A late failure leaves its complete intent unresolved.
                boolean whole=true;int members=0;
                for(var row:rows){
                    try{
                        boolean applied=source.set(row);changed++;var after=source.read(row.position());var f=source.frame();
                        if(!applied&&members==0&&after!=null&&!after.blockEntity()&&after.state().equals(row.before())&&frame()){
                            reason="原生完整组首写明确拒绝；没有确认半组";receipt(CoupledAssemblyJournal.ReceiptState.CONFLICT);whole=false;break;
                        }
                        var w=selection.world();if(!applied||after==null||after.blockEntity()||!after.state().equals(row.after())||!f.creativeHost||!w.worldId().equals(f.worldId)||!w.dimension().equals(f.dimension)||selection.revision()!=f.selectionRevision||f.contextRevision!=revision+1){uncertain("完整组可能只写入部分成员；保留原 intent，不确认半组或重试");whole=false;break;}
                        revision=f.contextRevision;members++;
                    }catch(Exception error){uncertain("完整组成员写入异常，可能部分生效："+error.getMessage());whole=false;break;}
                }
                if(!whole)break;
                for(var row:rows){var after=source.read(row.position());if(after==null||after.blockEntity()||!after.state().equals(row.after())||!frame()){whole=false;break;}}
                if(!whole||!source.verifyGroup(rows,true)||!frame()){uncertain("成组最终完整状态或原生支撑不能确认；不封闭半组");break;}
                for(var row:rows){owned.put(row.position(),row.after());confirmed.add(row);}cursor+=size;batchWrites+=size;batchGroups++;groupCursor++;
            }
            if(state==State.APPLYING&&batchGroups==intent.packet().groups().size())receipt(CoupledAssemblyJournal.ReceiptState.COMPLETE);
        }catch(Exception error){if(intent!=null&&state==State.APPLYING){try{uncertain("成组执行异常："+error.getMessage());}catch(Exception other){review("成组日志/世界状态未知："+other.getMessage());}}else review("成组事务不能继续："+error.getMessage());}
        finally{maxWritesPerStep=Math.max(maxWritesPerStep,changed);maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
}
