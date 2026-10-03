package dev.voxelstudio.mixin;

import dev.voxelstudio.client.StudioClient;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.Mouse;
import net.minecraft.client.gui.screen.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** World projection is an explicit modal tool; outside it hotbar scrolling remains vanilla. */
@Mixin(Mouse.class)
public abstract class MouseMixin {
    @Inject(method="onMouseScroll",at=@At("HEAD"),cancellable=true)
    private void voxelStudio$scroll(long window,double horizontal,double vertical,CallbackInfo ci){
        if(window==MinecraftClient.getInstance().getWindow().getHandle()&&StudioClient.PROJECTION.scrollNudge(vertical,Screen.hasControlDown()))ci.cancel();
    }
}
