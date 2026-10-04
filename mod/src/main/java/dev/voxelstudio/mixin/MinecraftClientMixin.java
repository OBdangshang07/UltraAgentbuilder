package dev.voxelstudio.mixin;

import dev.voxelstudio.client.StudioEvidenceShutdown;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Observational only; the witness is disabled outside the explicit dev harness. */
@Mixin(MinecraftClient.class)
public abstract class MinecraftClientMixin {
    @Inject(method = "scheduleStop", at = @At("HEAD"))
    private void voxelStudio$observeEvidenceStop(CallbackInfo ci) {
        StudioEvidenceShutdown.observe((MinecraftClient)(Object)this, false);
    }
}
