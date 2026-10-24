package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static dev.voxelstudio.selection.CoupledAssemblyUndoTestFixtures.*;

final class CoupledAssemblyUndoExecutionTest {
    @TempDir Path temp;
    @Test void completeDoorUndoUsesSameStepUpperThenLowerAndRestoresOriginalBaseline()throws Exception{
        var r=undo(temp,"complete-new-door",2);applying(r);r.engine().step();assertEquals(2,r.forward().memory().attempts.size());assertTrue(r.forward().memory().attempts.get(0).before().contains("half=upper"));assertTrue(r.forward().memory().attempts.get(1).before().contains("half=lower"));finish(r);assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());assertEquals(3,r.engine().progress().restored());assertEquals(2,r.engine().progress().maximumEntriesPerStep());for(var w:r.forward().live().plan().compiled().writes())assertEquals(w.before(),r.forward().memory().read(w.position()).state());assertFalse(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());assertFalse(r.engine().progress().canAuthorizePlacement());assertFalse(r.engine().progress().worldDurabilityVerified());
    }
    @Test void eitherChangedHalfPreservesBothDoorMembersAndTheirWrittenSupport()throws Exception{
        for(var half:List.of("lower","upper")){var r=undo(temp,"complete-new-door",64);r.forward().memory().editDoorHalf(half);finish(r);assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());assertTrue(r.forward().memory().attempts.isEmpty());var review=CoupledAssemblyUndoJournal.inspect(r.live().directory());assertFalse(review.needsReview(),review.issue());assertEquals(3,review.evaluated().size());assertEquals(CoupledAssemblyUndoJournal.Disposition.PRESERVED_TARGET,review.evaluated().get(0).disposition());assertEquals(review.evaluated().get(0).disposition(),review.evaluated().get(1).disposition());assertEquals(CoupledAssemblyUndoJournal.Disposition.PRESERVED_DEPENDENCY,review.evaluated().get(2).disposition());}
    }
    @Test void cancellationTriggeredAfterUpperDoesNotSplitInverseDoor()throws Exception{
        var r=undo(temp,"complete-new-door",64);r.forward().memory().upper=r.engine()::cancel;finish(r);assertEquals(CoupledAssemblyUndoExecution.State.CANCELLED,r.engine().progress().state());assertEquals(2,r.forward().memory().attempts.size());assertEquals(2,r.engine().progress().evaluatedWrites());assertEquals(1,r.engine().progress().evaluatedGroups());assertFalse(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());
    }
    @Test void changedNeighborPreservesWholePairAndItsSupportWithoutAdoptingNewBefore()throws Exception{
        var r=undo(temp,"complete-new-door",64);var upper=r.live().plan().writes().get(0).position();var point=new SelectionRegion.Point(upper.x()+1,upper.y(),upper.z());r.forward().memory().changed.put(point,new SelectionScan.BlockFact("minecraft:diamond_block",false));finish(r);assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());assertTrue(r.forward().memory().attempts.isEmpty());var review=CoupledAssemblyUndoJournal.inspect(r.live().directory());assertFalse(review.needsReview(),review.issue());assertEquals(CoupledAssemblyUndoJournal.Disposition.PRESERVED_NEIGHBOR,review.evaluated().get(0).disposition());assertEquals(CoupledAssemblyUndoJournal.Disposition.PRESERVED_NEIGHBOR,review.evaluated().get(1).disposition());assertEquals(CoupledAssemblyUndoJournal.Disposition.PRESERVED_DEPENDENCY,review.evaluated().get(2).disposition());
    }
    @Test void clockBoundaryAfterUpperStillCompletesLowerBeforeReturning()throws Exception{
        var r=undo(temp,"complete-new-door",64);r.forward().memory().upper=()->r.forward().clock().now+=3_000_000;applying(r);r.engine().step();assertEquals(2,r.forward().memory().attempts.size());assertEquals(2,r.engine().progress().evaluatedWrites());finish(r);assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());assertEquals(3,r.engine().progress().restored());
    }
    @Test void completeInverseAcrossNativeAndDiskBoundariesHasNoDuplicateOrMissingWrites()throws Exception{
        var r=undo(temp,"door-crosses-8192",64);finish(r);assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());assertEquals(r.live().plan().writes().size(),r.forward().memory().attempts.size());assertEquals(r.forward().memory().attempts.size(),new HashSet<>(r.forward().memory().attempts).size());var review=CoupledAssemblyUndoJournal.inspect(r.live().directory());assertFalse(review.needsReview(),review.issue());assertEquals(r.live().plan().groups().size(),review.evaluatedGroups());assertEquals(r.live().plan().writes().size(),r.engine().progress().restored());
    }
    @Test void secondInverseMemberThrowFalseOrPostMutationThrowLeavesWholeIntentUnknown()throws Exception{
        for(int kind=0;kind<3;kind++){var r=undo(temp,"complete-new-door",64);r.forward().memory().failLower=kind==0;r.forward().memory().denyLower=kind==1;r.forward().memory().throwAfterLower=kind==2;finish(r);assertEquals(CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED,r.engine().progress().state());assertEquals(2,r.forward().memory().attempts.size());assertEquals(0,r.engine().progress().evaluatedWrites());assertTrue(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());assertFalse(Files.exists(r.live().directory().resolve("outcome.json")));r.engine().step();assertEquals(2,r.forward().memory().attempts.size());}
    }
    @Test void firstClearlyRejectedInverseMemberDoesNotWriteTheOtherHalf()throws Exception{
        var r=undo(temp,"complete-new-door",64);r.forward().memory().denyUpper=true;finish(r);assertEquals(CoupledAssemblyUndoExecution.State.CONFLICT,r.engine().progress().state());assertEquals(1,r.forward().memory().attempts.size());assertEquals(0,r.engine().progress().evaluatedWrites());assertFalse(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());
    }
    @Test void nativePreflightAndFinalGroupFailureStayDistinctFromSuccessfulInverse()throws Exception{
        var before=undo(temp,"complete-new-door",64);before.forward().memory().support=false;finish(before);assertEquals(CoupledAssemblyUndoExecution.State.CONFLICT,before.engine().progress().state());assertTrue(before.forward().memory().attempts.isEmpty());assertFalse(CoupledAssemblyUndoJournal.inspect(before.live().directory()).needsReview());
        var after=undo(temp,"complete-new-door",64);after.forward().memory().afterSupport=false;finish(after);assertEquals(CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED,after.engine().progress().state());assertEquals(2,after.forward().memory().attempts.size());assertTrue(CoupledAssemblyUndoJournal.inspect(after.live().directory()).needsReview());
    }
    @Test void pendingCancelWaitsOriginalIntentAndNeverMutatesTheWorld()throws Exception{
        var r=undo(temp,"complete-new-door",64);r.engine().step();r.engine().cancel();r.engine().step();assertEquals(CoupledAssemblyUndoExecution.State.WAIT_INTENT,r.engine().progress().state());r.forward().queue().pump();finish(r);assertEquals(CoupledAssemblyUndoExecution.State.CANCELLED,r.engine().progress().state());assertTrue(r.forward().memory().attempts.isEmpty());assertFalse(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());
    }
    @Test void unknownIntentTimeoutAndLateResultNeverResumeOrResend()throws Exception{
        var r=undo(temp,"complete-new-door",64);var pending=new CompletableFuture<CoupledAssemblyUndoJournal.Intent>();int[] calls={0};var log=new CoupledAssemblyUndoExecution.Log(){public CoupledAssemblyUndoJournal.Plan plan(){return r.live().plan();}public CompletableFuture<CoupledAssemblyUndoJournal.Intent> intent(){calls[0]++;return pending;}public CompletableFuture<Void> evaluated(CoupledAssemblyUndoJournal.Intent i,List<CoupledAssemblyUndoJournal.Entry> e,CoupledAssemblyJournal.ReceiptState s){return r.disk().evaluated(i,e,s);}public CompletableFuture<Void> finish(CoupledAssemblyJournal.Outcome o){return r.disk().finish(o);}public CompletableFuture<Void> ambiguous(CoupledAssemblyUndoJournal.Intent i,String s){return r.disk().ambiguous(i,s);}};
        var engine=new CoupledAssemblyUndoExecution(log,r.forward().memory(),64,2_000_000,r.forward().clock());engine.step();r.forward().clock().now+=CoupledAssemblyExecution.WAIT_TIMEOUT_NANOS;engine.step();assertEquals(CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED,engine.progress().state());pending.complete(r.live().intent());engine.step();assertEquals(1,calls[0]);assertTrue(r.forward().memory().attempts.isEmpty());assertTrue(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());
    }
    @Test void lostHostCoverageChunkInstanceOrExtraSelfRevisionCannotPass()throws Exception{
        for(int kind=0;kind<4;kind++){var r=undo(temp,"complete-new-door",64);applying(r);switch(kind){case 0->r.forward().memory().host=false;case 1->r.forward().memory().unloaded=true;case 2->r.forward().memory().replaced=true;case 3->r.forward().memory().extraRevision=true;}finish(r);assertEquals(kind==3?CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED:CoupledAssemblyUndoExecution.State.CONFLICT,r.engine().progress().state());assertEquals(kind==3?1:0,r.forward().memory().attempts.size());}
    }
    @Test void diskWorkerRejectionCannotStartWorldWritesAndOneWriteBudgetIsRejected()throws Exception{
        var r=undo(temp,"complete-new-door",64);Executor reject=work->{throw new RejectedExecutionException("Synthetic queue closed");};var disk=new CoupledAssemblyUndoExecution.Disk(r.live(),reject);var engine=new CoupledAssemblyUndoExecution(disk,r.forward().memory(),64,2_000_000,r.forward().clock());engine.step();engine.step();assertEquals(CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED,engine.progress().state());assertTrue(r.forward().memory().attempts.isEmpty());assertThrows(IllegalArgumentException.class,()->new CoupledAssemblyUndoExecution(r.disk(),r.forward().memory(),1,2_000_000,r.forward().clock()));
    }
    @Test void wholePreservationNotifiesSourceAndNeverInventsNativeWrites()throws Exception{
        var r=undo(temp,"complete-new-door",64);r.forward().memory().editDoorHalf("upper");finish(r);
        assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());assertEquals(2,r.forward().memory().preserved.size());
        assertEquals(2,r.forward().memory().preserved.get(0).size());assertEquals(1,r.forward().memory().preserved.get(1).size());assertTrue(r.forward().memory().attempts.isEmpty());
    }
    @Test void rejectedPreservationStopsBeforeEvaluatingOrRestoringAnyLaterGroup()throws Exception{
        var r=undo(temp,"complete-new-door",64);r.forward().memory().editDoorHalf("upper");r.forward().memory().preserve=false;finish(r);
        assertEquals(CoupledAssemblyUndoExecution.State.CONFLICT,r.engine().progress().state());assertEquals(0,r.engine().progress().evaluatedWrites());
        assertEquals(1,r.forward().memory().preserved.size());assertTrue(r.forward().memory().attempts.isEmpty());assertFalse(CoupledAssemblyUndoJournal.inspect(r.live().directory()).needsReview());
    }
    @Test void originalAfterIndexIsPreparedOffTickAndImmutableWithoutRefreshingEditedTargets()throws Exception{
        var r=undo(temp,"complete-new-door",64);var plan=r.live().plan();var row=plan.writes().get(0);var expected=plan.originalAfter();
        assertEquals(plan.writes().size(),expected.size());assertEquals(row.before(),expected.get(row.position()));assertTrue(plan.fromOriginalOrigin(r.forward().engine().undoOrigin()));
        assertThrows(UnsupportedOperationException.class,()->expected.put(row.position(),"minecraft:diamond_block"));r.forward().memory().editDoorHalf("upper");
        assertSame(expected,plan.originalAfter());assertEquals(row.before(),plan.originalAfter().get(row.position()));finish(r);assertEquals(CoupledAssemblyUndoExecution.State.COMPLETED,r.engine().progress().state());
    }
}
