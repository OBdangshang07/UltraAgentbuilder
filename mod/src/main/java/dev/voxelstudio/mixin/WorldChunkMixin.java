package dev.voxelstudio.mixin;

import dev.voxelstudio.WorldChangeTracker;
import net.minecraft.world.chunk.WorldChunk;
import net.minecraft.world.World;
import net.minecraft.block.BlockState;
import net.minecraft.util.math.BlockPos;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(WorldChunk.class)
public abstract class WorldChunkMixin {
    @Shadow @Final private World world;
    @Inject(method="setBlockState",at=@At("RETURN"))
    private void voxelStudioChanged(BlockPos pos,BlockState state,boolean moved,CallbackInfoReturnable<BlockState> result){
        if(result.getReturnValue()!=null&&!result.getReturnValue().equals(state))WorldChangeTracker.block(world,pos);
    }
}
