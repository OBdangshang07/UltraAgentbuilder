package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.util.math.BlockPos;
import java.util.concurrent.CompletableFuture;

/** Background asset-only capture. Uses neither screens, the world nor desktop
 * automation. Observes only the already submitted task tracked by the panel. */
final class StudioNativeEvidence {
    private static boolean enabled,heartbeatPending,loading,uploading,downloadRetry;
    private static int ticks,index,uploadAttempts,loadAttempts,retryTick;
    private static long epoch,started;
    private static String jobId,evidenceId,status="";
    private static NativeEvidenceRequest request;
    private static Asset asset;
    private static ProjectionRenderer renderer;
    private static JsonObject upload;
    private static final JsonArray frames=new JsonArray();
    static String status(){return status;}
    static CompletableFuture<JsonObject> ready(){
        if(ProjectionRenderer.program==null)return CompletableFuture.failedFuture(new IllegalStateException("原生渲染器尚未加载，没有提交生成"));
        enabled=true;var body=new JsonObject();body.addProperty("renderer",NativeEvidenceRequest.RENDERER);body.addProperty("assetOnly",true);
        return StudioClient.BRIDGE.request("POST","/v1/renderers/heartbeat",body);
    }
    static void observe(JsonObject job){
        String state=job.get("state").getAsString();
        if(java.util.Set.of("failed","cancelled","interrupted","preview-ready").contains(state)){if(jobId!=null&&jobId.equals(job.get("id").getAsString()))clear();return;}
        if(!job.has("nativeEvidence"))return;var evidence=job.getAsJsonObject("nativeEvidence");
        if(!"waiting".equals(evidence.get("state").getAsString()))return;
        String next=evidence.get("id").getAsString(),nextJob=job.get("id").getAsString();
        if(next.equals(evidenceId)&&nextJob.equals(jobId))return;
        clear();enabled=true;jobId=nextJob;evidenceId=next;
        try{
            if(!nextJob.matches("[0-9a-f-]{36}"))throw new IllegalStateException("Invalid render job");
            request=NativeEvidenceRequest.parse(evidence.getAsJsonObject("request"));
            if(!request.hash().equals(next))throw new IllegalStateException("Evidence request changed");
            load();
        }catch(Exception error){status="原生证据请求被拒绝："+error.getMessage();}
    }
    private static void load(){
        long ticket=epoch;loading=true;downloadRetry=false;loadAttempts++;status="正在加载原生视觉证据资产（不修改世界）";
        StudioClient.BRIDGE.loadEvidence(jobId,request).whenComplete((result,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=epoch)return;loading=false;
            if(error!=null){downloadRetry=loadAttempts<3;retryTick=ticks+40;status="原生证据加载失败（仅重试读取，不调用模型）："+StudioMessages.error(error);return;}
            asset=result;renderer=new ProjectionRenderer();beginView();
        }));
    }
    private static void beginView(){
        var v=request.views().get(index);renderer.minX=v.min().get(0);renderer.maxX=v.max().get(0);renderer.minLayer=v.min().get(1);renderer.cutLayer=v.max().get(1)-1;renderer.minZ=v.min().get(2);renderer.maxZ=v.max().get(2);
        renderer.rebuild(new Placement(asset,BlockPos.ORIGIN,0,false,0,false));started=System.nanoTime();status="原生视觉证据 "+(index+1)+"/"+request.views().size()+" · "+v.purpose();
    }
    static void tick(MinecraftClient client){
        ticks++;
        if(enabled&&!heartbeatPending&&ticks%200==0&&ProjectionRenderer.program!=null){heartbeatPending=true;ready().whenComplete((r,e)->client.execute(()->heartbeatPending=false));}
        if(downloadRetry&&!loading&&ticks>=retryTick){load();return;}
        if(upload!=null&&!uploading&&uploadAttempts<3&&ticks>=retryTick){send();return;}
        if(renderer==null||loading||uploading||upload!=null||client.getOverlay()!=null)return;
        try{
            if(renderer.building){if(System.nanoTime()-started>120_000_000_000L)throw new IllegalStateException("原生证据网格超时");return;}
            if(renderer.error!=null)throw new IllegalStateException(renderer.error);
            var view=request.views().get(index);long before=renderer.completedDraws;
            String png=AssetReviewCapture.captureView(asset,renderer,view);
            var frame=new JsonObject();frame.addProperty("id",view.id());frame.addProperty("png",png);frame.addProperty("faces",renderer.faceCount);frame.addProperty("draws",renderer.completedDraws-before);frames.add(frame);
            if(++index<request.views().size()){beginView();return;}
            renderer.close();renderer=null;upload=new JsonObject();upload.addProperty("requestHash",evidenceId);upload.addProperty("renderer",NativeEvidenceRequest.RENDERER);upload.add("views",frames.deepCopy());send();
        }catch(Exception error){status="原生视觉证据失败（未静默降级）："+error.getMessage();if(renderer!=null){renderer.close();renderer=null;}}
    }
    private static void send(){
        uploading=true;uploadAttempts++;long ticket=epoch;status="正在回传已绑定建筑版本的原生证据";
        StudioClient.BRIDGE.request("POST","/v1/jobs/"+jobId+"/native-evidence/"+evidenceId+"/upload",upload).whenComplete((r,e)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=epoch)return;uploading=false;
            if(e!=null){retryTick=ticks+40;status="原生证据回执待核实；只重传同一图片，不调用模型："+StudioMessages.error(e);return;}
            status="原生证据已提交，继续自动复核";upload=null;asset=null;
        }));
    }
    static void clear(){epoch++;if(renderer!=null)renderer.close();renderer=null;request=null;asset=null;upload=null;frames.asList().clear();jobId=null;evidenceId=null;index=0;uploadAttempts=0;loadAttempts=0;downloadRetry=false;loading=false;uploading=false;enabled=false;status="";}
}
