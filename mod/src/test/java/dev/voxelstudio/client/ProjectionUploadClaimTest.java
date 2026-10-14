package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class ProjectionUploadClaimTest {
    @Test void aConsumerClaimsOnceAndCannotAlsoBeRejected() {
        var claim=new ProjectionUploadClaim();
        assertTrue(claim.beginConsumer());assertFalse(claim.beginConsumer());
        assertFalse(claim.rejectBeforeConsumption());
    }
    @Test void rejectedButAlreadyQueuedCallbackCannotReadFreedSource() {
        var claim=new ProjectionUploadClaim();var freed=new AtomicInteger();
        var owner=new OwnedNativeBuffer<>(new Object(),r->freed.incrementAndGet());var lease=owner.retain();
        assertTrue(claim.rejectBeforeConsumption());lease.close();owner.close();assertEquals(1,freed.get());
        assertFalse(claim.beginConsumer());assertFalse(claim.rejectBeforeConsumption());
        lease.close();owner.close();assertEquals(1,freed.get());
    }
    @Test void aRunningConsumerKeepsTheLeaseWhenSubmissionThrows()throws Exception {
        var claim=new ProjectionUploadClaim();var freed=new AtomicBoolean();
        var owner=new OwnedNativeBuffer<>(new Object(),r->freed.set(true));var lease=owner.retain();
        var entered=new CountDownLatch(1);var finish=new CountDownLatch(1);var pool=Executors.newSingleThreadExecutor();
        try {
            var task=pool.submit(()->{assertTrue(claim.beginConsumer());try(lease){entered.countDown();assertTrue(finish.await(5,TimeUnit.SECONDS));assertFalse(freed.get());}return null;});
            assertTrue(entered.await(5,TimeUnit.SECONDS));assertFalse(claim.rejectBeforeConsumption());
            owner.close();assertFalse(freed.get());finish.countDown();task.get(5,TimeUnit.SECONDS);assertTrue(freed.get());
        }finally{finish.countDown();pool.shutdownNow();}
    }
    @Test void concurrentSubmissionRejectionAndCallbackHaveExactlyOneCleanupOwner()throws Exception {
        var pool=Executors.newFixedThreadPool(2);
        try {
            for(int i=0;i<512;i++) {
                var claim=new ProjectionUploadClaim();var freed=new AtomicInteger();var winners=new AtomicInteger();
                var owner=new OwnedNativeBuffer<>(new Object(),r->freed.incrementAndGet());var lease=owner.retain();owner.close();
                var start=new CountDownLatch(1);
                var consumer=pool.submit(()->{start.await();if(claim.beginConsumer()){winners.incrementAndGet();try(lease){assertEquals(0,freed.get());}}return null;});
                var rejection=pool.submit(()->{start.await();if(claim.rejectBeforeConsumption()){winners.incrementAndGet();lease.close();}return null;});
                start.countDown();consumer.get(5,TimeUnit.SECONDS);rejection.get(5,TimeUnit.SECONDS);
                assertEquals(1,winners.get());assertEquals(1,freed.get());owner.close();lease.close();assertEquals(1,freed.get());
            }
        }finally{pool.shutdownNow();}
    }
}
