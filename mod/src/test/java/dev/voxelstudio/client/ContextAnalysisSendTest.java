package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class ContextAnalysisSendTest {
    @Test void commitsReferenceThenRechecksThenDispatchesExactlyOnce()throws Exception{
        var events=new ArrayList<String>();var receipt=new JsonObject();receipt.addProperty("state","running");
        var result=ContextAnalysisSend.once(()->true,()->{events.add("durable-claim");return CompletableFuture.completedFuture(true);},
            ()->{events.add("recheck");return CompletableFuture.completedFuture(null);},()->{events.add("post");return CompletableFuture.completedFuture(receipt);},()->{fail("No query for fresh send");return null;});
        assertSame(receipt,result.get());assertEquals(List.of("durable-claim","recheck","post"),events);
    }
    @Test void existingReferenceOnlyQueriesEvenWhenServerOutcomeUnknown()throws Exception{
        var query=new AtomicInteger();var status=new JsonObject();status.addProperty("state","unknown");
        assertSame(status,ContextAnalysisSend.once(()->true,()->CompletableFuture.completedFuture(false),()->{fail("No baseline adoption");return null;},
            ()->{fail("No second POST");return null;},()->{query.incrementAndGet();return CompletableFuture.completedFuture(status);}).get());assertEquals(1,query.get());
    }
    @Test void closedBeforeClaimCannotCreateAnyInvocation(){var calls=new AtomicInteger();
        assertThrows(CancellationException.class,()->ContextAnalysisSend.once(()->false,()->{calls.incrementAndGet();return null;},()->null,()->null,()->null).join());assertEquals(0,calls.get());}
    @Test void closingDuringPersistenceNeverDispatches(){var live=new AtomicBoolean(true);var saved=new CompletableFuture<Boolean>();var calls=new AtomicInteger();
        var pending=ContextAnalysisSend.once(live::get,()->saved,()->{calls.incrementAndGet();return null;},()->{calls.incrementAndGet();return null;},()->null);
        live.set(false);saved.complete(true);assertThrows(CompletionException.class,pending::join);assertEquals(0,calls.get());}
    @Test void closingDuringRecheckNeverDispatches(){var live=new AtomicBoolean(true);var checked=new CompletableFuture<Void>();var posts=new AtomicInteger();
        var pending=ContextAnalysisSend.once(live::get,()->CompletableFuture.completedFuture(true),()->checked,()->{posts.incrementAndGet();return null;},()->null);
        live.set(false);checked.complete(null);assertThrows(CompletionException.class,pending::join);assertEquals(0,posts.get());}
    @Test void persistenceFailureNeverFallsBackToDispatchOrQuery(){var calls=new AtomicInteger();
        var pending=ContextAnalysisSend.once(()->true,()->CompletableFuture.failedFuture(new java.io.IOException("disk full")),()->{calls.incrementAndGet();return null;},()->{calls.incrementAndGet();return null;},()->{calls.incrementAndGet();return null;});
        assertThrows(CompletionException.class,pending::join);assertEquals(0,calls.get());}
    @Test void recheckFailureAndUnknownHttpResultNeverRetry(){for(boolean recheckFails:new boolean[]{true,false}){var posts=new AtomicInteger();var queries=new AtomicInteger();
        var pending=ContextAnalysisSend.once(()->true,()->CompletableFuture.completedFuture(true),()->recheckFails?CompletableFuture.failedFuture(new IllegalStateException("changed")):CompletableFuture.completedFuture(null),
            ()->{posts.incrementAndGet();return CompletableFuture.failedFuture(new java.io.IOException("unknown transport"));},()->{queries.incrementAndGet();return null;});
        assertThrows(CompletionException.class,pending::join);assertEquals(recheckFails?0:1,posts.get());assertEquals(0,queries.get());}}
}
