package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class ProjectionMeshUploadTest {
    static final class Fake implements ProjectionMeshUpload.Access<Object> {
        final Object resource=new Object();final List<String> calls=new ArrayList<>();final Map<String,Throwable> errors=new HashMap<>();
        int releases;Runnable onUpload=()->{};
        void phase(String name){calls.add(name);Throwable error=errors.get(name);if(error instanceof RuntimeException runtime)throw runtime;if(error instanceof Error fatal)throw fatal;}
        public Object create(){phase("create");return resource;}
        public void bind(Object r){assertSame(resource,r);phase("bind");}
        public void upload(Object r){assertSame(resource,r);try{phase("upload");onUpload.run();}finally{releases++;}}
        public void unbind(){phase("unbind");}
        public void publish(Object r){assertSame(resource,r);phase("publish");}
        public void dispose(Object r){assertSame(resource,r);phase("dispose");}
        public void releaseSource(){releases++;phase("releaseSource");}
    }
    static Throwable failure(CompletableFuture<Void> future){return assertThrows(CompletionException.class,future::join).getCause();}
    @Test void successCompletesOnlyAfterUnbindAndOwnershipTransfer(){var f=new CompletableFuture<Void>();var a=new Fake();a.onUpload=()->assertFalse(f.isDone());ProjectionMeshUpload.execute(f,()->true,a);assertNull(f.join());assertEquals(List.of("create","bind","upload","unbind","publish"),a.calls);assertEquals(1,a.releases);}
    @Test void staleQueuedWorkReleasesCpuBufferWithoutCreatingGpuResource(){var f=new CompletableFuture<Void>();var a=new Fake();ProjectionMeshUpload.execute(f,()->false,a);assertNull(f.join());assertEquals(List.of("releaseSource"),a.calls);assertEquals(1,a.releases);}
    @Test void cancelledQueuedWorkNeverUploads(){var f=new CompletableFuture<Void>();f.cancel(false);var a=new Fake();ProjectionMeshUpload.execute(f,()->true,a);assertTrue(f.isCancelled());assertEquals(List.of("releaseSource"),a.calls);}
    @Test void completedQueuedWorkNeverUploadsAgain(){var f=CompletableFuture.<Void>completedFuture(null);var a=new Fake();ProjectionMeshUpload.execute(f,()->true,a);assertEquals(List.of("releaseSource"),a.calls);}
    @Test void allocationFailureReleasesSourceAndCannotReportSuccess(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new IllegalStateException("allocation");a.errors.put("create",e);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertEquals(List.of("create","releaseSource"),a.calls);assertEquals(1,a.releases);}
    @Test void bindFailureUnbindsDisposesAndReleasesSource(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new IllegalStateException("bind");a.errors.put("bind",e);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertEquals(List.of("create","bind","unbind","dispose","releaseSource"),a.calls);assertEquals(1,a.releases);}
    @Test void uploadFailureIsExceptionalAndDisposesWithoutDoubleReleasingSource(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new IllegalStateException("upload");a.errors.put("upload",e);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertEquals(List.of("create","bind","upload","unbind","dispose"),a.calls);assertEquals(1,a.releases);}
    @Test void unbindFailureDoesNotPublish(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new IllegalStateException("unbind");a.errors.put("unbind",e);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertFalse(a.calls.contains("publish"));assertTrue(a.calls.contains("dispose"));}
    @Test void publicationFailureDisposesTheUntransferredGpuResource(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new IllegalStateException("publish");a.errors.put("publish",e);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertEquals("dispose",a.calls.get(a.calls.size()-1));}
    @Test void invalidatedDuringUploadDisposesWithoutPublishing(){var f=new CompletableFuture<Void>();var a=new Fake();var current=new AtomicBoolean(true);a.onUpload=()->current.set(false);ProjectionMeshUpload.execute(f,current::get,a);assertNull(f.join());assertFalse(a.calls.contains("publish"));assertTrue(a.calls.contains("dispose"));assertEquals(1,a.releases);}
    @Test void timedOutDuringUploadDisposesWithoutPublishing(){var f=new CompletableFuture<Void>();var a=new Fake();a.onUpload=()->f.cancel(false);ProjectionMeshUpload.execute(f,()->true,a);assertTrue(f.isCancelled());assertFalse(a.calls.contains("publish"));assertTrue(a.calls.contains("dispose"));}
    @Test void allCleanupErrorsAreSuppressedOnOriginalUploadFailure(){var f=new CompletableFuture<Void>();var a=new Fake();IllegalStateException e=new IllegalStateException("upload"),u=new IllegalStateException("unbind"),d=new IllegalStateException("dispose");a.errors.put("upload",e);a.errors.put("unbind",u);a.errors.put("dispose",d);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertArrayEquals(new Throwable[]{u,d},e.getSuppressed());assertEquals(1,a.releases);}
    @Test void sourceReleaseFailureIsNotSuccess(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new IllegalStateException("release");a.errors.put("releaseSource",e);ProjectionMeshUpload.execute(f,()->false,a);assertSame(e,failure(f));assertEquals(1,a.releases);}
    @Test void lateCleanupErrorAfterCancellationIsNotSilentlyLost(){var f=new CompletableFuture<Void>();f.cancel(false);var a=new Fake();var e=new IllegalStateException("late release");a.errors.put("releaseSource",e);assertSame(e,assertThrows(IllegalStateException.class,()->ProjectionMeshUpload.execute(f,()->true,a)));}
    @Test void errorSubclassIsPropagatedThroughFuture(){var f=new CompletableFuture<Void>();var a=new Fake();var e=new AssertionError("upload");a.errors.put("upload",e);ProjectionMeshUpload.execute(f,()->true,a);assertSame(e,failure(f));assertTrue(a.calls.contains("dispose"));}
    @Test void failureMessagesUnwrapTheFutureAndNeverDisappearForNullMessages(){assertEquals("IllegalStateException: synthetic upload",ProjectionMeshUpload.describe(new ExecutionException(new IllegalStateException("synthetic upload"))));assertEquals("IllegalStateException",ProjectionMeshUpload.describe(new CompletionException(new IllegalStateException())));}
    @Test void abandonUsesTheSamePublicationFence()throws Exception{
        var f=new CompletableFuture<Void>();var a=new Fake();var holding=new CountDownLatch(1);var release=new CountDownLatch(1);
        Thread publisher=new Thread(()->{synchronized(f){holding.countDown();try{assertTrue(release.await(2,TimeUnit.SECONDS));}catch(InterruptedException e){throw new AssertionError(e);}ProjectionMeshUpload.execute(f,()->true,a);}});
        var finished=new CompletableFuture<Void>();Thread abandoning=new Thread(()->{ProjectionMeshUpload.abandon(f);finished.complete(null);});
        publisher.start();assertTrue(holding.await(2,TimeUnit.SECONDS));abandoning.start();assertFalse(finished.isDone());release.countDown();publisher.join(2000);abandoning.join(2000);
        assertFalse(publisher.isAlive());assertFalse(abandoning.isAlive());assertNull(f.join());assertNull(finished.join());assertEquals(1,Collections.frequency(a.calls,"publish"));
    }
    @Test void consumerReceiptCompletesOnlyAfterLeaseRelease() {
        var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var a=new Fake();
        ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,a,()->{assertTrue(uploaded.isDone());assertFalse(consumed.isDone());a.calls.add("lease");});
        assertNull(consumed.join());assertEquals("lease",a.calls.get(a.calls.size()-1));assertEquals(1,a.releases);
    }
    @Test void cancelledQueuedUploadRetainsMemoryUntilItsActualCleanup() {
        var freed=new AtomicBoolean();var owner=new OwnedNativeBuffer<>(new Object(),r->freed.set(true));var lease=owner.retain();
        var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var a=new Fake();
        uploaded.cancel(false);owner.close();assertFalse(freed.get());
        ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,a,lease::close);
        assertTrue(freed.get());assertNull(consumed.join());assertEquals(1,a.releases);assertFalse(a.calls.contains("create"));
    }
    @Test void cancellationDuringActualUploadCannotFreeItsNativeSource() {
        var freed=new AtomicBoolean();var owner=new OwnedNativeBuffer<>(new Object(),r->freed.set(true));var lease=owner.retain();
        var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var a=new Fake();
        a.onUpload=()->{uploaded.cancel(false);owner.close();assertFalse(freed.get());};
        ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,a,lease::close);
        assertTrue(freed.get());assertFalse(a.calls.contains("publish"));assertNull(consumed.join());
    }
    @Test void uploadFailureRemainsPrimaryWhenNativeLeaseCleanupFails() {
        var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var a=new Fake();
        var original=new IllegalStateException("upload");var cleanup=new IllegalStateException("native cleanup");a.errors.put("upload",original);
        ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,a,()->{throw cleanup;});
        assertSame(original,failure(consumed));assertArrayEquals(new Throwable[]{cleanup},original.getSuppressed());assertEquals(1,a.releases);
    }
    @Test void nativeCleanupFailureIsNotASuccessfulConsumerReceipt() {
        var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var a=new Fake();var cleanup=new AssertionError("native cleanup");
        ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,a,()->{throw cleanup;});assertSame(cleanup,failure(consumed));
    }
    @Test void lateCancelledNativeCleanupFailureIsReportedToClientExecutor() {
        var uploaded=new CompletableFuture<Void>();uploaded.cancel(false);var consumed=new CompletableFuture<Void>();var a=new Fake();var cleanup=new IllegalStateException("late native cleanup");
        assertSame(cleanup,assertThrows(IllegalStateException.class,()->ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,a,()->{throw cleanup;})));
        assertSame(cleanup,failure(consumed));assertEquals(1,a.releases);
    }
}
