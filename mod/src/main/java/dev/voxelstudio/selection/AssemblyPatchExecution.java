package dev.voxelstudio.selection;

import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Independent whole engine, NOT yet a live-server gateway. One plan/ordered
 * write sequence, never per-part legacy application. Only a future explicit
 * final-confirmation gateway may supply a detached whole server source.
 * Read-only disk review cannot construct Source, consent or an UndoOrigin. */
final class AssemblyPatchExecution {
    static final long WAIT_TIMEOUT_NANOS=30_000_000_000L;
    enum State { READY,WAIT_INTENT,APPLYING,WAIT_RECEIPT,WAIT_OUTCOME,WAIT_AMBIGUITY,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    record Frame(String worldId,String dimension,long selectionRevision,long contextRevision,boolean creativeHost){}
    interface Source {
        void beginStep();Frame frame();Object loadedChunk(int x,int z);SelectionScan.BlockFact read(SelectionRegion.Point point);
        /** Exactly one original static write, no load, command or skip. */
        boolean set(WorldPatchCompiler.Write write);
    }
    interface Log {
        AssemblyPatchJournal.Plan plan();default Path archive(){return null;}
        default AssemblyPatchJournal.Sealed sealed(List<WorldPatchCompiler.Write> prefix){return null;}
        CompletableFuture<AssemblyPatchJournal.Intent> intent();
        CompletableFuture<Void> applied(AssemblyPatchJournal.Intent intent,List<WorldPatchCompiler.Write> prefix,AssemblyPatchJournal.ReceiptState state);
        CompletableFuture<Void> finish(AssemblyPatchJournal.Outcome outcome);
        CompletableFuture<Void> ambiguous(AssemblyPatchJournal.Intent intent,String reason);
    }
    static final class Disk implements Log {
        private final AssemblyPatchJournal.Live live;private final Executor worker;
        Disk(AssemblyPatchJournal.Live live,Executor worker){this.live=Objects.requireNonNull(live);this.worker=Objects.requireNonNull(worker);}
        public AssemblyPatchJournal.Plan plan(){return live.plan();}public Path archive(){return live.directory();}
        public AssemblyPatchJournal.Sealed sealed(List<WorldPatchCompiler.Write> prefix){return live.sealed(prefix);}
        private <T> CompletableFuture<T> submit(Callable<T> operation){
            try{return CompletableFuture.supplyAsync(()->{try{return operation.call();}catch(Exception error){throw new CompletionException(error);}},worker);}
            catch(RuntimeException error){return CompletableFuture.failedFuture(error);}
        }
        public CompletableFuture<AssemblyPatchJournal.Intent> intent(){return submit(()->live.intent(AssemblyPatchJournal.BATCH));}
        public CompletableFuture<Void> applied(AssemblyPatchJournal.Intent intent,List<WorldPatchCompiler.Write> prefix,AssemblyPatchJournal.ReceiptState state){var immutable=List.copyOf(prefix);return submit(()->{live.applied(intent,immutable,state);return null;});}
        public CompletableFuture<Void> finish(AssemblyPatchJournal.Outcome outcome){return submit(()->{live.finish(outcome);return null;});}
        public CompletableFuture<Void> ambiguous(AssemblyPatchJournal.Intent intent,String reason){return submit(()->{live.ambiguous(intent,reason);return null;});}
    }
    record Progress(State state,int confirmedWrites,int totalWrites,int steps,int maximumWritesPerStep,long maximumStepNanos,String reason){
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    /** Same live whole-engine witness to an acknowledged sealed prefix. Not
     * final consent; no constructor from archived Review or matching hashes. */
    static final class UndoOrigin {
        private final AssemblyPatchJournal.Plan plan;private final Path archive;private final List<WorldPatchCompiler.Write> prefix;private final AssemblyPatchJournal.Sealed sealed;private boolean claimed;
        private UndoOrigin(AssemblyPatchJournal.Plan plan,Path archive,List<WorldPatchCompiler.Write> prefix,AssemblyPatchJournal.Sealed sealed){this.plan=plan;this.archive=archive;this.prefix=List.copyOf(prefix);this.sealed=Objects.requireNonNull(sealed);if(!sealed.matches(plan,archive,this.prefix))throw new IllegalStateException("Whole undo witness differs from original live closure");}
        AssemblyPatchJournal.Plan plan(){return plan;}Path archive(){return archive;}List<WorldPatchCompiler.Write> prefix(){return prefix;}
        AssemblyPatchJournal.Sealed sealed(){return sealed;}
        synchronized void claim(){if(claimed)throw new IllegalStateException("Original whole undo already claimed; no replay");claimed=true;}
        boolean canAuthorizePlacement(){return false;}
    }
    private final Log log;private final Source source;private final LongSupplier clock;private final int maximumWrites;private final long maximumNanos;
    private final WorldSelection selection;private final List<WorldPatchCompiler.Write> writes;private final Map<SelectionRegion.Point,WorldPatchCompiler.Guard> guards;
    private final Map<SelectionRegion.Point,String> owned=new HashMap<>();private final List<WorldPatchCompiler.Write> confirmed=new ArrayList<>();private final SelectionChunkFence chunks=new SelectionChunkFence();
    private State state=State.READY;private String reason="整组等待唯一原写前日志；尚无玩家入口";private boolean cancelled;
    private long revision,maxStepNanos,pendingStarted;private int cursor,batchCursor,steps,maxWritesPerStep;
    private AssemblyPatchJournal.Intent intent;private CompletableFuture<?> pending;private AssemblyPatchJournal.ReceiptState receipt;private AssemblyPatchJournal.Outcome outcome;private UndoOrigin undoOrigin;
    AssemblyPatchExecution(Log log,Source source,int maximumWrites,long maximumNanos,LongSupplier clock){
        this.log=Objects.requireNonNull(log);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);
        if(maximumWrites<1||maximumWrites>128||maximumNanos<1||maximumNanos>2_000_000)throw new IllegalArgumentException("Bounded whole execution budget required");this.maximumWrites=maximumWrites;this.maximumNanos=maximumNanos;
        var plan=log.plan();selection=plan.binding().selection();revision=plan.binding().contextRevision();writes=plan.compiled().writes();var indexed=new HashMap<SelectionRegion.Point,WorldPatchCompiler.Guard>();
        for(var guard:plan.compiled().guards())if(indexed.put(guard.position(),guard)!=null)throw new IllegalArgumentException("Whole guard duplicates");guards=WorldPointIndex.copy(indexed);
    }
    Progress progress(){return new Progress(state,confirmed.size(),writes.size(),steps,maxWritesPerStep,maxStepNanos,reason);}
    List<WorldPatchCompiler.Write> confirmedPrefix(){return List.copyOf(confirmed);}
    void cancel(){if(!terminal())cancelled=true;}
    private boolean terminal(){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED).contains(state);}
    UndoOrigin undoOrigin(){
        if(!Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT).contains(state)||confirmed.isEmpty()||log.archive()==null)throw new IllegalStateException("Whole undo requires a sealed known live prefix");
        if(undoOrigin==null){var sealed=log.sealed(confirmed);if(sealed==null)throw new IllegalStateException("Whole undo requires the original closed live disk ledger, not an archive path");undoOrigin=new UndoOrigin(log.plan(),log.archive(),confirmed,sealed);}return undoOrigin;
    }
    private boolean frame(){var actual=Objects.requireNonNull(source.frame());var world=selection.world();return actual.creativeHost&&world.worldId().equals(actual.worldId)&&world.dimension().equals(actual.dimension)&&selection.revision()==actual.selectionRevision&&revision==actual.contextRevision;}
    private void review(String why){state=State.REVIEW_REQUIRED;reason=why;}
    private void waitFor(CompletableFuture<?> original,State next){pending=Objects.requireNonNull(original);pendingStarted=clock.getAsLong();state=next;}
    private void seal(AssemblyPatchJournal.Outcome next){outcome=next;waitFor(log.finish(next),State.WAIT_OUTCOME);}
    private void receipt(AssemblyPatchJournal.ReceiptState next){receipt=next;waitFor(log.applied(intent,intent.writes().subList(0,batchCursor),next),State.WAIT_RECEIPT);}
    private void uncertain(String why){reason=why;waitFor(log.ambiguous(intent,why),State.WAIT_AMBIGUITY);}
    private boolean guards(WorldPatchCompiler.Write write){
        var p=write.position();var points=new ArrayList<SelectionRegion.Point>(7);points.add(p);
        for(int axis=0;axis<3;axis++)for(int side:new int[]{-1,1}){int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=side;points.add(new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]));}
        for(var point:points){
            if(!frame())return false;var expected=Objects.requireNonNull(guards.get(point));var chunk=source.loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));
            if(chunk==null||!chunks.observe(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16),chunk))return false;
            var actual=source.read(point);if(actual==null||actual.blockEntity()!=expected.blockEntity()||!actual.state().equals(owned.getOrDefault(point,expected.before()))||!frame())return false;
        }return true;
    }
    private void acknowledge(){
        if(pending==null)throw new IllegalStateException("Whole original disk operation missing");
        if(!pending.isDone()){if(clock.getAsLong()-pendingStarted>=WAIT_TIMEOUT_NANOS)review("整组磁盘回执超时；原操作可能仍在执行，不重发");return;}
        try{
            if(state==State.WAIT_INTENT){
                intent=(AssemblyPatchJournal.Intent)pending.getNow(null);pending=null;batchCursor=0;
                if(intent==null||!intent.belongs(log.plan())||intent.offset()!=cursor||!intent.writes().equals(writes.subList(cursor,Math.min(cursor+AssemblyPatchJournal.BATCH,writes.size()))))throw new IllegalStateException("Whole intent owner/order differs");state=State.APPLYING;
            }else{
                pending.getNow(null);pending=null;
                if(state==State.WAIT_RECEIPT){intent=null;if(receipt==AssemblyPatchJournal.ReceiptState.COMPLETE)state=State.READY;else seal(AssemblyPatchJournal.Outcome.valueOf(receipt.name()));}
                else if(state==State.WAIT_OUTCOME){state=State.valueOf(outcome.name());reason="整组原日志已封闭；世界持久性未验证";}
                else if(state==State.WAIT_AMBIGUITY)review(reason);else throw new IllegalStateException("Unexpected whole acknowledgement");
            }
        }catch(Exception error){review("整组磁盘回执未知，不重放："+error.getMessage());}
    }
    Progress step(){
        if(terminal())return progress();long started=clock.getAsLong();steps++;int changed=0;
        try{
            source.beginStep();
            if(Set.of(State.WAIT_INTENT,State.WAIT_RECEIPT,State.WAIT_OUTCOME,State.WAIT_AMBIGUITY).contains(state)){acknowledge();return progress();}
            if(state==State.READY){
                if(cancelled)seal(AssemblyPatchJournal.Outcome.CANCELLED);else if(!frame())seal(AssemblyPatchJournal.Outcome.CONFLICT);else if(cursor==writes.size())seal(AssemblyPatchJournal.Outcome.COMPLETED);else waitFor(log.intent(),State.WAIT_INTENT);return progress();
            }
            if(state!=State.APPLYING)throw new IllegalStateException("Unexpected whole execution state");
            while(batchCursor<intent.writes().size()&&changed<maximumWrites&&clock.getAsLong()-started<maximumNanos){
                if(cancelled){receipt(AssemblyPatchJournal.ReceiptState.CANCELLED);break;}
                var write=intent.writes().get(batchCursor);if(!guards(write)){reason="整组原 BEFORE、邻接、权限或覆盖冲突，不跳过/重绑";receipt(AssemblyPatchJournal.ReceiptState.CONFLICT);break;}
                try{
                    boolean applied=source.set(write);var after=source.read(write.position());var actual=source.frame();
                    if(!applied&&after!=null&&!after.blockEntity()&&after.state().equals(write.before())&&frame()){reason="整组原生写入明确拒绝";receipt(AssemblyPatchJournal.ReceiptState.CONFLICT);break;}
                    var world=selection.world();if(!applied||after==null||after.blockEntity()||!after.state().equals(write.after())||!actual.creativeHost||!world.worldId().equals(actual.worldId)||!world.dimension().equals(actual.dimension)||selection.revision()!=actual.selectionRevision||actual.contextRevision!=revision+1){uncertain("整组写入可能已生效但回执不确定；保留 intent，不恢复/撤销");break;}
                    revision=actual.contextRevision;owned.put(write.position(),write.after());confirmed.add(write);cursor++;batchCursor++;changed++;
                }catch(Exception error){uncertain("整组写入异常可能已生效："+error.getMessage());break;}
            }
            if(state==State.APPLYING&&batchCursor==intent.writes().size())receipt(AssemblyPatchJournal.ReceiptState.COMPLETE);
        }catch(Exception error){
            if(intent!=null&&state==State.APPLYING){try{uncertain("整组执行状态异常："+error.getMessage());}catch(Exception other){review("整组日志与世界状态未知："+other.getMessage());}}
            else review("整组事务不能继续："+error.getMessage());
        }finally{maxWritesPerStep=Math.max(maxWritesPerStep,changed);maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
}
