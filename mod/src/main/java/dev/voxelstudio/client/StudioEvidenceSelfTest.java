package dev.voxelstudio.client;

import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import java.nio.file.*;

/** Explicit isolated visible asset renderer for offline acceptance and already
 * authorized live jobs. It cannot submit jobs or load/write a world. */
final class StudioEvidenceSelfTest {
    private static int ticks;private static boolean ready,pending,stopped;private static long started;private static String lastJob;private static JsonObject processIdentity;
    static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&System.getProperty("voxelstudio.evidenceTestRoot")!=null;}
    static Path root()throws Exception{
        Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize(),base=game.resolve("../../build").normalize().toRealPath(),root=Path.of(System.getProperty("voxelstudio.evidenceTestRoot")).toRealPath();
        Path development=game.getParent().getParent();
        boolean sourceFork=development.getFileName().toString().matches("p3-selection-development-[a-f0-9]{32}");
        if(sourceFork){
            if(!game.toRealPath().equals(development.resolve("mod/run").toRealPath()))throw new IllegalStateException("Redirected source-fork renderer");
            var copy=JsonParser.parseString(Files.readString(development.resolve("development-workspace.json"))).getAsJsonObject();
            if(!"source-only-selection-development-workspace".equals(copy.get("type").getAsString())||!"passed".equals(copy.get("result").getAsString())||!copy.get("developmentOnly").getAsBoolean()||!Path.of(copy.get("root").getAsString()).equals(development)||copy.get("worldsCopied").getAsBoolean()||copy.get("accountDataCopied").getAsBoolean())throw new IllegalStateException("Invalid independent asset renderer identity");
        }
        if(!sourceFork&&!game.toString().replace('\\','/').endsWith("/voxel/mod/run")||!root.getParent().equals(base)||!root.getFileName().toString().matches("quality-native-[a-f0-9]{32}"))throw new IllegalStateException("Unsafe isolated evidence root");
        var marker=JsonParser.parseString(Files.readString(root.resolve("renderer-authorization.json"))).getAsJsonObject();var connection=JsonParser.parseString(Files.readString(root.resolve("data/connection.json"))).getAsJsonObject();
        if(!marker.get("assetOnly").getAsBoolean()||!marker.get("visibleWindowAuthorized").getAsBoolean()||marker.get("bridgePid").getAsLong()!=connection.get("pid").getAsLong())throw new IllegalStateException("Renderer authorization mismatch");return root;
    }
    static void tick(MinecraftClient c){
        if(!enabled()||stopped)return;
        try{
            Path output=root();
            if(processIdentity==null){
                var marker=JsonParser.parseString(Files.readString(output.resolve("renderer-authorization.json"))).getAsJsonObject();
                String instance=marker.get("instanceId").getAsString();if(!instance.matches("[a-f0-9-]{36}"))throw new IllegalStateException("Invalid renderer instance");
                var identity=new JsonObject();identity.addProperty("instanceId",instance);identity.addProperty("pid",ProcessHandle.current().pid());
                identity.addProperty("startedAt",ProcessHandle.current().info().startInstant().orElseThrow().toEpochMilli());
                Files.writeString(output.resolve("renderer-process.json"),identity.toString(),StandardOpenOption.CREATE_NEW);processIdentity=identity;
            }
            if(c.world!=null||c.getServer()!=null)throw new IllegalStateException("Evidence harness must never load a world");
            if(c.currentScreen instanceof net.minecraft.client.gui.screen.AccessibilityOnboardingScreen){c.options.onboardAccessibility=false;c.options.write();c.setScreen(new TitleScreen());return;}
            if(!(c.currentScreen instanceof TitleScreen)||c.getOverlay()!=null||ProjectionRenderer.program==null)return;
            long handle=c.getWindow().getHandle();if(org.lwjgl.glfw.GLFW.glfwGetWindowAttrib(handle,org.lwjgl.glfw.GLFW.GLFW_VISIBLE)!=org.lwjgl.glfw.GLFW.GLFW_TRUE)throw new IllegalStateException("Evidence harness requires authorized visible window");
            if(started==0)started=System.nanoTime();
            if(!ready&&!pending){pending=true;StudioNativeEvidence.ready().whenComplete((r,e)->c.execute(()->{pending=false;if(e!=null){failure(c,e);return;}ready=true;try{Files.writeString(output.resolve("renderer-ready.json"),"{\"ready\":true,\"assetOnly\":true,\"visible\":true}",StandardOpenOption.CREATE_NEW);}catch(Exception x){failure(c,x);}}));return;}
            if(!ready||pending||++ticks%20!=0)return;
            Path control=output.resolve("renderer-control.json");if(!Files.isRegularFile(control))return;
            var command=JsonParser.parseString(Files.readString(control)).getAsJsonObject();
            if(command.has("stop")&&command.get("stop").getAsBoolean()){
                var result=new JsonObject();result.addProperty("result","passed");result.addProperty("version",StudioRuntimeVersion.loaded());result.addProperty("assetOnly",true);result.addProperty("worldLoaded",false);result.addProperty("generationSubmittedByClient",false);result.addProperty("visible",true);result.addProperty("lastJobId",lastJob);result.addProperty("seconds",(System.nanoTime()-started)/1e9);
                result.add("processIdentity",processIdentity.deepCopy());
                Files.writeString(output.resolve("renderer-result.json"),result.toString(),StandardOpenOption.CREATE_NEW);stopped=true;StudioNativeEvidence.clear();c.scheduleStop();return;
            }
            if(!command.has("jobId"))return;String id=command.get("jobId").getAsString();if(!id.matches("[0-9a-f-]{36}"))throw new IllegalStateException("Invalid observed job");lastJob=id;pending=true;
            StudioClient.BRIDGE.request("GET","/v1/jobs/"+id,null).whenComplete((job,error)->c.execute(()->{pending=false;if(error!=null){failure(c,error);return;}StudioNativeEvidence.observe(job);}));
        }catch(Exception error){failure(c,error);}
    }
    private static void failure(MinecraftClient c,Throwable error){stopped=true;System.err.println("VOXEL_NATIVE_EVIDENCE_TEST FAILED "+error);try{var failure=new JsonObject();failure.addProperty("error",error.toString());Files.writeString(root().resolve("renderer-failure.json"),failure.toString());}catch(Exception ignored){}StudioNativeEvidence.clear();c.scheduleStop();}
}
