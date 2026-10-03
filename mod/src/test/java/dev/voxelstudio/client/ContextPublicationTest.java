package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class ContextPublicationTest {
    @Test void genericPreviewPublicationUsesTheSameServerFences(){var cap=capture();var checks=new AtomicInteger();var preview=new Object();assertSame(preview,ContextPublication.checkedValue(()->{checks.incrementAndGet();return CompletableFuture.completedFuture(cap);},v->CompletableFuture.completedFuture(preview)).join());assertEquals(2,checks.get());}
    @Test void genericLatePreviewCannotAdoptEquivalentButNewCapture(){var cap=capture();var other=new SelectionReadService.Capture(cap.id(),cap.selection(),cap.contextRevision(),cap.payload(),null,false);var checks=new AtomicInteger();var transfer=new CompletableFuture<Object>();var result=ContextPublication.checkedValue(()->CompletableFuture.completedFuture(checks.incrementAndGet()==1?cap:other),v->transfer);transfer.complete(new Object());assertThrows(CompletionException.class,result::join);assertEquals(2,checks.get());}
    static SelectionReadService.Capture capture(){var r=new SelectionRegion(new SelectionRegion.Point(-1,-1,-1),new SelectionRegion.Point(1,1,1));return new SelectionReadService.Capture(UUID.randomUUID().toString(),new WorldSelection(new WorldSelection.WorldIdentity("opaque","minecraft:overworld",-64,320),3,r,r,List.of()),9,"{}",null,false);}
    @Test void checksBeforeAndAfterTransfer(){var cap=capture();var calls=new AtomicInteger();var saved=new JsonObject();
        var result=ContextPublication.checked(()->{calls.incrementAndGet();return CompletableFuture.completedFuture(cap);},v->CompletableFuture.completedFuture(saved));assertSame(saved,result.join());assertEquals(2,calls.get());}
    @Test void staleBeforeTransferNeverUploads(){var uploads=new AtomicInteger();var result=ContextPublication.checked(()->CompletableFuture.failedFuture(new IllegalStateException("stale")),cap->{uploads.incrementAndGet();return CompletableFuture.completedFuture(new JsonObject());});assertThrows(CompletionException.class,result::join);assertEquals(0,uploads.get());}
    @Test void environmentChangingWhileUploadInFlightCannotPublish(){var cap=capture();var calls=new AtomicInteger();var transfer=new CompletableFuture<JsonObject>();
        var result=ContextPublication.checked(()->calls.incrementAndGet()==1?CompletableFuture.completedFuture(cap):CompletableFuture.failedFuture(new IllegalStateException("environment changed")),v->transfer);
        assertFalse(result.isDone());transfer.complete(new JsonObject());assertThrows(CompletionException.class,result::join);assertEquals(2,calls.get());}
    @Test void replacementCaptureEvenWithSameIdentityRejectsLateResult(){var cap=capture();var replacement=new SelectionReadService.Capture(cap.id(),cap.selection(),cap.contextRevision(),cap.payload(),null,false);var calls=new AtomicInteger();
        var result=ContextPublication.checked(()->CompletableFuture.completedFuture(calls.incrementAndGet()==1?cap:replacement),v->CompletableFuture.completedFuture(new JsonObject()));assertThrows(CompletionException.class,result::join);}
    @Test void failedTransferDoesNotRepeatOrPublish(){var checks=new AtomicInteger();var cap=capture();var uploads=new AtomicInteger();
        var result=ContextPublication.checked(()->{checks.incrementAndGet();return CompletableFuture.completedFuture(cap);},v->{uploads.incrementAndGet();return CompletableFuture.failedFuture(new IllegalStateException("unknown receipt"));});assertThrows(CompletionException.class,result::join);assertEquals(1,uploads.get());assertEquals(1,checks.get());}
}
