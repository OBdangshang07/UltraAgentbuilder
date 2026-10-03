package dev.voxelstudio.client;
import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.util.ScreenshotRecorder;
import java.nio.file.*;

/** Opt-in clean first-open test: real local discovery, no model prompts and no world loaded. */
final class StudioOnboardingSelfTest {
    private static int stage,ticks;private static long started;private static Path directory;private static JsonObject report;private static StudioScreen screen;
    static void tick(MinecraftClient c){
        if(!FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.onboardingtest")||stage==99)return;
        try{
            Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
            if(!game.toString().replace('\\','/').endsWith("/voxel/mod/run")||c.world!=null)throw new IllegalStateException("Not a no-world isolated onboarding fixture");
            if(stage==0){if(!(c.currentScreen instanceof TitleScreen)||c.getOverlay()!=null||++ticks<40)return;
                directory=game.resolve("onboarding-qa/"+System.currentTimeMillis());Files.createDirectories(directory);
                if(Files.exists(StudioClient.BRIDGE.dataDirectory()))throw new IllegalStateException("Onboarding data must start empty");
                started=System.nanoTime();screen=new StudioScreen();c.setScreen(screen);stage=1;
            }else if(stage==1){
                if(System.nanoTime()-started>60_000_000_000L)throw new IllegalStateException("Onboarding exceeded 60 seconds");
                var state=StudioScreen.auditAutomaticDiscovery();if(!state.get("complete").getAsBoolean())return;
                if(state.getAsJsonArray("agents").asList().stream().anyMatch(a->a.getAsJsonObject().get("state").getAsString().equals("not-checked")))throw new IllegalStateException("Automatic scan did not run");
                if(state.get("available").getAsInt()>1&&!state.get("multipleRequiresChoice").getAsBoolean())throw new IllegalStateException("Multiple accounts silently selected");
                report=state;stage=2;
                StudioClient.BRIDGE.request("GET","/v1/jobs",null).whenComplete((jobs,error)->c.execute(()->{if(error!=null){fail(c,error);return;}if(!jobs.getAsJsonArray("jobs").isEmpty()){fail(c,new IllegalStateException("Onboarding submitted a job"));return;}report.addProperty("jobCount",0);screen.auditAutomaticChooser();stage=3;ticks=0;}));
            }else if(stage==3&&++ticks>12){
                try(var image=ScreenshotRecorder.takeScreenshot(c.getFramebuffer())){image.writeTo(directory.resolve("agent-detection.png"));}
                report.addProperty("version",StudioRuntimeVersion.loaded());report.addProperty("result","passed");report.addProperty("cleanBuiltinBootstrap",true);report.addProperty("noWorldLoaded",true);report.addProperty("noGenerationSubmitted",true);
                Files.writeString(directory.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));System.out.println("VOXEL_STUDIO_ONBOARDING "+directory+" passed");stage=99;c.scheduleStop();
            }
        }catch(Exception e){fail(c,e);}
    }
    private static void fail(MinecraftClient c,Throwable error){stage=99;System.err.println("VOXEL_STUDIO_ONBOARDING FAILED "+error);if(directory!=null)try{Files.writeString(directory.resolve("failure.txt"),error.toString());}catch(Exception ignored){}c.scheduleStop();}
}
