package dev.voxelstudio.client;

import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.ChunkStatus;

/** ClientWorld.isChunkLoaded(int,int) always returns true in Minecraft 1.20.1.
 * Query received FULL chunks without requesting a fallback EmptyChunk. */
final class ClientChunkAvailability {
    private ClientChunkAvailability() {}
    static boolean loaded(ClientWorld world,BlockPos pos) {
        return loaded(world,pos.getX()>>4,pos.getZ()>>4);
    }
    static boolean loaded(ClientWorld world,int chunkX,int chunkZ) {
        return world!=null&&world.getChunkManager().getChunk(chunkX,chunkZ,ChunkStatus.FULL,false)!=null;
    }
}
