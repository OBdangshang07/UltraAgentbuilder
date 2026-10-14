package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class OwnedNativeBufferTest {
    @Test void noConsumersDisposeOnceAndRetiredWriterCannotReopen() {
        var count=new AtomicInteger();var resource=new Object();var owner=new OwnedNativeBuffer<>(resource,r->{assertSame(resource,r);count.incrementAndGet();});
        assertSame(resource,owner.resource());owner.close();owner.close();assertEquals(1,count.get());
        assertThrows(IllegalStateException.class,owner::resource);assertThrows(IllegalStateException.class,owner::retain);
    }
    @Test void retiringWriterNeverFreesQueuedConsumerMemory() {
        var count=new AtomicInteger();var owner=new OwnedNativeBuffer<>(new Object(),r->count.incrementAndGet());var lease=owner.retain();
        owner.close();assertEquals(0,count.get());lease.close();lease.close();owner.close();assertEquals(1,count.get());
    }
    @Test void completedConsumerLeavesTheWriterArenaReusable() {
        var count=new AtomicInteger();var resource=new Object();var owner=new OwnedNativeBuffer<>(resource,r->count.incrementAndGet());
        for(int i=0;i<224;i++){var lease=owner.retain();assertSame(resource,owner.resource());lease.close();}
        assertEquals(0,count.get());owner.close();assertEquals(1,count.get());
    }
    @Test void allConsumersMustFinishBeforeExactlyOneFree() {
        var count=new AtomicInteger();var owner=new OwnedNativeBuffer<>(new Object(),r->count.incrementAndGet());var a=owner.retain();var b=owner.retain();
        owner.close();a.close();assertEquals(0,count.get());b.close();assertEquals(1,count.get());
    }
    @Test void disposalFailureIsNotRetriedOrReplaced() {
        var count=new AtomicInteger();var original=new IllegalStateException("synthetic disposal");
        var owner=new OwnedNativeBuffer<>(new Object(),r->{count.incrementAndGet();throw original;});var lease=owner.retain();
        owner.close();assertSame(original,assertThrows(IllegalStateException.class,lease::close));lease.close();owner.close();assertEquals(1,count.get());
        assertThrows(IllegalStateException.class,owner::retain);
    }
    @Test void consumerReleaseBeforeRetirementPreservesDisposalFailure() {
        var original=new AssertionError("synthetic disposal");var owner=new OwnedNativeBuffer<>(new Object(),r->{throw original;});
        var lease=owner.retain();lease.close();assertSame(original,assertThrows(AssertionError.class,owner::close));owner.close();
    }
    @Test void scopeFailureStillRetiresTheWriterWithoutKillingConsumer() {
        var count=new AtomicInteger();var owner=new OwnedNativeBuffer<>(new Object(),r->count.incrementAndGet());var lease=owner.retain();
        assertThrows(IllegalStateException.class,()->{try(owner){throw new IllegalStateException("synthetic mesh failure");}});
        assertEquals(0,count.get());lease.close();assertEquals(1,count.get());
    }
    @Test void concurrentRepeatedRetirementAndLeaseReleaseFreeOnce()throws Exception {
        var count=new AtomicInteger();var owner=new OwnedNativeBuffer<>(new Object(),r->count.incrementAndGet());var a=owner.retain();var b=owner.retain();
        var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(3);
        try {
            var first=pool.submit(()->{start.await();for(int i=0;i<500;i++)owner.close();return null;});
            var second=pool.submit(()->{start.await();for(int i=0;i<500;i++)a.close();return null;});
            var third=pool.submit(()->{start.await();for(int i=0;i<500;i++)b.close();return null;});
            start.countDown();first.get(5,TimeUnit.SECONDS);second.get(5,TimeUnit.SECONDS);third.get(5,TimeUnit.SECONDS);assertEquals(1,count.get());
        }finally{pool.shutdownNow();}
    }
    @Test void retirementWhileAnUploadReadsNeverFreesUntilItReturns()throws Exception {
        var freed=new AtomicBoolean();var entered=new CountDownLatch(1);var finish=new CountDownLatch(1);
        var owner=new OwnedNativeBuffer<>(new Object(),r->freed.set(true));var lease=owner.retain();var pool=Executors.newSingleThreadExecutor();
        try {
            var upload=pool.submit(()->{try(lease){entered.countDown();assertTrue(finish.await(5,TimeUnit.SECONDS));assertFalse(freed.get());}return null;});
            assertTrue(entered.await(5,TimeUnit.SECONDS));owner.close();assertFalse(freed.get());finish.countDown();upload.get(5,TimeUnit.SECONDS);assertTrue(freed.get());
        }finally{finish.countDown();pool.shutdownNow();}
    }
    @Test void invalidConstructorArgumentsAreRejected() {
        assertThrows(NullPointerException.class,()->new OwnedNativeBuffer<>(null,r->{}));
        assertThrows(NullPointerException.class,()->new OwnedNativeBuffer<>(new Object(),null));
    }
}
