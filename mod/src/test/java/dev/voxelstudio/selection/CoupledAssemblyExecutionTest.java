package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.lang.reflect.Modifier;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic Source only. Completion is not installed-game/physics evidence. */
final class CoupledAssemblyExecutionTest {
    @TempDir Path temp;
    private static final class Clock implements LongSupplier{long now;public long getAsLong(){return now+=100;}}
    private static final class Queue implements Executor{final ArrayDeque<Runnable> work=new ArrayDeque<>();boolean worker;public void execute(Runnable r){work.add(r);}void pump(){while(!work.isEmpty()){worker=true;try{work.remove().run();}finally{worker=false;}}}}
    private static final class Memory implements CoupledAssemblyExecution.Source {
        final CoupledAssemblyJournal.Plan plan;final Queue queue;final Map<SelectionRegion.Point,SelectionScan.BlockFact> changed=new HashMap<>();final Map<List<Integer>,Object> chunks=new HashMap<>();final List<WorldPatchCompiler.Write> attempts=new ArrayList<>();
        long revision;boolean host=true,unloaded,replaced,support=true,afterSupport=true,failUpper,throwAfterUpper,denyLower,extraRevision;Runnable lower=()->{};
        Memory(CoupledAssemblyJournal.Plan p,Queue q){plan=p;queue=q;revision=p.binding().contextRevision();}
        private void thread(){assertFalse(queue.worker,"World calls on disk worker");}
        public void beginStep(){thread();}public CoupledAssemblyExecution.Frame frame(){thread();var s=plan.binding().selection();return new CoupledAssemblyExecution.Frame(s.world().worldId(),s.world().dimension(),s.revision(),revision,host);}
        public Object loadedChunk(int x,int z){thread();return unloaded?null:replaced?new Object():chunks.computeIfAbsent(List.of(x,z),k->new Object());}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){thread();return changed.getOrDefault(p,plan.compiled().baseline().at(p));}
        public boolean verifyGroup(List<WorldPatchCompiler.Write> g,boolean after){thread();return after?afterSupport:support;}
        public boolean set(WorldPatchCompiler.Write w){
            thread();attempts.add(w);assertEquals(w.before(),read(w.position()).state());assertFalse(plan.binding().selection().protectedAt(w.position()));
            if(failUpper&&w.after().contains("half=upper"))throw new IllegalStateException("synthetic failure before upper write");
            if(denyLower&&w.after().contains("half=lower"))return false;
            changed.put(w.position(),new SelectionScan.BlockFact(w.after(),false));revision++;if(extraRevision)revision++;
            if(w.after().contains("half=lower"))lower.run();if(throwAfterUpper&&w.after().contains("half=upper"))throw new IllegalStateException("synthetic failure after upper write");return true;
        }
    }
    private record Running(CoupledAssemblyJournal.Live live,Queue queue,Clock clock,Memory memory,CoupledAssemblyExecution.Disk disk,CoupledAssemblyExecution engine){}
    private Running running(String name,int budget)throws Exception{var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan(name));var queue=new Queue();var clock=new Clock();var memory=new Memory(live.plan(),queue);var disk=new CoupledAssemblyExecution.Disk(live,queue);return new Running(live,queue,clock,memory,disk,new CoupledAssemblyExecution(disk,memory,budget,2_000_000,clock));}
    private boolean terminal(CoupledAssemblyExecution.State s){return Set.of(CoupledAssemblyExecution.State.COMPLETED,CoupledAssemblyExecution.State.CANCELLED,CoupledAssemblyExecution.State.CONFLICT,CoupledAssemblyExecution.State.REVIEW_REQUIRED).contains(s);}
    private void finish(Running r){for(int i=0;i<10000&&!terminal(r.engine.progress().state());i++){r.engine.step();r.queue.pump();}assertTrue(terminal(r.engine.progress().state()),r.engine.progress().toString());}
    private void applying(Running r){r.engine.step();assertEquals(CoupledAssemblyExecution.State.WAIT_INTENT,r.engine.progress().state());assertTrue(r.memory.attempts.isEmpty());r.queue.pump();r.engine.step();assertEquals(CoupledAssemblyExecution.State.APPLYING,r.engine.progress().state());assertTrue(r.memory.attempts.isEmpty());}
    @Test void twoWriteBudgetDefersWholeDoorInsteadOfSplittingItAcrossSteps()throws Exception{
        var r=running("complete-new-door",2);applying(r);r.engine.step();assertEquals(1,r.memory.attempts.size());assertEquals(1,r.engine.progress().confirmedWrites());r.engine.step();assertEquals(3,r.memory.attempts.size());assertEquals(3,r.engine.progress().confirmedWrites());finish(r);
        assertEquals(CoupledAssemblyExecution.State.COMPLETED,r.engine.progress().state());assertEquals(2,r.engine.progress().maximumWritesPerStep());assertFalse(CoupledAssemblyJournal.inspect(r.live.directory()).needsReview());
    }
    @Test void cancellationTriggeredAfterLowerStillCompletesUpperInSameSynchronousGroup()throws Exception{
        var r=running("complete-new-door",64);r.memory.lower=r.engine::cancel;finish(r);assertEquals(CoupledAssemblyExecution.State.CANCELLED,r.engine.progress().state());assertEquals(3,r.memory.attempts.size());assertEquals(3,r.engine.confirmedGroupsPrefix().size());
        var review=CoupledAssemblyJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(2,review.confirmedGroups());
    }
    @Test void upperFailureBeforeOrAfterMutationNeverAcknowledgesOrAutomaticallyRetriesHalfGroup()throws Exception{
        for(int kind=0;kind<2;kind++){var r=running("complete-new-door",64);r.memory.failUpper=kind==0;r.memory.throwAfterUpper=kind==1;finish(r);assertEquals(CoupledAssemblyExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(3,r.memory.attempts.size());assertEquals(1,r.engine.progress().confirmedWrites());var review=CoupledAssemblyJournal.inspect(r.live.directory());assertTrue(review.needsReview());assertTrue(review.confirmed().isEmpty());assertFalse(Files.exists(r.live.directory().resolve("outcome.json")));r.engine.step();assertEquals(3,r.memory.attempts.size());}
    }
    @Test void silentPlayerEditToUpperBeforeItsGroupPreservesBothOriginalDoorCells()throws Exception{
        var r=running("complete-new-door",2);applying(r);r.engine.step();var upper=r.live.plan().compiled().writes().stream().filter(w->w.after().contains("half=upper")).findFirst().orElseThrow();r.memory.changed.put(upper.position(),new SelectionScan.BlockFact("minecraft:diamond_block",false));finish(r);
        assertEquals(CoupledAssemblyExecution.State.CONFLICT,r.engine.progress().state());assertEquals(1,r.memory.attempts.size());assertEquals("minecraft:diamond_block",r.memory.read(upper.position()).state());var review=CoupledAssemblyJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1,review.confirmed().size());
    }
    @Test void rejectedLowerCanSealOnlyPriorSupportGroupAndNeverCreatesUpper()throws Exception{
        var r=running("complete-new-door",64);r.memory.denyLower=true;finish(r);assertEquals(CoupledAssemblyExecution.State.CONFLICT,r.engine.progress().state());assertEquals(2,r.memory.attempts.size());var review=CoupledAssemblyJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1,review.confirmedGroups());assertEquals(1,review.confirmed().size());
    }
    @Test void nativeSupportFailureBeforeMutationAndAfterMutationHaveDifferentSafeOutcomes()throws Exception{
        var before=running("complete-new-door",64);before.memory.support=false;finish(before);assertEquals(CoupledAssemblyExecution.State.CONFLICT,before.engine.progress().state());assertTrue(before.memory.attempts.isEmpty());assertFalse(CoupledAssemblyJournal.inspect(before.live.directory()).needsReview());
        var after=running("complete-new-door",64);after.memory.afterSupport=false;finish(after);assertEquals(CoupledAssemblyExecution.State.REVIEW_REQUIRED,after.engine.progress().state());assertEquals(1,after.memory.attempts.size());assertTrue(after.engine.confirmedGroupsPrefix().isEmpty());assertTrue(CoupledAssemblyJournal.inspect(after.live.directory()).needsReview());
    }
    @Test void lostHostCoverageChunkIdentityOrExtraRevisionCannotPassAsSuccessfulWrites()throws Exception{
        for(int kind=0;kind<4;kind++){var r=running("complete-new-door",64);applying(r);switch(kind){case 0->r.memory.host=false;case 1->r.memory.unloaded=true;case 2->r.memory.replaced=true;case 3->r.memory.extraRevision=true;}finish(r);assertEquals(kind==3?CoupledAssemblyExecution.State.REVIEW_REQUIRED:CoupledAssemblyExecution.State.CONFLICT,r.engine.progress().state());assertEquals(kind==3?1:0,r.memory.attempts.size());}
    }
    @Test void originalTransportBoundaryUsesOneEngineAndNoDuplicatedOrMissingWrites()throws Exception{
        var r=running("door-crosses-8192",64);finish(r);assertEquals(CoupledAssemblyExecution.State.COMPLETED,r.engine.progress().state());assertEquals(r.live.plan().binding().totalWrites(),r.memory.attempts.size());assertEquals(r.memory.attempts.size(),new HashSet<>(r.memory.attempts).size());
        int lower=-1,upper=-1;for(int i=0;i<r.memory.attempts.size();i++){if(r.memory.attempts.get(i).after().contains("half=lower"))lower=i;if(r.memory.attempts.get(i).after().contains("half=upper"))upper=i;}assertEquals(lower+1,upper);var review=CoupledAssemblyJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(r.engine.confirmedGroupsPrefix(),review.confirmed());
    }
    @Test void timeoutAndLateOriginalIntentNeverResumeOrResendUnknownDiskWork()throws Exception{
        var r=running("complete-new-door",64);var pending=new CompletableFuture<CoupledAssemblyJournal.Intent>();int[] calls={0};
        var log=new CoupledAssemblyExecution.Log(){public CoupledAssemblyJournal.Plan plan(){return r.live.plan();}public CompletableFuture<CoupledAssemblyJournal.Intent> intent(){calls[0]++;return pending;}public CompletableFuture<Void> applied(CoupledAssemblyJournal.Intent i,List<WorldPatchCompiler.Write> p,CoupledAssemblyJournal.ReceiptState s){return r.disk.applied(i,p,s);}public CompletableFuture<Void> finish(CoupledAssemblyJournal.Outcome o){return r.disk.finish(o);}public CompletableFuture<Void> ambiguous(CoupledAssemblyJournal.Intent i,String s){return r.disk.ambiguous(i,s);}};
        var engine=new CoupledAssemblyExecution(log,r.memory,64,2_000_000,r.clock);engine.step();r.clock.now+=CoupledAssemblyExecution.WAIT_TIMEOUT_NANOS;engine.step();assertEquals(CoupledAssemblyExecution.State.REVIEW_REQUIRED,engine.progress().state());pending.complete(r.live.intent());engine.step();assertEquals(1,calls[0]);assertTrue(r.memory.attempts.isEmpty());assertTrue(CoupledAssemblyJournal.inspect(r.live.directory()).needsReview());
    }
    @Test void impossibleSingleWriteBudgetIsRejectedRatherThanQuietlyExceeded()throws Exception{
        var r=running("complete-new-door",64);assertThrows(IllegalArgumentException.class,()->new CoupledAssemblyExecution(r.disk,r.memory,1,2_000_000,r.clock));assertThrows(IllegalArgumentException.class,()->new CoupledAssemblyExecution(r.disk,r.memory,129,2_000_000,r.clock));assertFalse(r.engine.progress().canAuthorizePlacement());assertFalse(r.engine.progress().worldDurabilityVerified());
    }
    @Test void onlyClosedOriginalLiveEngineCanIssueOneUseWholeGroupUndoWitness()throws Exception{
        var r=running("complete-new-door",64);assertThrows(IllegalStateException.class,r.engine::undoOrigin);finish(r);var undo=r.engine.undoOrigin();assertSame(undo,r.engine.undoOrigin());assertEquals(2,undo.groups());assertEquals(r.engine.confirmedGroupsPrefix(),undo.prefix());assertSame(r.live.plan(),undo.plan());undo.sealed().verify();assertFalse(undo.canAuthorizePlacement());undo.claim();assertThrows(IllegalStateException.class,undo::claim);
        for(var c:CoupledAssemblyExecution.UndoOrigin.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));
    }
    @Test void cancelledOrConflictingPrefixWitnessNeverContainsOneDoorHalf()throws Exception{
        var r=running("complete-new-door",2);applying(r);r.engine.step();r.engine.cancel();finish(r);var undo=r.engine.undoOrigin();assertEquals(1,undo.groups());assertEquals(1,undo.prefix().size());assertEquals("minecraft:stone",undo.prefix().get(0).after());undo.sealed().verify();
        var conflict=running("complete-new-door",64);conflict.memory.denyLower=true;finish(conflict);assertEquals(1,conflict.engine.undoOrigin().prefix().size());assertEquals(1,conflict.engine.undoOrigin().groups());
    }
    @Test void partialOrCompleteDoorMutationWithUnknownReceiptCannotIssueUndoOrigin()throws Exception{
        for(int kind=0;kind<2;kind++){var r=running("complete-new-door",64);r.memory.failUpper=kind==0;r.memory.throwAfterUpper=kind==1;finish(r);assertEquals(CoupledAssemblyExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertThrows(IllegalStateException.class,r.engine::undoOrigin);}
    }
    @Test void cancellationWhileOriginalIntentIsPendingWaitsForThatExactResultAndWritesNothing()throws Exception{
        var r=running("complete-new-door",64);r.engine.step();r.engine.cancel();r.engine.step();assertEquals(CoupledAssemblyExecution.State.WAIT_INTENT,r.engine.progress().state());assertTrue(r.memory.attempts.isEmpty());r.queue.pump();finish(r);
        assertEquals(CoupledAssemblyExecution.State.CANCELLED,r.engine.progress().state());assertTrue(r.memory.attempts.isEmpty());var review=CoupledAssemblyJournal.inspect(r.live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1,review.intentBatches());assertEquals(0,review.confirmedGroups());assertThrows(IllegalStateException.class,r.engine::undoOrigin);
    }
}
