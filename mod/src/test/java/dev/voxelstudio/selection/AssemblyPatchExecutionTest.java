package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.lang.reflect.Modifier;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;
import static org.junit.jupiter.api.Assertions.*;

/** Whole typed engine, original disk ledger and a synthetic world only.
 * No live Minecraft writes, physics, visual quality or save durability. */
final class AssemblyPatchExecutionTest {
    @TempDir Path temp;
    private static final class Clock implements LongSupplier {long now;public long getAsLong(){return now+=100;}}
    private static final class Queue implements Executor {
        final ArrayDeque<Runnable> waiting=new ArrayDeque<>();boolean worker;
        public void execute(Runnable work){waiting.add(work);}void pump(){while(!waiting.isEmpty()){worker=true;try{waiting.remove().run();}finally{worker=false;}}}
    }
    private static final class Memory implements AssemblyPatchExecution.Source {
        final AssemblyPatchJournal.Plan plan;final Queue queue;
        final Map<SelectionRegion.Point,SelectionScan.BlockFact> changes=new HashMap<>();final Map<List<Integer>,Object> chunks=new HashMap<>();
        long revision;int sets,reads;boolean host=true,unloaded,replaced,deny,throwAfter,silent,extraChange;String world,dimension;
        Memory(AssemblyPatchJournal.Plan plan,Queue queue){this.plan=plan;this.queue=queue;revision=plan.binding().contextRevision();world=plan.binding().selection().world().worldId();dimension=plan.binding().selection().world().dimension();}
        private void server(){assertFalse(queue.worker,"Whole world access on the disk worker");}
        public void beginStep(){server();}public AssemblyPatchExecution.Frame frame(){server();var selection=plan.binding().selection();return new AssemblyPatchExecution.Frame(world,dimension,selection.revision(),revision,host);}
        public Object loadedChunk(int x,int z){server();return unloaded?null:replaced?new Object():chunks.computeIfAbsent(List.of(x,z),k->new Object());}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){server();reads++;return changes.getOrDefault(p,plan.compiled().baseline().at(p));}
        public boolean set(WorldPatchCompiler.Write write){
            server();sets++;assertTrue(plan.binding().selection().edit().contains(write.position()));assertFalse(plan.binding().selection().protectedAt(write.position()));assertEquals(write.before(),read(write.position()).state());
            if(deny)return false;changes.put(write.position(),new SelectionScan.BlockFact(write.after(),false));revision++;if(extraChange)revision++;if(throwAfter)throw new IllegalStateException("synthetic post-mutation failure");return !silent;
        }
    }
    private record Running(AssemblyPatchJournal.Live live,Queue queue,Clock clock,Memory memory,AssemblyPatchExecution.Disk disk,AssemblyPatchExecution engine){}
    private Running running(String tier,int budget)throws Exception{
        var f=AssemblyPatchFixtures.header(tier);var input=AssemblyPatchFixtures.input(f);var compiled=AssemblyPatchCompiler.compile(AssemblyPatchFixtures.baseline(f),input,()->false);var binding=input.binding();
        var capture=new SelectionReadService.Capture(binding.captureId(),binding.selection(),binding.contextRevision(),f.get("payload").getAsString(),null,false);
        var plan=AssemblyPatchJournal.prepare(capture,compiled,AssemblyPatchPreview.from(input),UUID.randomUUID());var live=AssemblyPatchJournal.create(temp,plan);var queue=new Queue();var clock=new Clock();var memory=new Memory(plan,queue);var disk=new AssemblyPatchExecution.Disk(live,queue);
        return new Running(live,queue,clock,memory,disk,new AssemblyPatchExecution(disk,memory,budget,2_000_000,clock));
    }
    private boolean terminal(AssemblyPatchExecution.State state){return Set.of(AssemblyPatchExecution.State.COMPLETED,AssemblyPatchExecution.State.CANCELLED,AssemblyPatchExecution.State.CONFLICT,AssemblyPatchExecution.State.REVIEW_REQUIRED).contains(state);}
    private void finish(Running running){for(int i=0;i<10000&&!terminal(running.engine.progress().state());i++){running.engine.step();running.queue.pump();}assertTrue(terminal(running.engine.progress().state()),running.engine.progress().toString());}
    private void applying(Running running){running.engine.step();assertEquals(AssemblyPatchExecution.State.WAIT_INTENT,running.engine.progress().state());assertEquals(0,running.memory.sets);running.queue.pump();running.engine.step();assertEquals(AssemblyPatchExecution.State.APPLYING,running.engine.progress().state());assertEquals(0,running.memory.sets);}
    @Test void completeSevenPart224MetreTaskUsesOneTypedEngineAndEveryOriginalWrite()throws Exception{
        var r=running("ultra",64);finish(r);var progress=r.engine.progress();assertEquals(AssemblyPatchExecution.State.COMPLETED,progress.state());assertEquals(54406,r.memory.sets);assertEquals(54406,r.engine.confirmedPrefix().size());assertEquals(64,progress.maximumWritesPerStep());assertTrue(progress.steps()>850);
        var review=AssemblyPatchJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(r.engine.confirmedPrefix(),review.confirmed());assertEquals(107,review.intentBatches());assertEquals(7,review.binding().partHashes().size());assertEquals(r.live.plan().binding(),review.binding());assertFalse(progress.canAuthorizePlacement());assertFalse(progress.worldDurabilityVerified());
        var undo=r.engine.undoOrigin();assertSame(undo,r.engine.undoOrigin());assertEquals(r.engine.confirmedPrefix(),undo.prefix());assertSame(r.live.plan(),undo.plan());assertEquals(r.live.directory(),undo.archive());assertFalse(undo.canAuthorizePlacement());undo.claim();assertThrows(IllegalStateException.class,undo::claim);
    }
    @Test void cancellationWaitsForOriginalPendingIntentAndClosesZeroKnownWrites()throws Exception{
        var r=running("lite",1);r.engine.step();r.engine.cancel();r.engine.step();assertEquals(AssemblyPatchExecution.State.WAIT_INTENT,r.engine.progress().state());assertEquals(0,r.memory.sets);r.queue.pump();finish(r);
        assertEquals(AssemblyPatchExecution.State.CANCELLED,r.engine.progress().state());assertEquals(0,r.memory.sets);var review=AssemblyPatchJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1,review.intentBatches());assertThrows(IllegalStateException.class,r.engine::undoOrigin);
    }
    @Test void playerEditBetweenTicksIsPreservedAndClosesOnlyKnownWholePrefix()throws Exception{
        var r=running("lite",1);applying(r);r.engine.step();assertEquals(1,r.memory.sets);var next=r.live.plan().compiled().writes().get(1).position();r.memory.changes.put(next,new SelectionScan.BlockFact("minecraft:diamond_block",false));r.memory.revision++;finish(r);
        assertEquals(AssemblyPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(1,r.memory.sets);assertEquals("minecraft:diamond_block",r.memory.read(next).state());var review=AssemblyPatchJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1,review.confirmed().size());assertEquals(review.confirmed(),r.engine.undoOrigin().prefix());
    }
    @Test void originalNeighborFactsAreCheckedWithoutTrustingRevisionNotifications()throws Exception{
        var r=running("lite",1);applying(r);var p=r.live.plan().compiled().writes().get(0).position();var neighbor=new SelectionRegion.Point(p.x(),p.y()-1,p.z());r.memory.changes.put(neighbor,new SelectionScan.BlockFact("minecraft:diamond_block",false));finish(r);
        assertEquals(AssemblyPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(0,r.memory.sets);assertEquals("minecraft:diamond_block",r.memory.read(neighbor).state());assertFalse(AssemblyPatchJournal.inspect(r.live.directory()).needsReview());
    }
    @Test void changedWorldDimensionPermissionsCoverageOrChunkInstanceStopsBeforeMutation()throws Exception{
        for(int kind=0;kind<5;kind++){var r=running("lite",1);applying(r);switch(kind){case 0->r.memory.world="changed_synthetic_world";case 1->r.memory.dimension="minecraft:the_nether";case 2->r.memory.host=false;case 3->r.memory.unloaded=true;case 4->r.memory.replaced=true;}
            finish(r);assertEquals(AssemblyPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(0,r.memory.sets);assertFalse(AssemblyPatchJournal.inspect(r.live.directory()).needsReview());}
    }
    @Test void postMutationExceptionSilentFailureAndUnexpectedRevisionRemainAmbiguous()throws Exception{
        for(int kind=0;kind<3;kind++){var r=running("lite",1);applying(r);switch(kind){case 0->r.memory.throwAfter=true;case 1->r.memory.silent=true;case 2->r.memory.extraChange=true;}
            finish(r);assertEquals(AssemblyPatchExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(1,r.memory.sets);assertTrue(r.engine.confirmedPrefix().isEmpty());assertThrows(IllegalStateException.class,r.engine::undoOrigin);assertTrue(AssemblyPatchJournal.inspect(r.live.directory()).needsReview());
            r.engine.step();assertEquals(1,r.memory.sets);}
    }
    @Test void explicitNoMutationDenialClosesConflictRatherThanGuessingSuccess()throws Exception{
        var r=running("lite",1);applying(r);r.memory.deny=true;finish(r);assertEquals(AssemblyPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(1,r.memory.sets);assertTrue(r.engine.confirmedPrefix().isEmpty());assertFalse(AssemblyPatchJournal.inspect(r.live.directory()).needsReview());
    }
    @Test void uncertainDiskTimeoutNeverResendsAndLateOriginalReceiptCannotResume()throws Exception{
        var r=running("lite",1);var pending=new CompletableFuture<AssemblyPatchJournal.Intent>();var sends=new int[]{0};
        var log=new AssemblyPatchExecution.Log(){public AssemblyPatchJournal.Plan plan(){return r.live.plan();}public Path archive(){return r.live.directory();}
            public CompletableFuture<AssemblyPatchJournal.Intent> intent(){sends[0]++;return pending;}public CompletableFuture<Void> applied(AssemblyPatchJournal.Intent i,List<WorldPatchCompiler.Write> p,AssemblyPatchJournal.ReceiptState s){return r.disk.applied(i,p,s);}public CompletableFuture<Void> finish(AssemblyPatchJournal.Outcome o){return r.disk.finish(o);}public CompletableFuture<Void> ambiguous(AssemblyPatchJournal.Intent i,String reason){return r.disk.ambiguous(i,reason);}};
        var engine=new AssemblyPatchExecution(log,r.memory,1,2_000_000,r.clock);engine.step();r.clock.now+=AssemblyPatchExecution.WAIT_TIMEOUT_NANOS;engine.step();assertEquals(AssemblyPatchExecution.State.REVIEW_REQUIRED,engine.progress().state());assertEquals(1,sends[0]);assertEquals(0,r.memory.sets);
        pending.complete(r.live.intent(512));engine.step();assertEquals(1,sends[0]);assertEquals(0,r.memory.sets);assertThrows(IllegalStateException.class,engine::undoOrigin);
    }
    @Test void boundedWorkerRejectionDoesNotAccessWorldOrRetryOriginalLog()throws Exception{
        var r=running("lite",1);var calls=new int[]{0};Executor rejecting=operation->{calls[0]++;throw new RejectedExecutionException("synthetic full queue");};var engine=new AssemblyPatchExecution(new AssemblyPatchExecution.Disk(r.live,rejecting),r.memory,1,2_000_000,r.clock);
        engine.step();engine.step();assertEquals(AssemblyPatchExecution.State.REVIEW_REQUIRED,engine.progress().state());assertEquals(1,calls[0]);assertEquals(0,r.memory.sets);engine.step();assertEquals(1,calls[0]);
    }
    @Test void tickBudgetCannotBeEnlargedAndWholeUndoCannotBecomeLegacyOrigin()throws Exception{
        var r=running("lite",1);assertThrows(IllegalArgumentException.class,()->new AssemblyPatchExecution(r.disk,r.memory,129,2_000_000,r.clock));assertThrows(IllegalArgumentException.class,()->new AssemblyPatchExecution(r.disk,r.memory,1,2_000_001,r.clock));
        for(var constructor:AssemblyPatchExecution.UndoOrigin.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));assertFalse(WorldPatchExecution.UndoOrigin.class.isAssignableFrom(AssemblyPatchExecution.UndoOrigin.class));
    }
}
