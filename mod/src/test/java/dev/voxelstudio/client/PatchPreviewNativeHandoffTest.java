package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import org.lwjgl.system.MemoryUtil;
import java.nio.ByteBuffer;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Actual allocator memory, synthetic GPU consumers. No GL context, world,
 * model call or claim that these tests certify a native driver. Never read
 * memory after the checked free flag has become true. */
class PatchPreviewNativeHandoffTest {
    private static final class Arena implements AutoCloseable {
        final ByteBuffer bytes;
        final AtomicInteger frees=new AtomicInteger();
        final OwnedNativeBuffer<ByteBuffer> owner;
        Arena(){
            long address=MemoryUtil.getAllocator(false).malloc(65536);
            if(address==0)throw new OutOfMemoryError("Synthetic owned arena allocation");
            bytes=MemoryUtil.memByteBuffer(address,65536);
            owner=new OwnedNativeBuffer<>(bytes,b->{assertSame(bytes,b);assertEquals(0,frees.getAndIncrement());MemoryUtil.getAllocator(false).free(address);});
        }
        void checkLive(){assertEquals(0,frees.get(),"No read is permitted after native storage release");}
        @Override public void close(){owner.close();}
    }
    @Test void oneActualArenaIsReusedForBothSidesAndAll224Sections(){
        var arena=new Arena();
        try(arena){
            for(int side=0;side<2;side++)for(int section=0;section<224;section++){
                int marker=side*224+section;arena.checkLive();arena.bytes.putInt(0,marker);
                var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var access=new ProjectionMeshUploadTest.Fake();var lease=arena.owner.retain();
                access.onUpload=()->{arena.checkLive();assertEquals(marker,arena.bytes.getInt(0));assertFalse(consumed.isDone());};
                ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,access,lease::close);
                assertNull(uploaded.join());assertNull(consumed.join());assertEquals(1,access.releases);arena.checkLive();
            }
        }
        assertEquals(1,arena.frees.get());arena.close();assertEquals(1,arena.frees.get());
    }
    @Test void cancelledQueuedSectionKeepsActualMemoryUntilItsOriginalConsumerReleases(){
        var arena=new Arena();var lease=arena.owner.retain();var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var access=new ProjectionMeshUploadTest.Fake();
        try{ProjectionMeshUpload.abandon(uploaded);arena.close();arena.checkLive();
            ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,access,lease::close);
            assertNull(consumed.join());assertFalse(access.calls.contains("create"));assertEquals(1,access.releases);assertEquals(1,arena.frees.get());
        }finally{lease.close();arena.close();}
    }
    @Test void cancellingAnActiveUploadCannotFreeItsNativeReadOrPublishItsGpu(){
        var arena=new Arena();var lease=arena.owner.retain();var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var access=new ProjectionMeshUploadTest.Fake();
        try{arena.bytes.putInt(0,12345);access.onUpload=()->{ProjectionMeshUpload.abandon(uploaded);arena.close();arena.checkLive();assertEquals(12345,arena.bytes.getInt(0));};
            ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,access,lease::close);
            assertNull(consumed.join());assertFalse(access.calls.contains("publish"));assertTrue(access.calls.contains("dispose"));assertEquals(1,arena.frees.get());
        }finally{lease.close();arena.close();}
    }
    @Test void rejectedQueuedCallbackCannotReadOrReleaseAlreadyRetiredSourceAgain(){
        var arena=new Arena();var lease=arena.owner.retain();var claim=new ProjectionUploadClaim();var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var access=new ProjectionMeshUploadTest.Fake();
        try{ProjectionMeshUpload.abandon(uploaded);assertTrue(claim.rejectBeforeConsumption());access.releaseSource();lease.close();arena.close();assertEquals(1,arena.frees.get());
            if(claim.beginConsumer())ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,access,lease::close);
            assertEquals(1,access.releases);assertFalse(access.calls.contains("create"));assertEquals(1,arena.frees.get());
        }finally{lease.close();arena.close();}
    }
    @Test void staleUploadFailurePreservesItsOriginalCauseAndFreesNativeArenaOnce(){
        var arena=new Arena();var lease=arena.owner.retain();var uploaded=new CompletableFuture<Void>();var consumed=new CompletableFuture<Void>();var access=new ProjectionMeshUploadTest.Fake();var original=new AssertionError("Synthetic failed section upload");
        try{access.errors.put("upload",original);arena.close();arena.checkLive();
            ProjectionMeshUpload.executeRetained(uploaded,consumed,()->true,access,lease::close);
            assertSame(original,ProjectionMeshUploadTest.failure(consumed));assertEquals(1,access.releases);assertEquals(1,arena.frees.get());assertFalse(access.calls.contains("publish"));
        }finally{lease.close();arena.close();}
    }
}
