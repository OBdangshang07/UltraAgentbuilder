package dev.voxelstudio.selection;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;
import java.nio.file.Path;

/** Unwired server-thread transaction core. NOT a public placement API. The
 * integrated-host service still must bind its private original Capture,
 * independent audit, fresh BEFORE and one-use final consent before wiring a
 * Source. Disk recovery can NEVER construct this engine or a live Source.
 * The source must assert server-thread access and use nonloading reads.
 * Static state policy is NOT evidence of Minecraft physics/save durability. */
final class WorldPatchExecution {
    static final long WAIT_TIMEOUT_NANOS=30_000_000_000L;
    enum State { READY,WAIT_INTENT,APPLYING,WAIT_RECEIPT,WAIT_OUTCOME,WAIT_AMBIGUITY,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    record Frame(String worldId,String dimension,long selectionRevision,long contextRevision,boolean creativeHost){}
    interface Source {
        void beginStep();
        Frame frame();
        Object loadedChunk(int x,int z);
        SelectionScan.BlockFact read(SelectionRegion.Point point);
        /** A single synchronous static set, no loads, neighbour dispatch,
         * drops, entities, commands, skipped conflicts or alternate baseline. */
        boolean set(WorldPatchCompiler.Write write);
    }
    interface Log {
        WorldPatchJournal.Plan plan();
        default Path archive(){return null;}
        CompletableFuture<WorldPatchJournal.Intent> intent();
        CompletableFuture<Void> applied(WorldPatchJournal.Intent intent,List<WorldPatchCompiler.Write> prefix,WorldPatchJournal.ReceiptState state);
        CompletableFuture<Void> finish(WorldPatchJournal.Outcome outcome);
        CompletableFuture<Void> ambiguous(WorldPatchJournal.Intent intent,String reason);
    }
    /** The caller supplies a bounded disk executor; no tick method waits for
     * it. Queue rejection and missing/failed acknowledgement are terminal. */
    static final class Disk implements Log {
        private final WorldPatchJournal.Live live;private final Executor worker;
        Disk(WorldPatchJournal.Live live,Executor worker){this.live=Objects.requireNonNull(live);this.worker=Objects.requireNonNull(worker);}
        public WorldPatchJournal.Plan plan(){return live.plan();}
        public Path archive(){return live.directory();}
        private <T> CompletableFuture<T> submit(Callable<T> work){
            try{return CompletableFuture.supplyAsync(()->{try{return work.call();}catch(Exception e){throw new CompletionException(e);}},worker);}
            catch(RuntimeException e){return CompletableFuture.failedFuture(e);}
        }
        public CompletableFuture<WorldPatchJournal.Intent> intent(){return submit(()->live.intent(WorldPatchJournal.BATCH));}
        public CompletableFuture<Void> applied(WorldPatchJournal.Intent i,List<WorldPatchCompiler.Write> prefix,WorldPatchJournal.ReceiptState state){var copy=List.copyOf(prefix);return submit(()->{live.applied(i,copy,state);return null;});}
        public CompletableFuture<Void> finish(WorldPatchJournal.Outcome outcome){return submit(()->{live.finish(outcome);return null;});}
        public CompletableFuture<Void> ambiguous(WorldPatchJournal.Intent i,String reason){return submit(()->{live.ambiguous(i,reason);return null;});}
    }
    record Progress(State state,int confirmedWrites,int totalWrites,int steps,int maximumWritesPerStep,long maximumStepNanos,String reason){
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    private final Log log;private final Source source;private final LongSupplier clock;private final int maximumWrites;private final long maximumNanos;
    private final List<WorldPatchCompiler.Write> writes;private final Map<SelectionRegion.Point,WorldPatchCompiler.Guard> guards;
    private final Map<SelectionRegion.Point,String> owned=new HashMap<>();private final List<WorldPatchCompiler.Write> confirmed=new ArrayList<>();
    private final SelectionChunkFence chunks=new SelectionChunkFence();private final WorldSelection selection;
    private State state=State.READY;private String reason="等待写前日志；尚无公开建造入口";private boolean cancelled;
    private long revision,maxStepNanos,pendingStarted;private int cursor,batchCursor,steps,maxWritesPerStep;
    private WorldPatchJournal.Intent intent;private CompletableFuture<?> pending;private WorldPatchJournal.ReceiptState receipt;private WorldPatchJournal.Outcome outcome;
    private UndoOrigin undoOrigin;
    /** A private live-engine witness to a fully acknowledged, unambiguous
     * ordered prefix. It is not consent. No disk Review can mint this object. */
    static final class UndoOrigin {
        private final WorldPatchJournal.Plan plan;private final Path archive;private final List<WorldPatchCompiler.Write> prefix;private boolean claimed;
        private UndoOrigin(WorldPatchJournal.Plan p,Path a,List<WorldPatchCompiler.Write> rows){plan=p;archive=a;prefix=List.copyOf(rows);}
        WorldPatchJournal.Plan plan(){return plan;}Path archive(){return archive;}List<WorldPatchCompiler.Write> prefix(){return prefix;}
        synchronized void claim(){if(claimed)throw new IllegalStateException("Original undo already claimed; no automatic replay");claimed=true;}
        boolean canAuthorizePlacement(){return false;}
    }
    UndoOrigin undoOrigin(){
        if(!Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT).contains(state)||confirmed.isEmpty()||log.archive()==null)throw new IllegalStateException("Only a sealed unambiguous live prefix can prepare undo");
        if(undoOrigin==null)undoOrigin=new UndoOrigin(log.plan(),log.archive(),confirmed);return undoOrigin;
    }
    WorldPatchExecution(Log log,Source source,int maximumWrites,long maximumNanos,LongSupplier clock){
        this.log=Objects.requireNonNull(log);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);
        if(maximumWrites<1||maximumWrites>128||maximumNanos<1||maximumNanos>2_000_000)throw new IllegalArgumentException("Bounded native transaction budget required");
        this.maximumWrites=maximumWrites;this.maximumNanos=maximumNanos;var plan=log.plan();selection=plan.binding().selection();revision=plan.binding().contextRevision();writes=plan.compiled().writes();var indexed=new HashMap<SelectionRegion.Point,WorldPatchCompiler.Guard>();for(var g:plan.compiled().guards())if(indexed.put(g.position(),g)!=null)throw new IllegalArgumentException("Native guard duplicates");guards=Map.copyOf(indexed);
    }
    Progress progress(){return new Progress(state,confirmed.size(),writes.size(),steps,maxWritesPerStep,maxStepNanos,reason);}
    List<WorldPatchCompiler.Write> confirmedPrefix(){return List.copyOf(confirmed);}
    void cancel(){if(!terminal())cancelled=true;}
    private boolean terminal(){return state==State.COMPLETED||state==State.CANCELLED||state==State.CONFLICT||state==State.REVIEW_REQUIRED;}
    private boolean frame(){
        var f=Objects.requireNonNull(source.frame());var w=selection.world();return f.creativeHost&&w.worldId().equals(f.worldId)&&w.dimension().equals(f.dimension)&&selection.revision()==f.selectionRevision&&revision==f.contextRevision;
    }
    private void review(String message){state=State.REVIEW_REQUIRED;reason=message;}
    private void waitFor(CompletableFuture<?> operation,State next){pending=Objects.requireNonNull(operation);pendingStarted=clock.getAsLong();state=next;}
    private void seal(WorldPatchJournal.Outcome next){outcome=next;waitFor(log.finish(next),State.WAIT_OUTCOME);}
    private void receipt(WorldPatchJournal.ReceiptState next){receipt=next;waitFor(log.applied(intent,intent.writes().subList(0,batchCursor),next),State.WAIT_RECEIPT);}
    private void uncertain(String why){reason=why;waitFor(log.ambiguous(intent,why),State.WAIT_AMBIGUITY);}
    private boolean guards(WorldPatchCompiler.Write write){
        var p=write.position();var points=new ArrayList<SelectionRegion.Point>(7);points.add(p);for(int axis=0;axis<3;axis++)for(int side:new int[]{-1,1}){int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=side;points.add(new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]));}
        for(var point:points){
            if(!frame())return false;var expected=Objects.requireNonNull(guards.get(point));var chunk=source.loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));
            if(chunk==null||!chunks.observe(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16),chunk))return false;
            var actual=source.read(point);var state=owned.getOrDefault(point,expected.before());
            if(actual==null||actual.blockEntity()!=expected.blockEntity()||!actual.state().equals(state)||!frame())return false;
        }return true;
    }
    /** Poll completed work once and yield. No future.get/join, sleeping,
     * serialization or journal file I/O on the server thread. */
    private void acknowledge(){
        if(pending==null)throw new IllegalStateException("Missing original disk operation");
        if(!pending.isDone()){if(clock.getAsLong()-pendingStarted>=WAIT_TIMEOUT_NANOS)review("磁盘回执等待超时；原操作可能仍在执行，禁止重发/重放");return;}
        try{
            if(state==State.WAIT_INTENT){
                intent=(WorldPatchJournal.Intent)pending.getNow(null);pending=null;batchCursor=0;
                if(intent==null||!intent.belongs(log.plan())||intent.offset()!=cursor||!intent.writes().equals(writes.subList(cursor,Math.min(cursor+WorldPatchJournal.BATCH,writes.size()))))throw new IllegalStateException("Disk acknowledgement differs from native ordered batch/owner");state=State.APPLYING;
            }else{
                pending.getNow(null);pending=null;
                if(state==State.WAIT_RECEIPT){intent=null;if(receipt==WorldPatchJournal.ReceiptState.COMPLETE){state=State.READY;}else seal(WorldPatchJournal.Outcome.valueOf(receipt.name()));}
                else if(state==State.WAIT_OUTCOME){state=State.valueOf(outcome.name());reason="原生执行日志已封闭；世界持久性未经验证";}
                else if(state==State.WAIT_AMBIGUITY)review(reason);
                else throw new IllegalStateException("Unexpected transaction acknowledgement");
            }
        }catch(Exception e){review("磁盘回执不确定，禁止重放："+e.getMessage());}
    }
    Progress step(){
        if(terminal())return progress();long started=clock.getAsLong();steps++;int changed=0;
        try{
            source.beginStep();
            if(state==State.WAIT_INTENT||state==State.WAIT_RECEIPT||state==State.WAIT_OUTCOME||state==State.WAIT_AMBIGUITY){acknowledge();return progress();}
            if(state==State.READY){
                if(cancelled)seal(WorldPatchJournal.Outcome.CANCELLED);
                else if(!frame())seal(WorldPatchJournal.Outcome.CONFLICT);
                else if(cursor==writes.size())seal(WorldPatchJournal.Outcome.COMPLETED);
                else waitFor(log.intent(),State.WAIT_INTENT);return progress();
            }
            if(state!=State.APPLYING)throw new IllegalStateException("Unexpected transaction state");
            while(batchCursor<intent.writes().size()&&changed<maximumWrites&&clock.getAsLong()-started<maximumNanos){
                if(cancelled){receipt(WorldPatchJournal.ReceiptState.CANCELLED);break;}
                var write=intent.writes().get(batchCursor);
                if(!guards(write)){reason="原 BEFORE、邻接面、权限或区块身份冲突；不跳过、不重绑";receipt(WorldPatchJournal.ReceiptState.CONFLICT);break;}
                // Every exception from set or its acknowledgement may occur
                // AFTER mutation. Never close such an intent with a guess.
                try{
                    boolean applied=source.set(write);var after=source.read(write.position());var f=source.frame();
                    if(!applied&&after!=null&&!after.blockEntity()&&after.state().equals(write.before())&&frame()){reason="原生 set 被明确拒绝";receipt(WorldPatchJournal.ReceiptState.CONFLICT);break;}
                    var w=selection.world();
                    if(!applied||after==null||after.blockEntity()||!after.state().equals(write.after())||!f.creativeHost||!w.worldId().equals(f.worldId)||!w.dimension().equals(f.dimension)||selection.revision()!=f.selectionRevision||f.contextRevision!=revision+1){uncertain("写入回执或自写版本不确定；保留未决 intent，禁止自动恢复/撤销");break;}
                    revision=f.contextRevision;owned.put(write.position(),write.after());confirmed.add(write);cursor++;batchCursor++;changed++;
                }catch(Exception e){uncertain("世界写入异常可能已生效："+e.getMessage());break;}
            }
            if(state==State.APPLYING&&batchCursor==intent.writes().size())receipt(WorldPatchJournal.ReceiptState.COMPLETE);
        }catch(Exception e){if(intent!=null&&state==State.APPLYING){try{uncertain("执行状态异常："+e.getMessage());}catch(Exception second){review("日志异常且无法确认世界状态："+second.getMessage());}}else review("事务无法继续："+e.getMessage());}
        finally{maxWritesPerStep=Math.max(maxWritesPerStep,changed);maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}
        return progress();
    }
}
