package dev.voxelstudio.mixin;

import dev.voxelstudio.client.StudioClient;
import net.minecraft.client.render.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** After WorldRenderer returns, all Iris RETURN injections/final compositing are finished. */
@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @Inject(method="render",at=@At("HEAD"))
    private void voxelStudio$selectionCpuStart(CallbackInfo ci){dev.voxelstudio.selection.SelectionPerformanceProbe.renderStart();}
    @Inject(method="render",at=@At("RETURN"))
    private void voxelStudio$presentationProbe(CallbackInfo ci){dev.voxelstudio.selection.SelectionPerformanceProbe.renderEnd();dev.voxelstudio.client.StudioPresentationSelfTest.afterFrame();}
    @Inject(method="renderWorld",at=@At(value="INVOKE",target="Lnet/minecraft/client/render/WorldRenderer;render(Lnet/minecraft/client/util/math/MatrixStack;FJZLnet/minecraft/client/render/Camera;Lnet/minecraft/client/render/GameRenderer;Lnet/minecraft/client/render/LightmapTextureManager;Lorg/joml/Matrix4f;)V",shift=At.Shift.AFTER))
    private void voxelStudio$afterComposite(CallbackInfo ci){StudioClient.renderProjectionAfterWorld();}
}
