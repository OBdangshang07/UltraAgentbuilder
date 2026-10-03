package dev.voxelstudio.client;

import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL11;
import java.nio.file.*;
import java.util.UUID;

/** Explicit dev-only no-world baseline. Vanilla title rendering and swapBuffers remain active. */
public final class StudioPresentationSelfTest {
    private static final boolean REQUESTED=Boolean.getBoolean("voxelstudio.presentationProbe");
    private static final IsolatedTestWindow WINDOW=new IsolatedTestWindow(Boolean.getBoolean("voxelstudio.presentationVisible")?"visible":"transition");
    private static final JsonObject report=new JsonObject();
    private static long started,frames;
    private static int lastInterval=-1;
    private static boolean finished;
    private static Path evidence;
    public static void afterFrame(){if(REQUESTED&&!finished&&started!=0&&FabricLoader.getInstance().isDevelopmentEnvironment())frames++;}
    static void tick(MinecraftClient c){
        if(!REQUESTED||finished||!FabricLoader.getInstance().isDevelopmentEnvironment())return;
        try{
            Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
            if(!game.toString().replace('\\','/').endsWith("/voxel/mod/run")||c.world!=null||c.getServer()!=null||StudioSelfTest.enabled())throw new IllegalStateException("Presentation probe must be isolated and never load a world");
            long handle=c.getWindow().getHandle();
            WINDOW.maintain(()->GLFW.glfwGetWindowAttrib(handle,GLFW.GLFW_VISIBLE)==GLFW.GLFW_TRUE,()->GLFW.glfwHideWindow(handle));
            c.options.pauseOnLostFocus=false;
            if(!(c.currentScreen instanceof TitleScreen)||c.getOverlay()!=null)return;
            if(started==0){
                started=System.nanoTime();String run=UUID.randomUUID().toString();
                Files.createDirectories(game.resolve("presentation-probes"));evidence=game.resolve("presentation-probes/"+run+".json");
                report.addProperty("type","isolated-vanilla-menu-presentation-probe");report.addProperty("result","running");
                report.addProperty("noWorldLoaded",true);report.addProperty("noGenerationSubmitted",true);report.addProperty("projectionLoaded",false);
                report.addProperty("windowMode",WINDOW.mode());
                report.addProperty("openGlVendor",GL11.glGetString(GL11.GL_VENDOR));report.addProperty("openGlRenderer",GL11.glGetString(GL11.GL_RENDERER));report.addProperty("openGlVersion",GL11.glGetString(GL11.GL_VERSION));
                report.addProperty("gameVsyncOption",c.options.getEnableVsync().getValue());
                boolean noVsync=Boolean.getBoolean("voxelstudio.presentationNoVsync");
                report.addProperty("contextVsyncDisabledForProbe",noVsync);
                // Context-only diagnostic setting. Never writes options.txt or driver profiles.
                if(noVsync)GLFW.glfwSwapInterval(0);
                Files.writeString(evidence,report.toString(),StandardOpenOption.CREATE_NEW);
            }
            long seconds=(System.nanoTime()-started)/1_000_000_000L;
            if(seconds/15!=lastInterval){lastInterval=(int)(seconds/15);write(seconds,"running");}
            if(seconds>=240){
                if(frames<180)throw new IllegalStateException("Insufficient actual title-screen render frames");
                write(seconds,"passed");finished=true;GLFW.glfwSwapInterval(c.options.getEnableVsync().getValue()?1:0);c.scheduleStop();
            }
        }catch(Exception e){
            report.addProperty("error",e.toString());report.addProperty("result","failed");
            try{if(evidence!=null)write(started==0?0:(System.nanoTime()-started)/1_000_000_000L,"failed");}catch(Exception ignored){}
            System.err.println("VOXEL_PRESENTATION_PROBE_FAILED "+e);finished=true;GLFW.glfwSwapInterval(c.options.getEnableVsync().getValue()?1:0);c.scheduleStop();
        }
    }
    private static void write(long seconds,String result)throws Exception{
        report.addProperty("result",result);report.addProperty("elapsedSeconds",seconds);report.addProperty("renderedFrames",frames);report.addProperty("hideRequests",WINDOW.hideRequests());
        report.addProperty("limitation","No-world diagnostic baseline, not building placement acceptance or proof of production stability");
        Path pending=evidence.resolveSibling(evidence.getFileName()+".tmp");Files.writeString(pending,new GsonBuilder().setPrettyPrinting().create().toJson(report));
        Files.move(pending,evidence,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        System.out.println("VOXEL_PRESENTATION_PROBE "+result+" seconds="+seconds+" frames="+frames+" evidence="+evidence);
    }
}
