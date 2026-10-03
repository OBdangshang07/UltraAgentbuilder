package dev.voxelstudio.selection;

import com.google.gson.*;
import java.lang.management.ManagementFactory;
import net.fabricmc.loader.api.FabricLoader;

/** Development-only observed Fabric tick / GameRenderer CPU spans. Not total
 * frame latency, GPU time or unobserved allocation peaks. No world access. */
public final class SelectionPerformanceProbe {
    private static volatile boolean active;
    private static SelectionTimings server,render;
    private static long serverStarted,renderStarted,peakObservedHeap;
    private static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&System.getProperty("voxelstudio.selectionTestRoot")!=null;}
    public static synchronized void start(){if(!enabled())throw new IllegalStateException("Not an isolated development probe");server=new SelectionTimings();render=new SelectionTimings();peakObservedHeap=0;serverStarted=renderStarted=0;active=true;}
    public static synchronized void serverStart(){if(active)serverStarted=System.nanoTime();}
    public static synchronized void serverEnd(){if(active&&serverStarted!=0){server.record(System.nanoTime()-serverStarted);serverStarted=0;}}
    public static synchronized void renderStart(){if(active)renderStarted=System.nanoTime();}
    public static synchronized void renderEnd(){if(active&&renderStarted!=0){render.record(System.nanoTime()-renderStarted);renderStarted=0;peakObservedHeap=Math.max(peakObservedHeap,ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getUsed());}}
    public static synchronized JsonObject stop(){
        if(!enabled()||!active)throw new IllegalStateException("No active performance probe");active=false;
        var json=new JsonObject();var gson=new Gson();json.add("fabricServerTickSpan",gson.toJsonTree(server.finish()));json.add("gameRendererCpuSpan",gson.toJsonTree(render.finish()));
        json.addProperty("sampledPeakHeapBytes",peakObservedHeap);json.addProperty("wholeClientFramePerformanceVerified",false);json.addProperty("gpuTimeMeasured",false);json.addProperty("exactPeakMemoryMeasured",false);
        json.addProperty("scope","Scan plus background finalization; server START/END callback span; GameRenderer.render CPU span excludes swap/vsync and GPU completion");server=render=null;return json;
    }
    private SelectionPerformanceProbe(){}
}
