package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.util.math.BlockPos;
import java.nio.file.*;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL30;
import org.joml.Matrix4f;
import net.minecraft.util.math.Vec3d;
import net.minecraft.client.gl.SimpleFramebuffer;
import com.mojang.blaze3d.systems.RenderSystem;

/** Own-framebuffer regression, opt-in isolated development world only. No Computer Use or model calls. */
final class ProjectionRenderSelfTest {
    private static boolean launching,capture,justCaptured;
    private static int stage,ticks,sample;
    private static long started=System.nanoTime();
    private static Path directory;
    private static NativeImage before;
    private static SimpleFramebuffer background;
    private static final JsonObject report=new JsonObject();
    private static final JsonArray frames=new JsonArray();
    static void tick(MinecraftClient c){
        if(!enabled()||stage==99)return;
        try{
            if(System.nanoTime()-started>180_000_000_000L)throw new IllegalStateException("Projection render test timed out");
            Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
            if(!game.toString().replace('\\','/').endsWith("/voxel/mod/run"))throw new IllegalStateException("Not isolated render test directory");
            c.options.pauseOnLostFocus=false;
            if(c.player==null){if(!launching&&c.getOverlay()==null&&c.currentScreen instanceof net.minecraft.client.gui.screen.TitleScreen&&++ticks>40){launching=true;ticks=0;c.createIntegratedServerLoader().start(c.currentScreen,"新的世界");}return;}
            if(c.getServer()==null||!c.getServer().getSavePath(net.minecraft.util.WorldSavePath.ROOT).toAbsolutePath().normalize().startsWith(game.resolve("saves")))throw new IllegalStateException("Not isolated render test world");
            if(++ticks<60)return;
            var p=StudioClient.PROJECTION;
            if(stage==0){
                directory=game.resolve("projection-qa/"+System.currentTimeMillis());Files.createDirectories(directory);report.addProperty("version",StudioRuntimeVersion.loaded());
                String requested=System.getProperty("voxelstudio.projectionFixture","");
                if(!requested.isEmpty()&&!requested.matches("[a-z0-9-]{1,64}"))throw new IllegalArgumentException("Unsafe projection fixture name");
                Path fixture=game.resolve("../build/test-fixtures").resolve(requested).normalize();
                var a=new Asset("render-fixture",JsonParser.parseString(Files.readString(fixture.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(fixture.resolve("cells.bin")));
                report.addProperty("assetHash",a.hash);report.addProperty("fixture",requested);report.addProperty("sceneDesign",a.sceneDesign);
                p.load(a);p.coordinates(new BlockPos(32,-60,32));p.show();
                c.player.refreshPositionAndAngles(41.5,-52,12,0,12);c.player.getAbilities().flying=true;c.player.sendAbilitiesUpdate();c.setScreen(null);
                if(Boolean.getBoolean("voxelstudio.iristest")){
                    Class<?> api=Class.forName("net.irisshaders.iris.api.v0.IrisApi");Object instance=api.getMethod("getInstance").invoke(null);
                    if(!(boolean)api.getMethod("isShaderPackInUse").invoke(instance))throw new IllegalStateException("Iris shaderpack is not active");
                    report.addProperty("irisShaderPackActive",true);
                }else report.addProperty("irisShaderPackActive",false);
                report.addProperty("distantHorizonsLoaded",FabricLoader.getInstance().isModLoaded("distanthorizons"));
                if(Boolean.getBoolean("voxelstudio.projectionbaseline"))p.visible=false;
                stage=1;ticks=0;
            }else if(stage==1&&!p.renderer.building){
                if(Boolean.getBoolean("voxelstudio.projectionbaseline")){
                    if(ticks<120)return;report.addProperty("baselineWithoutProjection",true);report.addProperty("result","passed");
                    Files.writeString(directory.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));stage=99;c.scheduleStop();return;
                }
                if(p.renderer.error!=null)throw new IllegalStateException(p.renderer.error);
                p.opacity=sample==0?.2f:.8f;p.materials=sample!=2;capture=true;stage=2;
            }else if(stage==3){
                if(++sample<3){stage=1;ticks=0;return;}
                if(!report.has("sameFrameOpacityVerified")||!report.get("sameFrameOpacityVerified").getAsBoolean())throw new IllegalStateException("Same-frame opacity evidence missing");
                report.addProperty("result","passed");report.addProperty("noGenerationSubmitted",true);report.addProperty("noPlacementSubmitted",true);report.addProperty("customProjectionShader",ProjectionRenderer.program!=null);report.add("frames",frames);
                Files.writeString(directory.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));stage=99;c.scheduleStop();
            }
        }catch(Exception e){fail(c,e);}
    }
    static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&Boolean.getBoolean("voxelstudio.projectiontest");}
    static void beforeMesh(){if(enabled()&&capture){var client=MinecraftClient.getInstance();try{
        int error=GL11.glGetError();if(error!=0)throw new IllegalStateException("Existing GL error: "+error);
        if(sample==0){
            var main=client.getFramebuffer();int draw=GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING),read=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING);int[] viewport=new int[4];GL11.glGetIntegerv(GL11.GL_VIEWPORT,viewport);
            try(var saved=new ProjectionRenderState()){background=new SimpleFramebuffer(main.textureWidth,main.textureHeight,true,MinecraftClient.IS_SYSTEM_MAC);}
            finally{GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,draw);GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,read);RenderSystem.viewport(viewport[0],viewport[1],viewport[2],viewport[3]);}
            copyFrame(main.fbo,background.fbo,main.textureWidth,main.textureHeight);
        }
        before=ScreenshotRecorder.takeScreenshot(client.getFramebuffer());
    }catch(Exception e){fail(client,e);}}}
    static void afterMesh(Matrix4f model,Matrix4f projection,Vec3d camera){
        if(!enabled()||!capture||before==null)return;
        capture=false;var c=MinecraftClient.getInstance();
        try(var after=ScreenshotRecorder.takeScreenshot(c.getFramebuffer());var previous=before){
            int error=GL11.glGetError();if(error!=0)throw new IllegalStateException("Projection GL error: "+error);
            int changed=0;long sum=0;
            for(int y=0;y<after.getHeight();y++)for(int x=0;x<after.getWidth();x++){
                int a=after.getColor(x,y),b=previous.getColor(x,y),delta=0;for(int shift:new int[]{0,8,16})delta+=Math.abs((a>>shift&255)-(b>>shift&255));if(delta>9)changed++;sum+=delta;
            }
            if(changed<200)throw new IllegalStateException("Projection mesh invisible: only "+changed+" pixels changed");
            previous.writeTo(directory.resolve("before-"+sample+".png"));after.writeTo(directory.resolve("mesh-"+sample+".png"));
            if(sample==0)verifyOpacitySameFrame(after,model,projection,camera);
            JsonObject frame=new JsonObject();frame.addProperty("sample",sample);frame.addProperty("changedPixels",changed);frame.addProperty("meanDifference",sum/(double)(after.getWidth()*after.getHeight()));frame.addProperty("opacity",StudioClient.PROJECTION.opacity);frame.addProperty("materials",StudioClient.PROJECTION.materials);frames.add(frame);stage=3;ticks=0;justCaptured=true;
        }catch(Exception e){fail(c,e);}finally{before=null;if(background!=null){background.delete();background=null;}}
    }
    private static void copyFrame(int source,int target,int width,int height){
        int read=GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING),draw=GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING);
        try{GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,source);GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,target);GL30.glBlitFramebuffer(0,0,width,height,0,0,width,height,GL11.GL_COLOR_BUFFER_BIT|GL11.GL_DEPTH_BUFFER_BIT,GL11.GL_NEAREST);}
        finally{GL30.glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER,read);GL30.glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER,draw);}
    }
    private static int differentPixels(NativeImage a,NativeImage b){int changed=0;for(int y=0;y<a.getHeight();y++)for(int x=0;x<a.getWidth();x++){int av=a.getColor(x,y),bv=b.getColor(x,y),delta=0;for(int shift:new int[]{0,8,16})delta+=Math.abs((av>>shift&255)-(bv>>shift&255));if(delta>9)changed++;}return changed;}
    private static void verifyOpacitySameFrame(NativeImage low,Matrix4f model,Matrix4f projection,Vec3d camera)throws Exception{
        var client=MinecraftClient.getInstance();var main=client.getFramebuffer();var p=StudioClient.PROJECTION;
        // Restore the exact same world color AND depth; no second world frame or entity movement.
        copyFrame(background.fbo,main.fbo,main.textureWidth,main.textureHeight);p.renderer.draw(model,projection,.2f,p.materials,camera);
        try(var repeat=ScreenshotRecorder.takeScreenshot(main)){
            int repeatChanges=differentPixels(low,repeat);report.addProperty("sameOpacityRepeatChangedPixels",repeatChanges);
            if(repeatChanges!=0)throw new IllegalStateException("Same-opacity redraw was not deterministic: "+repeatChanges);
        }
        copyFrame(background.fbo,main.fbo,main.textureWidth,main.textureHeight);p.renderer.draw(model,projection,.8f,p.materials,camera);
        try(var high=ScreenshotRecorder.takeScreenshot(main)){
            int changes=differentPixels(low,high);report.addProperty("sameFrameOpacityChangedPixels",changes);high.writeTo(directory.resolve("opacity-high-same-frame.png"));
            if(changes<200)throw new IllegalStateException("Changing opacity did not visibly change the same-frame mesh");
        }
        copyFrame(background.fbo,main.fbo,main.textureWidth,main.textureHeight);p.renderer.draw(model,projection,p.opacity,p.materials,camera);
        report.addProperty("sameFrameOpacityVerified",true);report.addProperty("opacityTest","Same background, camera and depth; identical-alpha negative control plus 0.2/0.8 pixel difference. No assumed linear response through multiple surfaces.");
    }
    static void afterWorld(){if(enabled()&&justCaptured){justCaptured=false;int error=GL11.glGetError();if(error!=0)fail(MinecraftClient.getInstance(),new IllegalStateException("Projection outline/state GL error: "+error));else report.addProperty("outlineStateGlCheck",true);}}
    private static void fail(MinecraftClient c,Throwable error){stage=99;capture=false;System.err.println("VOXEL_PROJECTION_QA_FAILED "+error);if(directory!=null)try{Files.writeString(directory.resolve("failure.txt"),error.toString());report.addProperty("result","failed");report.addProperty("error",error.toString());report.add("frames",frames);Files.writeString(directory.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));}catch(Exception ignored){}c.scheduleStop();}
}
