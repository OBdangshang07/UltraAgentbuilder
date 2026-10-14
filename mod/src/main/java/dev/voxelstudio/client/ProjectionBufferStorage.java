package dev.voxelstudio.client;

import dev.voxelstudio.mixin.BufferBuilderNativeAccess;
import net.minecraft.client.render.BufferBuilder;
import org.lwjgl.system.MemoryUtil;
import java.nio.ByteBuffer;

/** Owns only builders allocated here, never vanilla/tessellator/shared buffers. */
final class ProjectionBufferStorage {
    private ProjectionBufferStorage() {}
    static OwnedNativeBuffer<BufferBuilder> allocate() {
        BufferBuilder builder=new BufferBuilder(65536);
        try { return new OwnedNativeBuffer<>(builder,ProjectionBufferStorage::release); }
        catch(RuntimeException | Error original) {
            try { release(builder); } catch(RuntimeException | Error cleanup) { if(cleanup!=original)original.addSuppressed(cleanup); }
            throw original;
        }
    }
    private static void release(BufferBuilder builder) {
        var access=(BufferBuilderNativeAccess)(Object)builder;
        ByteBuffer buffer=access.voxelstudio$getNativeBuffer();
        if(buffer==null||!buffer.isDirect())throw new IllegalStateException("Invalid owned native builder");
        // Minecraft 1.20.1 GlAllocationUtils uses getAllocator(false), malloc
        // and realloc. BuiltBuffer.release resets counts, not this allocation.
        long address=MemoryUtil.memAddress0(buffer);
        access.voxelstudio$setNativeBuffer(null);
        MemoryUtil.getAllocator(false).free(address);
    }
}
