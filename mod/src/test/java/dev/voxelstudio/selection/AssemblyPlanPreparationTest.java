package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic clocks/runnables only. No game, disk writes or consent. */
final class AssemblyPlanPreparationTest {
    private static final class Queue implements Executor {
        final ArrayDeque<Runnable> items=new ArrayDeque<>();
        public void execute(Runnable work){items.add(work);}
        void run(){items.remove().run();}
    }
    @Test void measuredFortyOneSecondOriginalPreparationIsNotADiskReceiptTimeout(){
        var time=new AtomicLong();var queue=new Queue();
        var original=AssemblyPlanPreparation.start(queue,time::get,cancelled->{time.set(41_041_000_000L);assertFalse(cancelled.getAsBoolean());return "complete original";});
        time.set(31_000_000_000L);assertDoesNotThrow(original::check);assertFalse(original.closed());queue.run();
        assertTrue(original.closed());assertEquals("complete original",original.value());
        assertEquals(30_000_000_000L,AssemblyPatchExecution.WAIT_TIMEOUT_NANOS);
        assertEquals(45_000_000_000L,AssemblyPatchConsent.TTL_NANOS);
    }
    @Test void actualDeadlineRejectsAnUncooperativeLateResultAndWaitsForOriginalClosure(){
        var time=new AtomicLong();var queue=new Queue();
        var original=AssemblyPlanPreparation.start(queue,time::get,cancelled->{time.set(AssemblyPlanPreparation.BUDGET_NANOS);assertTrue(cancelled.getAsBoolean());return "late result";});
        assertFalse(original.closed());queue.run();assertTrue(original.closed());
        assertThrows(IllegalStateException.class,original::value);
    }
    @Test void cancellationIsNotClosureAndLateOriginalCannotReplaceANewOwner(){
        var time=new AtomicLong();var queue=new Queue();var invoked=new AtomicLong();
        var old=AssemblyPlanPreparation.start(queue,time::get,cancelled->{invoked.incrementAndGet();return "old";});
        old.cancel();assertFalse(old.closed());assertThrows(CancellationException.class,old::check);
        queue.run();assertTrue(old.closed());assertEquals(0,invoked.get());assertThrows(CancellationException.class,old::value);
        var fresh=AssemblyPlanPreparation.start(queue,time::get,cancelled->"new");queue.run();
        assertEquals("new",fresh.value());assertThrows(CancellationException.class,old::value);
    }
    @Test void cancellingInsideWorkStillRevokesItsResultOnlyAfterFinallyCloses(){
        var time=new AtomicLong();var queue=new Queue();var slot=new ArrayList<AssemblyPlanPreparation<String>>();
        var task=AssemblyPlanPreparation.start(queue,time::get,cancelled->{slot.get(0).cancel();assertTrue(cancelled.getAsBoolean());assertFalse(slot.get(0).closed());return "revoked";});
        slot.add(task);queue.run();assertTrue(task.closed());assertThrows(CancellationException.class,task::value);
    }
    @Test void completedButUnconsumedResultCannotRegainAuthorityAfterCancellationOrExpiry(){
        var time=new AtomicLong();var first=AssemblyPlanPreparation.start(Runnable::run,time::get,cancelled->"original");
        assertEquals("original",first.value());first.cancel();assertThrows(CancellationException.class,first::value);
        var next=AssemblyPlanPreparation.start(Runnable::run,time::get,cancelled->"next");time.set(AssemblyPlanPreparation.BUDGET_NANOS);
        assertThrows(IllegalStateException.class,next::value);
    }
    @Test void deadlineIncludesQueueTimeAndDoesNotRunExpiredWork(){
        var time=new AtomicLong();var queue=new Queue();var invoked=new AtomicLong();
        var original=AssemblyPlanPreparation.start(queue,time::get,cancelled->{invoked.incrementAndGet();return "expired";});
        time.set(AssemblyPlanPreparation.BUDGET_NANOS);assertThrows(IllegalStateException.class,original::check);assertFalse(original.closed());
        queue.run();assertTrue(original.closed());assertEquals(0,invoked.get());assertThrows(IllegalStateException.class,original::value);
    }
    @Test void workerFailureClosesWithoutPublishingAReplacementOrRetry(){
        var queue=new Queue();var original=AssemblyPlanPreparation.start(queue,()->0L,cancelled->{throw new IllegalArgumentException("original failure");});
        queue.run();assertTrue(original.closed());var error=assertThrows(CompletionException.class,original::value);
        assertEquals("original failure",error.getCause().getMessage());assertTrue(queue.items.isEmpty());
        assertThrows(RejectedExecutionException.class,()->AssemblyPlanPreparation.start(work->{throw new RejectedExecutionException();},()->0L,cancelled->"not invoked"));
    }
    @Test void monotonicClockWrapRetainsElapsedBudget(){
        var time=new AtomicLong(Long.MAX_VALUE-10);var queue=new Queue();
        var original=AssemblyPlanPreparation.start(queue,time::get,cancelled->"original");
        time.set(Long.MIN_VALUE+20);assertDoesNotThrow(original::check);queue.run();assertEquals("original",original.value());
    }
}
