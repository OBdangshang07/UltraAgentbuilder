package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.lang.reflect.Modifier;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;
import static org.junit.jupiter.api.Assertions.*;

/** Original whole apply/undo ledgers and a synthetic world, never Minecraft
 * writes, game-save durability, a final consent or model acceptance. */
final class AssemblyPatchUndoTest {
    @TempDir Path temp;
    private static final class Clock implements LongSupplier {long now;public long getAsLong(){return now+=100;}}
    private static final class Queue implements Executor {
        final ArrayDeque<Runnable> waiting=new ArrayDeque<>();boolean worker;
        public void execute(Runnable task){waiting.add(task);}void pump(){while(!waiting.isEmpty()){worker=true;try{waiting.remove().run();}finally{worker=false;}}}
    }
    private static final class Memory implements AssemblyPatchExecution.Source {
        final AssemblyPatchJournal.Plan plan;final Queue queue;final Map<SelectionRegion.Point,SelectionScan.BlockFact> changes=new HashMap<>();final Map<List<Integer>,Object> chunks=new HashMap<>();final List<WorldPatchCompiler.Write> sets=new ArrayList<>();
        long revision;boolean host=true,unloaded,replaced,deny,throwAfter,silent,extraChange;String world,dimension;
        Memory(AssemblyPatchJournal.Plan plan,Queue queue){this.plan=plan;this.queue=queue;revision=plan.binding().contextRevision();world=plan.binding().selection().world().worldId();dimension=plan.binding().selection().world().dimension();}
        private void server(){assertFalse(queue.worker,"Whole undo world access on disk worker");}
        public void beginStep(){server();}public AssemblyPatchExecution.Frame frame(){server();return new AssemblyPatchExecution.Frame(world,dimension,plan.binding().selection().revision(),revision,host);}
        public Object loadedChunk(int x,int z){server();return unloaded?null:replaced?new Object():chunks.computeIfAbsent(List.of(x,z),key->new Object());}
        public SelectionScan.BlockFact read(SelectionRegion.Point point){server();return changes.getOrDefault(point,plan.compiled().baseline().at(point));}
        public boolean set(WorldPatchCompiler.Write write){
            server();assertTrue(plan.binding().selection().edit().contains(write.position()));assertFalse(plan.binding().selection().protectedAt(write.position()));assertEquals(write.before(),read(write.position()).state());if(deny)return false;
            sets.add(write);changes.put(write.position(),new SelectionScan.BlockFact(write.after(),false));revision++;if(extraChange)revision++;if(throwAfter)throw new IllegalStateException("synthetic undo post-mutation exception");return !silent;
        }
    }
    private record Applied(AssemblyPatchJournal.Live live,Queue queue,Clock clock,Memory memory,AssemblyPatchExecution engine){}
    private record Undo(Applied original,AssemblyPatchUndoJournal.Live live,AssemblyPatchUndoExecution.Disk disk,AssemblyPatchUndoExecution engine){}
    private Applied applied(String tier,int prefix)throws Exception{
        var fixture=AssemblyPatchFixtures.header(tier);var input=AssemblyPatchFixtures.input(fixture);var compiled=AssemblyPatchCompiler.compile(AssemblyPatchFixtures.baseline(fixture),input,()->false);var binding=input.binding();
        var capture=new SelectionReadService.Capture(binding.captureId(),binding.selection(),binding.contextRevision(),fixture.get("payload").getAsString(),null,false);var plan=AssemblyPatchJournal.prepare(capture,compiled,AssemblyPatchPreview.from(input),UUID.randomUUID());var live=AssemblyPatchJournal.create(temp,plan);var queue=new Queue();var clock=new Clock();var memory=new Memory(plan,queue);var engine=new AssemblyPatchExecution(new AssemblyPatchExecution.Disk(live,queue),memory,prefix>0?1:128,2_000_000,clock);
        for(int step=0;step<10000;step++){engine.step();queue.pump();if(prefix>0&&engine.progress().confirmedWrites()>=prefix)engine.cancel();if(Set.of(AssemblyPatchExecution.State.COMPLETED,AssemblyPatchExecution.State.CANCELLED,AssemblyPatchExecution.State.CONFLICT,AssemblyPatchExecution.State.REVIEW_REQUIRED).contains(engine.progress().state()))break;}
        assertEquals(prefix>0?AssemblyPatchExecution.State.CANCELLED:AssemblyPatchExecution.State.COMPLETED,engine.progress().state());if(prefix>0)assertEquals(prefix,engine.confirmedPrefix().size());return new Applied(live,queue,clock,memory,engine);
    }
    private Undo undo(Applied applied)throws Exception{
        applied.queue.worker=true;AssemblyPatchUndoJournal.Live live;try{live=AssemblyPatchUndoJournal.create(temp,applied.engine.undoOrigin());}finally{applied.queue.worker=false;}
        var disk=new AssemblyPatchUndoExecution.Disk(live,applied.queue);return new Undo(applied,live,disk,new AssemblyPatchUndoExecution(disk,applied.memory,64,2_000_000,applied.clock));
    }
    private void finish(Undo undo){for(int step=0;step<10000;step++){undo.engine.step();undo.original.queue.pump();if(terminal(undo.engine.progress().state()))return;}fail("Whole undo did not terminate");}
    private boolean terminal(AssemblyPatchUndoExecution.State state){return Set.of(AssemblyPatchUndoExecution.State.COMPLETED,AssemblyPatchUndoExecution.State.CANCELLED,AssemblyPatchUndoExecution.State.CONFLICT,AssemblyPatchUndoExecution.State.REVIEW_REQUIRED).contains(state);}
    private void applying(Undo undo){undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.WAIT_INTENT,undo.engine.progress().state());undo.original.queue.pump();undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.APPLYING,undo.engine.progress().state());}
    @Test void fullSevenPart224MetreUndoRestoresEveryOriginalWriteInReverseOrder()throws Exception{
        var applied=applied("ultra",0);assertEquals(7,applied.live.plan().binding().partHashes().size());assertEquals(54406,applied.engine.confirmedPrefix().size());int before=applied.memory.sets.size();var undo=undo(applied);finish(undo);var progress=undo.engine.progress();
        assertEquals(AssemblyPatchUndoExecution.State.COMPLETED,progress.state());assertEquals(54406,progress.restored());assertEquals(0,progress.preserved());assertEquals(64,progress.maximumEntriesPerStep());assertFalse(progress.canAuthorizePlacement());assertFalse(progress.worldDurabilityVerified());
        var expected=new ArrayList<WorldPatchCompiler.Write>();for(int i=applied.engine.confirmedPrefix().size()-1;i>=0;i--)expected.add(AssemblyPatchUndoJournal.inverse(applied.engine.confirmedPrefix().get(i)));assertEquals(expected,applied.memory.sets.subList(before,applied.memory.sets.size()));
        for(var write:applied.engine.confirmedPrefix())assertEquals(write.before(),applied.memory.read(write.position()).state());var review=AssemblyPatchUndoJournal.inspect(undo.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(54406,review.evaluated().size());assertEquals(applied.live.plan().id(),review.parentId());assertEquals(applied.live.plan().hash(),review.parentPlanHash());assertFalse(review.canAuthorizePlacement());
    }
    @Test void laterTargetEditsAndEntitiesRemainPreservedWithoutRebindingOriginalAfter()throws Exception{
        for(boolean entity:new boolean[]{false,true}){var applied=applied("lite",0);var write=applied.engine.confirmedPrefix().get(applied.engine.confirmedPrefix().size()-1);var later=new SelectionScan.BlockFact(entity?write.after():"minecraft:diamond_block",entity);applied.memory.changes.put(write.position(),later);applied.memory.revision++;
            var undo=undo(applied);finish(undo);assertEquals(AssemblyPatchUndoExecution.State.COMPLETED,undo.engine.progress().state());assertEquals(later,applied.memory.read(write.position()));var review=AssemblyPatchUndoJournal.inspect(undo.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(AssemblyPatchUndoJournal.Disposition.PRESERVED_TARGET,review.evaluated().get(0).disposition());assertTrue(undo.engine.progress().preserved()>0);}
    }
    @Test void changedNeighborIsPreservedAndPreventsUnsafeTargetRestoration()throws Exception{
        var applied=applied("lite",1);var write=applied.engine.confirmedPrefix().get(0);var neighbor=new SelectionRegion.Point(write.position().x(),write.position().y()-1,write.position().z());applied.memory.changes.put(neighbor,new SelectionScan.BlockFact("minecraft:diamond_block",false));applied.memory.revision++;
        var undo=undo(applied);finish(undo);assertEquals(0,undo.engine.progress().restored());assertEquals(1,undo.engine.progress().preserved());assertEquals(write.after(),applied.memory.read(write.position()).state());assertEquals("minecraft:diamond_block",applied.memory.read(neighbor).state());assertEquals(AssemblyPatchUndoJournal.Disposition.PRESERVED_NEIGHBOR,AssemblyPatchUndoJournal.inspect(undo.live.directory()).evaluated().get(0).disposition());
    }
    @Test void cancelledApplyUndoUsesOnlyTheOriginalKnownSealedPrefix()throws Exception{
        var applied=applied("lite",12);var undo=undo(applied);finish(undo);assertEquals(12,undo.engine.progress().total());assertEquals(12,undo.engine.progress().restored());assertEquals(AssemblyPatchUndoExecution.State.COMPLETED,undo.engine.progress().state());assertEquals(12,AssemblyPatchUndoJournal.inspect(undo.live.directory()).evaluated().size());
    }
    @Test void oneUseLiveOriginCannotBeRecreatedFromDiskReviewOrReclaimed()throws Exception{
        var applied=applied("lite",1);var origin=applied.engine.undoOrigin();var undo=undo(applied);assertThrows(IllegalStateException.class,()->AssemblyPatchUndoJournal.create(temp,origin));
        for(var type:List.of(AssemblyPatchUndoJournal.Plan.class,AssemblyPatchUndoJournal.Live.class,AssemblyPatchJournal.Sealed.class))for(var constructor:type.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));assertFalse(WorldPatchExecution.UndoOrigin.class.isInstance(origin));assertFalse(WorldPatchUndoJournal.Plan.class.isInstance(undo.live.plan()));
    }
    @Test void originalArchiveChangesFailClosedBeforeUndoJournalAndKeepOneUseClaim()throws Exception{
        var applied=applied("lite",1);var origin=applied.engine.undoOrigin();var file=applied.live.directory().resolve("outcome.json");Files.writeString(file,"original-corruption-preserved");assertThrows(java.io.IOException.class,()->AssemblyPatchUndoJournal.create(temp,origin));assertThrows(IllegalStateException.class,()->AssemblyPatchUndoJournal.create(temp,origin));assertEquals("original-corruption-preserved",Files.readString(file));
    }
    @Test void parentTamperingBetweenBatchesStopsBeforeAnotherWorldWrite()throws Exception{
        var applied=applied("lite",0);var undo=undo(applied);undo.engine.step();Files.writeString(applied.live.directory().resolve("outcome.json"),"changed-preserved-parent");applied.queue.pump();undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());assertTrue(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void laterChangesDuringUndoStopInsteadOfSilentlyRefreshingEpoch()throws Exception{
        var applied=applied("lite",12);var undo=undo(applied);applying(undo);applied.memory.revision++;finish(undo);assertEquals(AssemblyPatchUndoExecution.State.CONFLICT,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());assertFalse(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void cancelWaitsForOriginalIntentAndSealsZeroEvaluatedWrites()throws Exception{
        var applied=applied("lite",1);var undo=undo(applied);undo.engine.step();undo.engine.cancel();undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.WAIT_INTENT,undo.engine.progress().state());applied.queue.pump();finish(undo);assertEquals(AssemblyPatchUndoExecution.State.CANCELLED,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());assertFalse(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void ambiguousNativeUndoCannotReplayEvenWhenOneMutationActuallyHappened()throws Exception{
        for(int kind=0;kind<3;kind++){var applied=applied("lite",1);var undo=undo(applied);applying(undo);switch(kind){case 0->applied.memory.throwAfter=true;case 1->applied.memory.silent=true;case 2->applied.memory.extraChange=true;}finish(undo);assertEquals(AssemblyPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());assertEquals(0,undo.engine.progress().evaluated());int writes=applied.memory.sets.size();undo.engine.step();assertEquals(writes,applied.memory.sets.size());assertTrue(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());}
    }
    @Test void permissionsDimensionCoverageAndChunkIdentityChangesStopBeforeUndo()throws Exception{
        for(int kind=0;kind<4;kind++){var applied=applied("lite",1);var undo=undo(applied);applying(undo);switch(kind){case 0->applied.memory.host=false;case 1->applied.memory.dimension="minecraft:the_nether";case 2->applied.memory.unloaded=true;case 3->applied.memory.replaced=true;}finish(undo);assertEquals(AssemblyPatchUndoExecution.State.CONFLICT,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());}
    }
    @Test void explicitNoMutationDenialIsConflictNotAmbiguousSuccess()throws Exception{
        var applied=applied("lite",1);var undo=undo(applied);applying(undo);applied.memory.deny=true;finish(undo);assertEquals(AssemblyPatchUndoExecution.State.CONFLICT,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());assertFalse(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void workerRejectionNeverWritesOrRetriesUndoIntent()throws Exception{
        var applied=applied("lite",1);var undo=undo(applied);var calls=new int[]{0};Executor rejected=task->{calls[0]++;throw new RejectedExecutionException("synthetic queue full");};var engine=new AssemblyPatchUndoExecution(new AssemblyPatchUndoExecution.Disk(undo.live,rejected),applied.memory,1,2_000_000,applied.clock);engine.step();engine.step();assertEquals(AssemblyPatchUndoExecution.State.REVIEW_REQUIRED,engine.progress().state());engine.step();assertEquals(1,calls[0]);assertEquals(0,engine.progress().restored());
    }
    @Test void pendingOriginalIntentTimeoutAndLateAcknowledgementNeverResumeOrRetry()throws Exception{
        var applied=applied("lite",1);var undo=undo(applied);undo.engine.step();assertEquals(1,applied.queue.waiting.size());applied.clock.now+=AssemblyPatchExecution.WAIT_TIMEOUT_NANOS;undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());applied.queue.pump();undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());assertEquals(0,applied.queue.waiting.size());assertTrue(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void undoOwnPartialPublicationAndOrphanEventsCannotBecomeReadableSuccess()throws Exception{
        var applied=applied("lite",1);var undo=undo(applied);Path unknown=undo.live.directory().resolve(".pending-original-preserved");Files.writeString(unknown,"preserve");undo.engine.step();applied.queue.pump();undo.engine.step();assertEquals(AssemblyPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());assertEquals(0,undo.engine.progress().restored());assertTrue(AssemblyPatchUndoJournal.inspect(undo.live.directory()).needsReview());assertEquals("preserve",Files.readString(unknown));
    }
    @Test void boundedBudgetsCannotBeEnlarged()throws Exception{
        var applied=applied("lite",1);var undo=undo(applied);assertThrows(IllegalArgumentException.class,()->new AssemblyPatchUndoExecution(undo.disk,applied.memory,129,2_000_000,applied.clock));assertThrows(IllegalArgumentException.class,()->new AssemblyPatchUndoExecution(undo.disk,applied.memory,1,2_000_001,applied.clock));assertThrows(IllegalArgumentException.class,()->new AssemblyPatchUndoExecution(undo.disk,applied.memory,0,1,applied.clock));
    }
}
