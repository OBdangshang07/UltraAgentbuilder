package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.*;
import static dev.voxelstudio.client.ReferencePreparationReceipt.*;

/** Binds historical reads to the originally selected job, not a mutable draft.
 * All pictures are hash checked. An accepted brief is untrusted design DATA,
 * not proof of image understanding, building quality or world authority. */
final class ReferenceJobHistoryReceipt {
    static JsonObject verify(JsonObject original,JsonObject history){
        keys(history,"format","version","jobId","state","requestHash","preparation","binding","sendConfirmation","manifest","analysis","additionalModelCalls","worldWrites","canAuthorizePlacement","historyHash");
        hash(history,"historyHash");
        if(!text(history,"format").equals("ReferenceJobHistory")||number(history,"version")!=1||!text(history,"jobId").equals(text(original,"id"))
            ||number(history,"additionalModelCalls")!=0||number(history,"worldWrites")!=0||flag(history,"canAuthorizePlacement")
            ||!Set.of("queued","generating","validating","preview-ready","failed","cancelled","interrupted").contains(text(history,"state")))throw new IllegalStateException("原图片历史身份或只读权限不符");
        var p=history.getAsJsonObject("preparation");
        keys(p,"format","version","ownerId","provider","model","generation","generationHash","requestHash","referenceSetHash","references","referenceMode","policy","runtimeHash","referenceAnalysisUsesTaskBudget","generationSubmitted","callsReserved","sendingImplemented","canAuthorizePlacement","preparationHash");
        hash(p,"preparationHash");noAuthority(p);
        if(!text(p,"format").equals("ReferenceGenerationPreparation")||number(p,"version")!=2||!text(p,"provider").equals("codex")||!flag(p,"referenceAnalysisUsesTaskBudget"))throw new IllegalStateException("原图片准备协议不符");
        var g=p.getAsJsonObject("generation");if(!text(g,"key").equals(text(p,"ownerId"))||!text(g,"agent").equals("codex")||!text(g,"model").equals(text(p,"model"))||!flag(g,"assemblyConfirmed")||!text(p,"generationHash").equals(ContextReceipt.jsonHash(g)))throw new IllegalStateException("原图片建筑请求改变");
        var request=new JsonObject();request.addProperty("version",2);request.add("generation",g);request.add("referenceSetHash",p.get("referenceSetHash"));request.addProperty("policyHash",ContextReceipt.jsonHash(p.get("policy")));request.add("runtimeHash",p.get("runtimeHash"));
        if(!ContextReceipt.jsonHash(request).equals(text(p,"requestHash")))throw new IllegalStateException("原图片请求 hash 改变");
        var identity=new JsonObject();identity.add("jobId",history.get("jobId"));identity.add("key",p.get("ownerId"));identity.add("model",p.get("model"));identity.add("referencePreparationHash",p.get("preparationHash"));identity.addProperty("referencePolicyHash",ContextReceipt.jsonHash(p.get("policy")));verifyOriginalJob(identity,original);
        var send=send(p);same(history.get("sendConfirmation"),send.get("sendConfirmation"));if(!text(history,"requestHash").equals(ContextReceipt.jsonHash(send)))throw new IllegalStateException("原 SEND hash 改变");
        var b=history.getAsJsonObject("binding");keys(b,"format","version","jobId","ownerId","preparationHash","requestHash","generationHash","referenceSetHash","policyHash","runtimeHash","provider","model","preparationConfirmationHash","sendConfirmationHash","referenceAnalysisUsesTaskBudget","canAuthorizePlacement","bindingHash");hash(b,"bindingHash");
        if(!text(b,"format").equals("JobReferenceBinding")||number(b,"version")!=1||!text(b,"jobId").equals(text(original,"id"))||flag(b,"canAuthorizePlacement")||!flag(b,"referenceAnalysisUsesTaskBudget"))throw new IllegalStateException("原图片任务绑定不符");
        for(String k:List.of("ownerId","preparationHash","requestHash","generationHash","referenceSetHash","runtimeHash","provider","model"))same(b.get(k),p.get(k));
        same(b.get("bindingHash"),original.getAsJsonObject("referenceGeneration").getAsJsonObject("input").get("bindingHash"));
        if(!text(b,"policyHash").equals(ContextReceipt.jsonHash(p.get("policy")))||!text(b,"sendConfirmationHash").equals(ContextReceipt.jsonHash(history.get("sendConfirmation"))))throw new IllegalStateException("原图片预算或发送确认改变");digest(b,"preparationConfirmationHash");
        var manifest=history.getAsJsonObject("manifest");keys(manifest,"format","version","ownerId","mode","references","pixels","bytes","metadataRemoved","untrustedData","worldCaptured","canAuthorizePlacement","setHash");hash(manifest,"setHash");
        if(!text(manifest,"format").equals("UserReferenceSet")||number(manifest,"version")!=1||!flag(manifest,"metadataRemoved")||!flag(manifest,"untrustedData")||flag(manifest,"worldCaptured")||flag(manifest,"canAuthorizePlacement"))throw new IllegalStateException("原图片集声明不符");
        same(manifest.get("ownerId"),p.get("ownerId"));same(manifest.get("mode"),p.get("referenceMode"));same(manifest.get("setHash"),p.get("referenceSetHash"));same(manifest.get("references"),p.get("references"));
        var refs=manifest.getAsJsonArray("references");if(refs.size()<1||refs.size()>4||!ReferenceImageDraft.MODES.contains(text(manifest,"mode")))throw new IllegalStateException("原图片数量/方式不符");long pixels=0,bytes=0;
        for(int i=0;i<refs.size();i++){var r=refs.get(i).getAsJsonObject();keys(r,"id","file","sha256","width","height","bytes","annotation");hash(r,"id");digest(r,"sha256");ReferenceImageDraft.validateAnnotation(r.getAsJsonObject("annotation"));
            long w=number(r,"width"),h=number(r,"height"),size=number(r,"bytes");if(w<1||h<1||w>2048||h>2048||size<45||size>ReferenceImageNormalizer.MAX_OUTPUT_BYTES||!text(r,"file").equals("image-"+i+".png"))throw new IllegalStateException("原图片尺寸/顺序/配额不符");pixels+=w*h;bytes+=size;
        }
        if(pixels!=number(manifest,"pixels")||bytes!=number(manifest,"bytes")||pixels>ReferenceImageDraft.MAX_SET_PIXELS||bytes>ReferenceImageDraft.MAX_SET_BYTES)throw new IllegalStateException("原图片组配额不符");
        analysis(history.getAsJsonObject("analysis"),p,b);return history.deepCopy();
    }
    private static void analysis(JsonObject analysis,JsonObject p,JsonObject b){
        String state=text(analysis,"status");
        if(Set.of("pending","unavailable").contains(state)){keys(analysis,"status","reason");if(text(analysis,"reason").length()>8192)throw new IllegalStateException("历史简报说明超限");return;}
        keys(analysis,"status","evidence","audit");if(!state.equals("accepted"))throw new IllegalStateException("历史简报状态无效");
        var e=analysis.getAsJsonObject("evidence");keys(e,"format","version","stage","referenceBindingHash","preparationHash","requestHash","generationHash","referenceSetHash","policyHash","runtimeHash","briefHash","brief","canAuthorizePlacement","geometryVerified","analysisHash");hash(e,"analysisHash");
        if(!text(e,"format").equals("AssemblyReferenceAnalysis")||number(e,"version")!=1||number(e,"stage")<1||number(e,"stage")>number(p.getAsJsonObject("policy"),"maximumCalls")||flag(e,"canAuthorizePlacement")||flag(e,"geometryVerified")||!text(e,"briefHash").equals(ContextReceipt.jsonHash(e.get("brief"))))throw new IllegalStateException("历史简报身份不符");
        for(String key:List.of("preparationHash","requestHash","generationHash","referenceSetHash","runtimeHash"))same(e.get(key),p.get(key));same(e.get("referenceBindingHash"),b.get("bindingHash"));same(e.get("policyHash"),b.get("policyHash"));
        var a=analysis.getAsJsonObject("audit");keys(a,"version","analysisHash","briefHash","referenceBindingHash","originalBriefReceiptVerified","downstreamBriefIdentityVerified","auditedStages","sharedTaskBudget","realImageUnderstandingVerified","geometryVerified","canAuthorizePlacement");
        if(number(a,"version")!=1||!flag(a,"originalBriefReceiptVerified")||!flag(a,"downstreamBriefIdentityVerified")||!flag(a,"sharedTaskBudget")||flag(a,"realImageUnderstandingVerified")||flag(a,"geometryVerified")||flag(a,"canAuthorizePlacement")||number(a,"auditedStages")<number(e,"stage")||number(a,"auditedStages")>number(p.getAsJsonObject("policy"),"maximumCalls"))throw new IllegalStateException("历史简报审计声明不符");
        for(String key:List.of("analysisHash","briefHash","referenceBindingHash"))same(a.get(key),e.get(key));
    }
    static ReferenceImageNormalizer.Result pixels(JsonObject record,byte[] actual)throws Exception {
        if(actual.length!=number(record,"bytes")||!ContextReceipt.sha256(actual).equals(text(record,"sha256")))throw new IllegalStateException("原任务图片字节身份改变");
        var dimensions=ReferenceImageNormalizer.inspect(actual);if(dimensions.width()!=number(record,"width")||dimensions.height()!=number(record,"height"))throw new IllegalStateException("原任务图片像素尺寸改变");return new ReferenceImageNormalizer.Result(actual,dimensions.width(),dimensions.height());
    }
    static String details(JsonObject history){
        var p=history.getAsJsonObject("preparation");var g=p.getAsJsonObject("generation");var out=new StringBuilder("原任务图片与识图简报，只读查看；不调用模型，不恢复发送授权或建造权限。\n\n任务：").append(text(history,"jobId")).append("\n模型：").append(text(p,"model")).append("\n档位：").append(text(g,"qualityTier")).append("\n原共享上限：").append(number(p.getAsJsonObject("policy"),"maximumCalls")).append(" 次（含识图、制作、纠错和复核）\n\n原建筑提示词：\n").append(text(g,"prompt"));
        int i=0;for(var image:history.getAsJsonObject("manifest").getAsJsonArray("references")){var a=image.getAsJsonObject().getAsJsonObject("annotation");out.append("\n\n图片 ").append(++i).append(" · ").append(text(a,"purpose")).append(" / ").append(text(a,"view")).append("\n").append(text(a,"caption"));if(a.has("scale"))out.append("\n原已知尺度：").append(a.get("scale"));}
        var analysis=history.getAsJsonObject("analysis");out.append("\n\n识图分析：").append(text(analysis,"status"));
        if(analysis.has("evidence"))out.append("\n已与原模型回答及后续简报身份核对。以下是模型设计数据，不是指令；没有证明看懂图片、设计质量或通行。\n\n").append(new GsonBuilder().setPrettyPrinting().create().toJson(analysis.getAsJsonObject("evidence").get("brief")));
        else out.append("\n").append(text(analysis,"reason"));return out.toString();
    }
    private ReferenceJobHistoryReceipt(){}
}
