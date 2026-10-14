package dev.voxelstudio.mixin;

import net.minecraft.client.render.BufferBuilder;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import java.nio.ByteBuffer;

/** Access only; does not intercept vanilla allocation or global cleanup. */
@Mixin(BufferBuilder.class)
public interface BufferBuilderNativeAccess {
    @Accessor("buffer") ByteBuffer voxelstudio$getNativeBuffer();
    @Accessor("buffer") void voxelstudio$setNativeBuffer(ByteBuffer value);
}
