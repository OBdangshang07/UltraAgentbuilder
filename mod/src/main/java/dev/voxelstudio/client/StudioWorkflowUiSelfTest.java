package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.util.ScreenshotRecorder;
import java.nio.file.*;

/** Explicit development-only UI rendering. No world, account discovery or model requests. */
final class StudioWorkflowUiSelfTest {
    private static int stage,ticks,index;
    private static long started;
    private static Path output;
    private static JsonObject current;
    private static final JsonArray frames=new JsonArray();
    static void tick(MinecraftClient client) {
        if(!FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uiworkflowtest")||stage==99)return;
        try {
            Path source=Path.of(System.getProperty("voxelstudio.uiWorkflowSource")).toRealPath();
            Path game=FabricLoader.getInstance().getGameDir().toRealPath();
            if(!game.equals(source.resolve("mod/build/ui-workflow-game"))||client.world!=null||client.getServer()!=null)throw new IllegalStateException("Only the explicitly bound UI-only instance is allowed");
            if(started==0){started=System.nanoTime();output=game.resolve("ui-captures/"+System.currentTimeMillis());Files.createDirectories(output);Files.writeString(output.resolve("initial-screen.txt"),client.currentScreen==null?"null":client.currentScreen.getClass().getName(),StandardOpenOption.CREATE_NEW);}
            if(System.nanoTime()-started>180_000_000_000L)throw new IllegalStateException("UI-only test deadline exceeded at stage "+stage+", view "+index+", screen "+(client.currentScreen==null?"null":client.currentScreen.getClass().getName()));
            if(stage==0) {
                if(client.getOverlay()!=null)return;
                if(client.currentScreen!=null&&client.currentScreen.getClass().getSimpleName().equals("AccessibilityOnboardingScreen")){client.setScreen(new TitleScreen());return;}
                if(!(client.currentScreen instanceof TitleScreen)||++ticks<40)return;
                StudioScreen.prepareWorkflowUiFixture();
                Path fixture=source.resolve("mod/build/test-fixtures");
                StudioClient.PROJECTION.load(new Asset("ui-workflow-fixture",JsonParser.parseString(Files.readString(fixture.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(fixture.resolve("cells.bin"))));
                stage=1;ticks=0;
            } else if(stage==1) {
                if(StudioClient.PROJECTION.renderer.building)return;
                if(StudioClient.PROJECTION.renderer.error!=null)throw new IllegalStateException(StudioClient.PROJECTION.renderer.error);
                client.getWindow().setScaleFactor(new int[]{4,3,2}[index/14]);
                var screen=new StudioScreen();client.setScreen(screen);current=screen.auditWorkflowUi(index%14);
                current.addProperty("width",client.getWindow().getScaledWidth());current.addProperty("height",client.getWindow().getScaledHeight());
                stage=2;ticks=0;
            } else if(stage==2&&++ticks>=8) {
                for(var child:client.currentScreen.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget widget&&widget.visible&&(widget.getX()<0||widget.getY()<0||widget.getX()+widget.getWidth()>client.currentScreen.width||widget.getY()+widget.getHeight()>client.currentScreen.height))throw new IllegalStateException("Visible control outside viewport: "+widget.getMessage().getString());
                String name=String.format("%02d-%s-%dx%d.png",index,current.get("view").getAsString(),client.getWindow().getScaledWidth(),client.getWindow().getScaledHeight());
                try(var image=ScreenshotRecorder.takeScreenshot(client.getFramebuffer())){image.writeTo(output.resolve(name));}
                current.addProperty("frame",name);frames.add(current);index++;stage=index<42?1:3;
            } else if(stage==3) {
                var report=new JsonObject();report.addProperty("result","passed");report.addProperty("version",StudioRuntimeVersion.loaded());report.addProperty("worldLoaded",false);report.addProperty("modelCalls",0);report.addProperty("accountDiscovery",false);report.add("frames",frames);
                Files.writeString(output.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report),StandardOpenOption.CREATE_NEW);
                System.out.println("ULTRAAGENTBUILDER_UI_WORKFLOW_PASSED "+output);stage=99;client.scheduleStop();
            }
        } catch(Exception error) {
            stage=99;System.err.println("ULTRAAGENTBUILDER_UI_WORKFLOW_FAILED "+error);error.printStackTrace();
            if(output!=null)try{Files.writeString(output.resolve("failure.txt"),error.toString(),StandardOpenOption.CREATE_NEW);}catch(Exception ignored){}
            client.scheduleStop();
        }
    }
}
