package dev.voxelstudio.selection;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

/** Unwired native undo core. A fresh explicit server-owned undo consent is
 * still required; an UndoOrigin or disk Review never supplies it. Reverse
 * ONLY logged original writes whose AFTER and neighbours remain expected.
 * Later edits are recorded as preserved, not rewritten into a new baseline. */
final class WorldPatchUndoExecution {
    enum State { READY,WAIT_INTENT,APPLYING,WAIT_RECEIPT,WAIT_OUTCOME,WAIT_AMBIGUITY,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    interface Log {
        WorldPatchUndoJournal.Plan plan();
        CompletableFuture<WorldPatchUndoJournal.Intent> intent();
        CompletableFuture<Void> evaluated(WorldPatchUndoJournal.Intent i,List<WorldPatchUndoJournal.Entry> entries,WorldPatchJournal.ReceiptState state);
        CompletableFuture<Void> finish(WorldPatchJournal.Outcome outcome);
        CompletableFuture<Void> ambiguous(WorldPatchUndoJournal.Intent i,String reason);
    }
    static final class Disk implements Log {
        private final WorldPatchUndoJournal.Live live;private final Executor worker;
        Disk(WorldPatchUndoJournal.Live l,Executor e){live=Objects.requireNonNull(l);worker=Objects.requireNonNull(e);}
        public WorldPatchUndoJournal.Plan plan(){return live.plan();}
        private <T> CompletableFuture<T> submit(Callable<T> call){try{return CompletableFuture.supplyAsync(()->{try{return call.call();}catch(Exception e){throw new CompletionException(e);}},worker);}catch(RuntimeException e){return CompletableFuture.failedFuture(e);}}
        public CompletableFuture<WorldPatchUndoJournal.Intent> intent(){return submit(live::intent);}
        public CompletableFuture<Void> evaluated(WorldPatchUndoJournal.Intent i,List<WorldPatchUndoJournal.Entry> rows,WorldPatchJournal.ReceiptState s){var copy=List.copyOf(rows);return submit(()->{live.evaluated(i,copy,s);return null;});}
        public CompletableFuture<Void> finish(WorldPatchJournal.Outcome o){return submit(()->{live.finish(o);return null;});}
        public CompletableFuture<Void> ambiguous(WorldPatchUndoJournal.Intent i,String reason){return submit(()->{live.ambiguous(i,reason);return null;});}
    }
    record Progress(State state,int evaluated,int restored,int preserved,int total,int steps,int maximumEntriesPerStep,long maximumStepNanos,String reason){
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    private final Log log;private final WorldPatchExecution.Source source;private final LongSupplier clock;private final int maximumEntries;private final long maximumNanos;
    private final List<WorldPatchCompiler.Write> writes;private final WorldSelection selection;private final Map<SelectionRegion.Point,WorldPatchCompiler.Guard> guards;
    private final Map<SelectionRegion.Point,String> expected=new HashMap<>();private final SelectionChunkFence chunks=new SelectionChunkFence();
    private final List<WorldPatchUndoJournal.Entry> evaluated=new ArrayList<>(),batch=new ArrayList<>();
    private State state=State.READY;private String reason="等待独立撤销日志";private boolean cancelled;private long revision,pendingStarted,maxStepNanos;private int steps,restored,maxEntriesPerStep;
    private WorldPatchUndoJournal.Intent intent;private CompletableFuture<?> pending;private WorldPatchJournal.ReceiptState receipt;private WorldPatchJournal.Outcome outcome;
    WorldPatchUndoExecution(Log log,WorldPatchExecution.Source source,int maximumEntries,long maximumNanos,LongSupplier clock){
        this.log=Objects.requireNonNull(log);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);if(maximumEntries<1||maximumEntries>128||maximumNanos<1||maximumNanos>2_000_000)throw new IllegalArgumentException("Bounded undo budget required");this.maximumEntries=maximumEntries;this.maximumNanos=maximumNanos;
        var plan=log.plan();selection=plan.original().binding().selection();writes=plan.writes();var indexed=new HashMap<SelectionRegion.Point,WorldPatchCompiler.Guard>();for(var g:plan.original().compiled().guards())indexed.put(g.position(),g);guards=WorldPointIndex.copy(indexed);
        // This epoch guards the new explicit undo operation only. It never
        // replaces the original Capture, patch identity or logged AFTER.
        var current=source.frame();revision=current.contextRevision();if(!frame())throw new IllegalArgumentException("Undo requires original world/selection and current creative host");
        for(var w:writes)expected.put(w.position(),w.before());
    }
    Progress progress(){return new Progress(state,evaluated.size(),restored,evaluated.size()-restored,writes.size(),steps,maxEntriesPerStep,maxStepNanos,reason);}
    void cancel(){if(!terminal())cancelled=true;}
    private boolean terminal(){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED).contains(state);}
    private boolean frame(){var f=Objects.requireNonNull(source.frame());var w=selection.world();return f.creativeHost()&&w.worldId().equals(f.worldId())&&w.dimension().equals(f.dimension())&&selection.revision()==f.selectionRevision()&&revision==f.contextRevision();}
    private void waitFor(CompletableFuture<?> future,State next){pending=Objects.requireNonNull(future);pendingStarted=clock.getAsLong();state=next;}
    private void seal(WorldPatchJournal.Outcome next){outcome=next;waitFor(log.finish(next),State.WAIT_OUTCOME);}
    private void receipt(WorldPatchJournal.ReceiptState next){receipt=next;waitFor(log.evaluated(intent,batch,next),State.WAIT_RECEIPT);}
    private void uncertain(String why){reason=why;waitFor(log.ambiguous(intent,why),State.WAIT_AMBIGUITY);}
    private void review(String why){reason=why;state=State.REVIEW_REQUIRED;}
    private void acknowledge(){
        if(pending==null)throw new IllegalStateException("Missing undo disk operation");if(!pending.isDone()){if(clock.getAsLong()-pendingStarted>=WorldPatchExecution.WAIT_TIMEOUT_NANOS)review("撤销日志回执超时，原操作可能仍在运行；不重发");return;}
        try{
            if(state==State.WAIT_INTENT){intent=(WorldPatchUndoJournal.Intent)pending.getNow(null);pending=null;batch.clear();int cursor=evaluated.size();if(intent==null||!intent.belongs(log.plan())||intent.offset()!=cursor||!intent.writes().equals(writes.subList(cursor,Math.min(cursor+WorldPatchJournal.BATCH,writes.size()))))throw new IllegalStateException("Undo intent owner/order differs");state=State.APPLYING;}
            else{pending.getNow(null);pending=null;if(state==State.WAIT_RECEIPT){intent=null;if(receipt==WorldPatchJournal.ReceiptState.COMPLETE)state=State.READY;else seal(WorldPatchJournal.Outcome.valueOf(receipt.name()));}else if(state==State.WAIT_OUTCOME){state=State.valueOf(outcome.name());reason="撤销日志已封闭；保留后改，世界持久性未验证";}else if(state==State.WAIT_AMBIGUITY)review(reason);else throw new IllegalStateException("Unexpected undo acknowledgement");}
        }catch(Exception e){review("撤销磁盘回执不确定；禁止恢复/重放："+e.getMessage());}
    }
    private SelectionScan.BlockFact read(SelectionRegion.Point p){
        if(!frame())throw new IllegalStateException("Undo epoch/permission changed");var chunk=source.loadedChunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));if(chunk==null||!chunks.observe(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16),chunk))throw new IllegalStateException("Undo chunk unloaded/replaced; no load");var fact=source.read(p);if(!frame())throw new IllegalStateException("Undo epoch changed during read");return fact;
    }
    private WorldPatchUndoJournal.Disposition preservation(WorldPatchCompiler.Write write){
        var p=write.position();var target=read(p);if(target==null||target.blockEntity()||!target.state().equals(write.before()))return WorldPatchUndoJournal.Disposition.PRESERVED_TARGET;
        for(int axis=0;axis<3;axis++)for(int side:new int[]{-1,1}){int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=side;var point=new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]);var original=Objects.requireNonNull(guards.get(point));var actual=read(point);if(actual==null||actual.blockEntity()!=original.blockEntity()||!actual.state().equals(expected.getOrDefault(point,original.before())))return WorldPatchUndoJournal.Disposition.PRESERVED_NEIGHBOR;}return null;
    }
    Progress step(){
        if(terminal())return progress();long started=clock.getAsLong();steps++;int work=0;
        try{
            source.beginStep();if(Set.of(State.WAIT_INTENT,State.WAIT_RECEIPT,State.WAIT_OUTCOME,State.WAIT_AMBIGUITY).contains(state)){acknowledge();return progress();}
            if(state==State.READY){if(cancelled)seal(WorldPatchJournal.Outcome.CANCELLED);else if(!frame())seal(WorldPatchJournal.Outcome.CONFLICT);else if(evaluated.size()==writes.size())seal(WorldPatchJournal.Outcome.COMPLETED);else waitFor(log.intent(),State.WAIT_INTENT);return progress();}
            if(state!=State.APPLYING)throw new IllegalStateException("Unexpected undo state");
            while(batch.size()<intent.writes().size()&&work<maximumEntries&&clock.getAsLong()-started<maximumNanos){
                if(cancelled){receipt(WorldPatchJournal.ReceiptState.CANCELLED);break;}if(!frame()){reason="撤销期间环境/权限变化，停止后续改动";receipt(WorldPatchJournal.ReceiptState.CONFLICT);break;}
                var w=intent.writes().get(batch.size());WorldPatchUndoJournal.Disposition keep;
                try{keep=preservation(w);}catch(Exception e){reason="撤销读取冲突："+e.getMessage();receipt(WorldPatchJournal.ReceiptState.CONFLICT);break;}
                if(keep==null){
                    try{boolean changed=source.set(w);var actual=source.read(w.position());var f=source.frame();
                        if(!changed&&actual!=null&&!actual.blockEntity()&&actual.state().equals(w.before())&&frame()){reason="撤销 set 明确拒绝";receipt(WorldPatchJournal.ReceiptState.CONFLICT);break;}
                        var world=selection.world();if(!changed||actual==null||actual.blockEntity()||!actual.state().equals(w.after())||!f.creativeHost()||!world.worldId().equals(f.worldId())||!world.dimension().equals(f.dimension())||selection.revision()!=f.selectionRevision()||f.contextRevision()!=revision+1){uncertain("撤销写入或自写版本回执不确定；保留未决 intent");break;}
                        revision=f.contextRevision();expected.put(w.position(),w.after());keep=WorldPatchUndoJournal.Disposition.RESTORED;restored++;
                    }catch(Exception e){uncertain("撤销异常可能已改动世界："+e.getMessage());break;}
                }
                var row=new WorldPatchUndoJournal.Entry(w,keep);batch.add(row);evaluated.add(row);work++;
            }
            if(state==State.APPLYING&&batch.size()==intent.writes().size())receipt(WorldPatchJournal.ReceiptState.COMPLETE);
        }catch(Exception e){if(intent!=null&&state==State.APPLYING){try{uncertain("撤销执行异常："+e.getMessage());}catch(Exception second){review("撤销日志无法确认："+second.getMessage());}}else review("撤销无法继续："+e.getMessage());}
        finally{maxEntriesPerStep=Math.max(maxEntriesPerStep,work);maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
}
