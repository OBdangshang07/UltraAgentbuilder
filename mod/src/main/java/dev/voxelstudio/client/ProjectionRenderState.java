package dev.voxelstudio.client;

import com.mojang.blaze3d.systems.RenderSystem;
import org.lwjgl.opengl.*;

/** Restore the caller's state for both GUI and post-Iris world draws. */
final class ProjectionRenderState implements AutoCloseable {
    private final boolean blend=GL11.glIsEnabled(GL11.GL_BLEND),depth=GL11.glIsEnabled(GL11.GL_DEPTH_TEST),cull=GL11.glIsEnabled(GL11.GL_CULL_FACE),write=GL11.glGetBoolean(GL11.GL_DEPTH_WRITEMASK);
    private final int src=GL11.glGetInteger(GL14.GL_BLEND_SRC_RGB),dst=GL11.glGetInteger(GL14.GL_BLEND_DST_RGB),srcA=GL11.glGetInteger(GL14.GL_BLEND_SRC_ALPHA),dstA=GL11.glGetInteger(GL14.GL_BLEND_DST_ALPHA);
    private final int depthFunc=GL11.glGetInteger(GL11.GL_DEPTH_FUNC),texture=RenderSystem.getShaderTexture(0);
    private final float[] color=RenderSystem.getShaderColor().clone();
    @Override public void close(){
        RenderSystem.setShaderColor(color[0],color[1],color[2],color[3]);RenderSystem.setShaderTexture(0,texture);
        RenderSystem.depthMask(write);RenderSystem.depthFunc(depthFunc);RenderSystem.blendFuncSeparate(src,dst,srcA,dstA);
        if(blend)RenderSystem.enableBlend();else RenderSystem.disableBlend();
        if(depth)RenderSystem.enableDepthTest();else RenderSystem.disableDepthTest();
        if(cull)RenderSystem.enableCull();else RenderSystem.disableCull();
    }
}
