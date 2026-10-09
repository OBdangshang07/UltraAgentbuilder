package dev.voxelstudio.client;

import com.google.gson.JsonArray;
import com.mojang.blaze3d.systems.RenderSystem;
import dev.voxelstudio.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.SimpleFramebuffer;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.util.math.*;
import org.joml.Matrix4f;
import java.util.Base64;

/** Offscreen asset mesh only: never capture the desktop, GUI, world or other players. */
final class AssetReviewCapture {
    static String captureView(Asset asset,ProjectionRenderer renderer,NativeEvidenceRequest.View view)throws Exception{
        RenderSystem.assertOnRenderThread();
        if(renderer.building||renderer.error!=null||renderer.night||renderer.faceCount<1||ProjectionRenderer.program==null)throw new IllegalStateException("原生证据网格尚未就绪");
        try(var state=new AssetCaptureState()){
            var target=new SimpleFramebuffer(512,512,true,MinecraftClient.IS_SYSTEM_MAC);
            try(AutoCloseable framebuffer=target::delete){
            RenderSystem.disableScissor();var lo=view.min();var hi=view.max();
            double x=hi.get(0)-lo.get(0),y=hi.get(1)-lo.get(1),z=hi.get(2)-lo.get(2);float radius=(float)Math.sqrt(x*x+y*y+z*z)*.6f;
            target.setClearColor(.045f,.075f,.095f,1);target.clear(MinecraftClient.IS_SYSTEM_MAC);target.beginWrite(true);
            var projection=new Matrix4f().setOrtho(-radius,radius,-radius,radius,-radius*4,radius*4);
            var model=new Matrix4f().rotateX((float)Math.toRadians(view.pitch())).rotateY((float)Math.toRadians(view.yaw())).translate(-(lo.get(0)+hi.get(0))/2f,-(lo.get(1)+hi.get(1))/2f,-(lo.get(2)+hi.get(2))/2f);
            renderer.draw(model,projection,1,true,new Vec3d(0,200,-200),true);
            try(var pixels=ScreenshotRecorder.takeScreenshot(target)){byte[] bytes=pixels.getBytes();if(bytes.length>1000000)throw new IllegalStateException("原生证据图像超限");return Base64.getEncoder().encodeToString(bytes);}
            }
        }
    }
    static JsonArray capture(Asset asset,ProjectionRenderer renderer)throws Exception{
        if(renderer.building||renderer.error!=null||renderer.cutLayer!=-1||renderer.minLayer!=0||renderer.night)throw new IllegalStateException("完整白天建筑网格尚未就绪");
        return captureEvidence(asset,renderer,true);
    }
    static JsonArray captureEvidence(Asset asset,ProjectionRenderer renderer,boolean materials)throws Exception{
        RenderSystem.assertOnRenderThread();
        if(renderer.building||renderer.error!=null||renderer.night)throw new IllegalStateException("白天建筑网格尚未就绪");
        int resolution=renderer.minLayer>0?1024:512;
        JsonArray result=new JsonArray();
        try(var state=new AssetCaptureState()){
            var target=new SimpleFramebuffer(resolution,resolution,true,MinecraftClient.IS_SYSTEM_MAC);
            try(AutoCloseable framebuffer=target::delete){
            int visibleHeight=(renderer.cutLayer<0?asset.height:renderer.cutLayer+1)-renderer.minLayer;
            RenderSystem.disableScissor();float radius=(float)Math.sqrt((double)asset.width*asset.width+(double)visibleHeight*visibleHeight+(double)asset.length*asset.length)*.6f;
            for(int yaw:new int[]{-35,55,145,235}){
                target.setClearColor(.045f,.075f,.095f,1);target.clear(MinecraftClient.IS_SYSTEM_MAC);target.beginWrite(true);
                Matrix4f projection=new Matrix4f().setOrtho(-radius,radius,-radius,radius,-radius*4,radius*4);
                Matrix4f model=new Matrix4f().rotateX((float)Math.toRadians(renderer.cutLayer<0?25:55)).rotateY((float)Math.toRadians(yaw)).translate(-asset.width/2f,-renderer.minLayer-visibleHeight/2f,-asset.length/2f);
                renderer.draw(model,projection,1,materials,new Vec3d(0,200,-200),true);
                try(var image=ScreenshotRecorder.takeScreenshot(target)){byte[] png=image.getBytes();if(png.length>1000000)throw new IllegalStateException("资产预览 PNG 超过安全限额");result.add(Base64.getEncoder().encodeToString(png));}
            }
            }
        }
        return result;
    }
}
