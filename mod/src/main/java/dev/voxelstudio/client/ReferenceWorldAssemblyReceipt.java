package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Full v2 original identities only. No legacy consent, model dispatch or
 * world-write authority is created by parsing a receipt or retained history. */
final class ReferenceWorldAssemblyReceipt {
    static final String PURPOSE="reference-world-assembly";
    static final int STATUS_BYTES=16384,REQUEST_BYTES=32768,PREPARATION_BYTES=65536;
    private static final String STAGES="same-reference-analysis-concepts-prototypes-components-native-review-pipeline";
    private static final String BUDGET="one-original-shared-ledger-including-analysis-corrections-recovery-and-review";
    private static final String PRIVACY="confirmed-reference-pixels-and-original-block-context-no-HUD-accounts-or-container-content";
    private static void kind(JsonObject v,String format){if(!text(v,"format").equals(format)||number(v,"version")!=2||!text(v,"purpose").equals(PURPOSE))throw new IllegalStateException("完整联合协议/用途改变");}
    static void uuid(String value){if(!value.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw new IllegalStateException("完整联合原 UUID 无效");}
    static int maximum(String tier){return StudioAssembly.tier(tier).maximumCalls();}
    static void generation(JsonObject g){
        uuid(text(g,"key"));
        if(!text(g,"agent").equals("codex")||!text(g,"generationMode").equals("scene")||!text(g,"sceneWorkflow").equals("components")
            ||!flag(g,"assemblyConfirmed")||!text(g,"assemblyRecovery").equals("safe")||!text(g,"assemblyDesignReview").equals("native")
            ||!Set.of("v2","v3","v4").contains(text(g,"assemblyQuality")))throw new IllegalStateException("完整联合需要明确的四档/原生质量/安全恢复请求");
        // Full generation has its own 1..16000 UTF-16-character contract and
        // complete advertised effort set, not the v1 environment intent's
        // 6000-character/six-effort restriction or its single-call consent.
        String prompt=text(g,"prompt");boolean blank=prompt.codePoints().allMatch(ch->ch>=9&&ch<=13||ch==32||ch==0xa0||ch==0x1680||ch>=0x2000&&ch<=0x200a||ch==0x2028||ch==0x2029||ch==0x202f||ch==0x205f||ch==0x3000||ch==0xfeff);
        if(blank||prompt.length()>16000||!text(g,"model").matches("[A-Za-z0-9._:-]{1,128}")||!Set.of("none","minimal","low","medium","high","xhigh","max","ultra").contains(text(g,"effort")))throw new IllegalStateException("完整生成提示词/模型/推理协议不一致");
        if(g.has("assemblyCalls")&&number(g,"assemblyCalls")!=maximum(text(g,"qualityTier")))throw new IllegalStateException("完整联合预算须与原档位一致，不借用一调用确认");
        for(var k:List.of("baseJobId","repairJobId","spec","scenePatch","patch","importDirectory","reviewImages"))if(g.has(k))throw new IllegalStateException("不能替换原联合请求或继承其他任务");
    }
    static void capability(JsonObject c,JsonObject g){
        keys(c,"id","supportsImages","efforts");
        if(!text(c,"id").equals(text(g,"model"))||!flag(c,"supportsImages"))throw new IllegalStateException("原所选模型必须明确支持图像");
        var values=c.getAsJsonArray("efforts");var unique=new HashSet<String>();
        if(values.size()<1||values.size()>16)throw new IllegalStateException("图像能力配额无效");
        for(var v:values)if(!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString()||!Set.of("none","minimal","low","medium","high","xhigh","max","ultra").contains(v.getAsString())||!unique.add(v.getAsString()))throw new IllegalStateException("原图像推理能力无效");
        if(!unique.contains(text(g,"effort")))throw new IllegalStateException("原推理强度未声明");
    }
    static JsonObject preparation(JsonObject p,JsonObject g){
        keys(p,"format","version","purpose","jobId","contextId","recordHash","payloadSha256","recordExpiresAt","referenceBindingHash","referenceSetHash","referencePreparationHash","generationHash","policyHash","runtimeHash","selected","tier","maximumCalls","providerRetries","snapshotHash","selectionHash","worldContextHash","origin","maximumBounds","imageCount","imageAnnotations","stages","budget","privacy","sourceAuthority","v1ConsentTransferable","state","modelSent","callsReserved","serverBaselineVerified","canAuthorizePlacement","preparationHash");
        kind(p,"ReferenceWorldAssemblyPreparation");generation(g);hash(p,"preparationHash");
        for(var k:List.of("recordHash","payloadSha256","referenceBindingHash","referenceSetHash","referencePreparationHash","generationHash","policyHash","runtimeHash","snapshotHash","selectionHash","worldContextHash"))digest(p,k);
        uuid(text(p,"contextId"));uuid(text(p,"jobId"));
        if(!text(p,"jobId").equals(text(g,"key"))||!ContextReceipt.jsonHash(g).equals(text(p,"generationHash"))||!text(p,"tier").equals(text(g,"qualityTier"))
            ||number(p,"maximumCalls")!=maximum(text(g,"qualityTier"))||number(p,"providerRetries")>number(p,"maximumCalls")||number(p,"callsReserved")!=0
            ||!text(p,"state").equals("prepared-not-sent")||!text(p,"stages").equals(STAGES)||!text(p,"budget").equals(BUDGET)||!text(p,"privacy").equals(PRIVACY)
            ||!text(p,"sourceAuthority").equals("client-submitted-block-facts-not-a-server-signature"))throw new IllegalStateException("原完整请求/预算/披露不一致");
        no(p,"v1ConsentTransferable","modelSent","serverBaselineVerified","canAuthorizePlacement");number(p,"recordExpiresAt");
        var selected=p.getAsJsonObject("selected");keys(selected,"agent","model","effort","capability");
        for(var k:List.of("agent","model","effort"))same(selected.get(k),g.get(k));capability(selected.getAsJsonObject("capability"),g);
        return p;
    }
    static void images(JsonObject p,JsonObject manifest){
        var i=new JsonObject();i.add("referenceOwnerId",p.get("jobId"));i.add("referenceSetHash",p.get("referenceSetHash"));
        // This is a pure pixel/annotation validator, not a legacy confirmation.
        ReferenceWorldPatchTaskReceipt.verifyManifest(i,manifest);
        var annotations=new JsonArray();for(var item:manifest.getAsJsonArray("references")){var v=item.getAsJsonObject();var a=new JsonObject();for(var k:List.of("id","width","height","annotation","sha256"))a.add(k,v.get(k).deepCopy());annotations.add(a);}
        same(p.get("imageAnnotations"),annotations);if(number(p,"imageCount")!=annotations.size())throw new IllegalStateException("原图片数量改变");
    }
    static JsonObject verifyPreparation(SelectionReadService.Capture capture,JsonObject saved,JsonObject g,JsonObject manifest,JsonObject advertised,JsonObject p){
        preparation(p,g);images(p,manifest);capability(advertised,g);same(p.getAsJsonObject("selected").get("capability"),advertised);
        ContextReceipt.verify(capture,capture.payload().getBytes(StandardCharsets.UTF_8),saved);
        var record=saved.getAsJsonObject("record");
        if(capture.canAuthorizePlacement()||!capture.id().equals(text(p,"contextId"))||number(p,"recordExpiresAt")<=System.currentTimeMillis())throw new IllegalStateException("原只读快照已改变/过期，未发送");
        for(var k:List.of("recordHash","payloadSha256","snapshotHash","selectionHash"))same(p.get(k),record.get(k));same(p.get("recordExpiresAt"),record.get("expiresAt"));
        same(p.get("origin"),capture.selection().edit().json().get("min"));var bounds=new JsonObject();
        var edit=capture.selection().edit().json();for(int n=0;n<3;n++)bounds.addProperty(List.of("width","height","length").get(n),edit.getAsJsonArray("max").get(n).getAsInt()-edit.getAsJsonArray("min").get(n).getAsInt());
        same(p.get("maximumBounds"),bounds);return p;
    }
    static JsonObject reference(SelectionReadService.Capture capture,JsonObject saved,JsonObject g,JsonObject m,JsonObject c,JsonObject p){
        verifyPreparation(capture,saved,g,m,c,p);
        var send=new JsonObject();send.addProperty("format","ReferenceWorldAssemblySend");send.addProperty("version",2);send.addProperty("purpose",PURPOSE);send.addProperty("confirmed",true);
        send.add("preparationHash",p.get("preparationHash"));send.add("maximumCalls",p.get("maximumCalls"));
        var request=new JsonObject();request.addProperty("format","ReferenceWorldAssemblyJobRequest");request.addProperty("version",2);request.addProperty("purpose",PURPOSE);
        request.add("contextId",p.get("contextId"));request.add("referenceOwnerId",p.get("jobId"));request.add("referenceSetHash",p.get("referenceSetHash"));request.add("generation",g.deepCopy());request.add("send",send);
        var r=new JsonObject();r.addProperty("format","OriginalReferenceWorldAssemblyReference");r.addProperty("version",2);r.addProperty("purpose",PURPOSE);
        r.add("id",p.get("jobId"));r.add("preparationHash",p.get("preparationHash"));r.addProperty("requestHash",ContextReceipt.jsonHash(request));r.add("prepared",p.deepCopy());r.add("request",request);
        r.add("selection",capture.selection().json());r.addProperty("contextRevision",capture.contextRevision());r.addProperty("canAuthorizePlacement",false);return verifyReference(r);
    }
    static JsonObject verifyReference(JsonObject r){
        keys(r,"format","version","purpose","id","preparationHash","requestHash","prepared","request","selection","contextRevision","canAuthorizePlacement");kind(r,"OriginalReferenceWorldAssemblyReference");no(r,"canAuthorizePlacement");uuid(text(r,"id"));digest(r,"preparationHash");digest(r,"requestHash");number(r,"contextRevision");
        var request=r.getAsJsonObject("request");keys(request,"format","version","purpose","contextId","referenceOwnerId","referenceSetHash","generation","send");kind(request,"ReferenceWorldAssemblyJobRequest");
        var g=request.getAsJsonObject("generation");var p=preparation(r.getAsJsonObject("prepared"),g);same(r.get("id"),p.get("jobId"));same(r.get("preparationHash"),p.get("preparationHash"));
        same(request.get("referenceOwnerId"),r.get("id"));for(var k:List.of("contextId","referenceSetHash"))same(request.get(k),p.get(k));
        var send=request.getAsJsonObject("send");keys(send,"format","version","purpose","confirmed","preparationHash","maximumCalls");kind(send,"ReferenceWorldAssemblySend");if(!flag(send,"confirmed"))throw new IllegalStateException("缺少独立完整 SEND");
        for(var k:List.of("preparationHash","maximumCalls"))same(send.get(k),p.get(k));
        if(!ContextReceipt.jsonHash(request).equals(text(r,"requestHash"))||ContextReceipt.canonicalJson(request).getBytes(StandardCharsets.UTF_8).length>REQUEST_BYTES)throw new IllegalStateException("原完整 SEND 字节/hash 改变或超额");
        var selection=WorldPatchJobReceipt.selection(r.getAsJsonObject("selection"));if(!ContextReceipt.jsonHash(selection.json()).equals(text(p,"selectionHash")))throw new IllegalStateException("原完整选区改变");
        same(p.get("origin"),selection.edit().json().get("min"));var bounds=new JsonObject();var edit=selection.edit().json();for(int n=0;n<3;n++)bounds.addProperty(List.of("width","height","length").get(n),edit.getAsJsonArray("max").get(n).getAsInt()-edit.getAsJsonArray("min").get(n).getAsInt());same(p.get("maximumBounds"),bounds);
        return r;
    }
    static SelectionReadService.PatchSendBinding retentionBinding(SelectionReadService.Capture capture,JsonObject r){
        verifyReference(r);var p=r.getAsJsonObject("prepared");
        if(capture.canAuthorizePlacement()||!capture.id().equals(text(p,"contextId"))||!capture.selection().json().equals(r.get("selection"))||capture.contextRevision()!=number(r,"contextRevision"))throw new IllegalStateException("原完整 SEND 保留不能重新绑定世界");
        // Reuse read-only server retention, never the one-call consent protocol.
        return new SelectionReadService.PatchSendBinding(capture.id(),text(p,"snapshotHash"),text(p,"selectionHash"),capture.contextRevision(),text(p,"preparationHash"),text(p,"recordHash"),text(r,"requestHash"),text(p,"runtimeHash"),WorldPatchTaskReceipt.protocolHash());
    }
    static JsonObject status(JsonObject r,JsonObject s){
        verifyReference(r);var p=r.getAsJsonObject("prepared");
        for(var k:List.of("id","requestHash","preparationHash"))same(s.get(k),r.get(k));for(var k:List.of("tier","maximumCalls"))same(s.get(k),p.get(k));
        NativeEvidenceTarget.assembly(text(r,"id"),text(r,"requestHash"),s);
        if(text(s,"format").equals("ReferenceWorldAssemblyRetainedJob")){
            keys(s,"format","version","purpose","id","requestHash","preparationHash","runtimeHash","recipient","tier","maximumCalls","originalDispatchRetained","reservationInspectionOnly","automaticRetries","allowsNewModelCall","serverBaselineVerified","canAuthorizePlacement","worldWrites","state","reservedCalls","pendingCalls","responseCalls","failedCalls","candidate","originalHistoryOnly","originalLiveExecutionOnly","canResume","providerReceiptsIndependentlyAudited");
            same(s.get("runtimeHash"),p.get("runtimeHash"));var recipient=new JsonObject();for(var k:List.of("agent","model","effort"))recipient.add(k,p.getAsJsonObject("selected").get(k));same(s.get("recipient"),recipient);flag(s,"originalDispatchRetained");
            if(!Set.of("send-consumed-not-dispatched","dispatch-consumed-needs-original-inspection","unknown-needs-original-inspection","failed-needs-original-inspection","responses-retained-needs-original-inspection","preview-ready").contains(text(s,"state"))
                ||number(s,"reservedCalls")>number(p,"maximumCalls")||number(s,"pendingCalls")>1||number(s,"reservedCalls")!=number(s,"pendingCalls")+number(s,"responseCalls")+number(s,"failedCalls"))throw new IllegalStateException("原完整历史账本/状态不一致");
        }
        var candidate=s.get("candidate");if(text(s,"state").equals("preview-ready")){
            var c=candidate.getAsJsonObject();keys(c,"candidateHash","patchSetHash","partCount","operationCount","canAuthorizePlacement","partIsApplyScope");digest(c,"candidateHash");digest(c,"patchSetHash");no(c,"canAuthorizePlacement","partIsApplyScope");
            if(number(c,"partCount")<1||number(c,"partCount")>32||number(c,"operationCount")<1||number(c,"operationCount")>8192*number(c,"partCount"))throw new IllegalStateException("原整组候选超额/不完整");
        }else if(!candidate.isJsonNull())throw new IllegalStateException("未完成原完整任务不能授予候选");return s;
    }
    static JsonObject capabilities(JsonObject c){
        keys(c,"format","version","purpose","preparationImplemented","preparationEnabled","runtimeHash","sendingImplemented","sendingEnabled","nativeRendererReady","nativeTransportImplemented","historyImplemented","automaticRetries","maximumCallsByTier","sharedFullPipeline","independentJointConfirmationRequired","legacyConsentTransferable","playerUiImplemented","placementImplemented","serverBaselineVerified","canAuthorizePlacement");kind(c,"ReferenceWorldAssemblyCapabilities");
        no(c,"legacyConsentTransferable","serverBaselineVerified","canAuthorizePlacement");
        for(var k:List.of("preparationImplemented","sendingImplemented","nativeTransportImplemented","historyImplemented","sharedFullPipeline","independentJointConfirmationRequired"))if(!flag(c,k))throw new IllegalStateException("配套缺少完整联合协议");
        for(var k:List.of("preparationEnabled","sendingEnabled","nativeRendererReady","playerUiImplemented","placementImplemented"))flag(c,k);
        var tiers=c.getAsJsonObject("maximumCallsByTier");keys(tiers,"lite","pro","max","ultra");for(var tier:tiers.keySet())if(number(tiers,tier)!=maximum(tier))throw new IllegalStateException("完整四档预算改变");
        if(number(c,"automaticRetries")!=0||flag(c,"sendingEnabled")&&!flag(c,"preparationEnabled"))throw new IllegalStateException("完整联合权限改变");
        if(c.get("runtimeHash").isJsonNull()){if(flag(c,"preparationEnabled")||flag(c,"sendingEnabled"))throw new IllegalStateException("完整协议缺少原 runtime");}else digest(c,"runtimeHash");return c;
    }
    static String observationDetails(JsonObject input,JsonObject state){
        var r=verifyReference(input);var p=r.getAsJsonObject("prepared");var g=r.getAsJsonObject("request").getAsJsonObject("generation");
        String base="原完整任务："+text(r,"id")+"\n模型 / 推理："+p.get("selected")+"\n档位："+text(p,"tier")+"；完整共享上限 "+number(p,"maximumCalls")+" 次，包含识图、候选、制作、纠错、恢复和复核。\n\n要求：\n"+text(g,"prompt")+"\n\n原图片组："+text(p,"referenceSetHash")+"\n原快照："+text(p,"snapshotHash")+"\n原 C/W/保护区："+r.get("selection");
        if(state==null)return base+"\n\n尚无已核验原回执；不证明模型未调用。仅 GET 此原任务，不能补发、换模型或借用旧确认。";
        status(r,state);String reserved=state.get("reservedCalls").isJsonNull()?"尚未发布（不等于 0）":Long.toString(number(state,"reservedCalls"));
        String details=base+"\n\n原状态："+text(state,"state")+"\n已记录预留："+reserved+" / "+number(p,"maximumCalls")+"。预留和本地回执不是独立提供方审计或成功次数。";
        if(state.has("stageEventsObserved"))details+="\n观察到阶段事件："+number(state,"stageEventsObserved")+"（不是调用或成功次数）。";
        if(state.has("pendingCalls"))details+="\n历史待核实预留："+number(state,"pendingCalls")+"；本地响应："+number(state,"responseCalls")+"；本地失败："+number(state,"failedCalls")+"。重启只读取原记录，不接管或恢复派发。";
        if(text(state,"state").equals("preview-ready"))details+="\n\n原完成候选："+state.get("candidate")+"\n全部 parts 是一个整体，不可单片建造。可加载整组原坐标差异；应用仍须独立 fresh BEFORE 与一次最终确认，保护撤销须另行确认。这套流程仍需游戏验收；本页不授予写入权限。";
        return details+"\n\n关页后仍由客户端 tick 查询和服务当前原资产的原生渲染，不截图世界、HUD 或桌面。客户端关闭会退出观察；下次启动只读取原任务。不重新识图、不重复计费、不刷新世界基线。";
    }
    private ReferenceWorldAssemblyReceipt(){}
}
