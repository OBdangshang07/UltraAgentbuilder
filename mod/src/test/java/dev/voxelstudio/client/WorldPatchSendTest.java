package dev.voxelstudio.client;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
final class WorldPatchSendTest {
    @Test void originalClaimFenceAndDispatchAreOrderedAndExactlyOnce(){var events=new ArrayList<String>();var value=new JsonObject();
        assertSame(value,WorldPatchSend.once(()->true,()->{events.add("claim");return CompletableFuture.completedFuture(true);},()->{events.add("server-fence");return CompletableFuture.completedFuture(null);},()->{events.add("send");return CompletableFuture.completedFuture(value);},()->{fail("No query for fresh claim");return null;}).join());assertEquals(List.of("claim","server-fence","send"),events);}
    @Test void existingClaimOnlyQueriesEvenAfterUnknownHttpOutcome(){var count=new AtomicInteger();var status=new JsonObject();status.addProperty("state","unknown");
        assertSame(status,WorldPatchSend.once(()->true,()->CompletableFuture.completedFuture(false),()->{fail("No baseline adoption");return null;},()->{fail("No repeated SEND");return null;},()->{count.incrementAndGet();return CompletableFuture.completedFuture(status);}).join());assertEquals(1,count.get());}
    @Test void closingBeforeClaimMakesNoCalls(){var count=new AtomicInteger();assertThrows(CancellationException.class,()->WorldPatchSend.once(()->false,()->{count.incrementAndGet();return null;},()->null,()->null,()->null).join());assertEquals(0,count.get());}
    @Test void closingOrInvalidatingDuringDurableClaimNeverRechecksOrSends(){var live=new AtomicBoolean(true);var claim=new CompletableFuture<Boolean>();var calls=new AtomicInteger();var pending=WorldPatchSend.once(live::get,()->claim,()->{calls.incrementAndGet();return null;},()->{calls.incrementAndGet();return null;},()->null);live.set(false);claim.complete(true);assertThrows(CompletionException.class,pending::join);assertEquals(0,calls.get());}
    @Test void closingOrChangingSelectionDuringFreshFenceNeverDispatches(){var live=new AtomicBoolean(true);var fence=new CompletableFuture<Void>();var sends=new AtomicInteger();var pending=WorldPatchSend.once(live::get,()->CompletableFuture.completedFuture(true),()->fence,()->{sends.incrementAndGet();return null;},()->null);live.set(false);fence.complete(null);assertThrows(CompletionException.class,pending::join);assertEquals(0,sends.get());}
    @Test void diskFailureCannotFallBackToModelOrQuery(){var count=new AtomicInteger();var pending=WorldPatchSend.once(()->true,()->CompletableFuture.failedFuture(new java.io.IOException("disk full")),()->{count.incrementAndGet();return null;},()->{count.incrementAndGet();return null;},()->{count.incrementAndGet();return null;});assertThrows(CompletionException.class,pending::join);assertEquals(0,count.get());}
    @Test void fenceFailureAndUnknownTransportNeverRetry(){for(boolean fenceFails:new boolean[]{true,false}){var sends=new AtomicInteger();var queries=new AtomicInteger();var pending=WorldPatchSend.once(()->true,()->CompletableFuture.completedFuture(true),()->fenceFails?CompletableFuture.failedFuture(new IllegalStateException("changed")):CompletableFuture.completedFuture(null),()->{sends.incrementAndGet();return CompletableFuture.failedFuture(new java.io.IOException("unknown"));},()->{queries.incrementAndGet();return null;});assertThrows(CompletionException.class,pending::join);assertEquals(fenceFails?0:1,sends.get());assertEquals(0,queries.get());}}
}
