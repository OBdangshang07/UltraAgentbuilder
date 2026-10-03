package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import java.util.*;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** References/status only: runtime pins come from independent capabilities and
 * the original frozen task, never from an unverified preview download. */
final class WorldPatchJobReceipt {
    static SelectionReadService.PatchSendBinding retentionBinding(SelectionReadService.Capture capture,JsonObject reference){
        verifyReference(reference);
        if(!capture.selection().equals(selection(reference.getAsJsonObject("selection")))||capture.contextRevision()!=number(reference,"contextRevision"))throw new IllegalStateException("原发送保留选区身份改变");
        return new SelectionReadService.PatchSendBinding(capture.id(),text(reference,"snapshotHash"),text(reference,"selectionHash"),number(reference,"contextRevision"),text(reference,"capsuleId"),text(reference,"manifestHash"),text(reference,"submissionHash"),text(reference,"runtimeHash"),text(reference,"protocolHash"));
    }
    static JsonObject reference(SelectionReadService.Capture capture,JsonObject prepared,JsonObject frozen,String runtimeHash){
        verifyFrozen(prepared,confirmation(prepared),frozen);
        if(capture.canAuthorizePlacement()||!capture.id().equals(text(frozen,"contextId"))||!ContextReceipt.jsonHash(capture.selection().json()).equals(text(frozen,"selectionHash"))
            ||capture.contextRevision()!=number(prepared.getAsJsonObject("identity"),"contextRevision"))throw new IllegalStateException("原改造引用不能改世界或基线");
        var send=new JsonObject();send.addProperty("format","FrozenWorldPatchExplicitSend");send.addProperty("version",1);send.addProperty("purpose","world-patch-design");send.addProperty("confirmed",true);send.addProperty("maximumCalls",1);
        for(var k:List.of("capsuleId","manifestHash","taskDisclosureHash","taskHash","requestHash","disclosureHash","promptSha256","reviewHash"))send.add(k,frozen.get(k));
        var r=new JsonObject();r.addProperty("format","FrozenWorldPatchJobReference");r.addProperty("version",1);for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash","recipient"))r.add(k,frozen.get(k).deepCopy());
        r.addProperty("submissionHash",ContextReceipt.jsonHash(send));r.addProperty("runtimeHash",runtimeHash);r.addProperty("protocolHash",protocolHash());r.add("selection",capture.selection().json());r.addProperty("contextRevision",capture.contextRevision());r.add("send",send);r.addProperty("canAuthorizePlacement",false);return verifyReference(r);
    }
    static JsonObject verifyReference(JsonObject r){
        keys(r,"format","version","capsuleId","manifestHash","snapshotHash","selectionHash","recipient","submissionHash","runtimeHash","protocolHash","selection","contextRevision","send","canAuthorizePlacement");
        if(!text(r,"format").equals("FrozenWorldPatchJobReference")||number(r,"version")!=1||!text(r,"protocolHash").equals(protocolHash()))throw new IllegalStateException("原改造引用版本/规则不支持");no(r,"canAuthorizePlacement");
        for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash","submissionHash","runtimeHash","protocolHash"))digest(r,k);number(r,"contextRevision");
        var s=selection(r.getAsJsonObject("selection"));if(!ContextReceipt.jsonHash(s.json()).equals(text(r,"selectionHash")))throw new IllegalStateException("原改造引用选区 hash 不一致");
        var recipient=r.getAsJsonObject("recipient");keys(recipient,"agent","model","effort");intent(text(recipient,"agent"),text(recipient,"model"),text(recipient,"effort"),"核验原任务引用");
        var send=r.getAsJsonObject("send");keys(send,"format","version","purpose","confirmed","maximumCalls","capsuleId","manifestHash","taskDisclosureHash","taskHash","requestHash","disclosureHash","promptSha256","reviewHash");
        if(!text(send,"format").equals("FrozenWorldPatchExplicitSend")||number(send,"version")!=1||!text(send,"purpose").equals("world-patch-design")||!flag(send,"confirmed")||number(send,"maximumCalls")!=1)throw new IllegalStateException("不是独立一次改造 SEND");
        for(var k:List.of("capsuleId","manifestHash","taskDisclosureHash","taskHash","requestHash","disclosureHash","promptSha256","reviewHash"))digest(send,k);
        same(r.get("capsuleId"),send.get("capsuleId"));same(r.get("manifestHash"),send.get("manifestHash"));if(!ContextReceipt.jsonHash(send).equals(text(r,"submissionHash")))throw new IllegalStateException("原 SEND 内容不能替换");return r;
    }
    static JsonObject verify(JsonObject r,JsonObject v){
        verifyReference(r);keys(v,"format","version","id","capsuleId","manifestHash","runtimeHash","submissionHash","state","recipient","callsReserved","maximumCalls","automaticRetries","modelSent","canObserveOriginal","responseCheck","localStop","candidatePublished","candidateHash","candidateCurrentFilesReverified","serverBaselineVerified","canAuthorizePlacement","worldWrites");
        if(!text(v,"format").equals("FrozenWorldPatchJobStatus")||number(v,"version")!=2||number(v,"maximumCalls")!=1||number(v,"automaticRetries")!=0||number(v,"worldWrites")!=0)throw new IllegalStateException("改造状态协议/预算改变");
        for(var k:List.of("capsuleId","manifestHash","runtimeHash","submissionHash","recipient"))same(v.get(k),r.get(k));same(v.get("id"),r.get("capsuleId"));no(v,"candidateCurrentFilesReverified","serverBaselineVerified","canAuthorizePlacement");
        String state=text(v,"state");if(!Set.of("preparing","running","checking","response-retained","unknown","failed","completed-checked","completed-rejected").contains(state))throw new IllegalStateException("改造状态未知");
        long calls=number(v,"callsReserved");if(calls>1||calls==0&&!state.equals("preparing"))throw new IllegalStateException("改造调用预留无效");if(calls==0)no(v,"modelSent");else if(!text(v,"modelSent").equals("possibly-or-confirmed"))throw new IllegalStateException("未知调用不能称零调用");
        if(flag(v,"canObserveOriginal")&&!state.equals("unknown"))throw new IllegalStateException("只能观察未知原 turn");
        var stop=v.get("localStop");if(!stop.isJsonNull()&&(!stop.isJsonPrimitive()||!stop.getAsJsonPrimitive().isString()||!stop.getAsString().equals("original-outcome-retained-no-resubmission")))throw new IllegalStateException("改造诊断字段无效");
        var check=v.get("responseCheck");if(state.equals("completed-checked")){
            var c=check.getAsJsonObject();keys(c,"format","version","capsuleId","manifestHash","responseHash","patchHash","snapshotHash","selectionHash","candidateHash","previewHash","candidateSaved","result","sourceArchiveReverified","serverBaselineVerified","canAuthorizePlacement","additionalModelCalls","worldWrites");
            if(!text(c,"format").equals("FrozenWorldPatchResponseCheck")||number(c,"version")!=2||!text(c,"result").equals("compiled-against-archived-capture")||!flag(c,"candidateSaved")||!flag(c,"sourceArchiveReverified")||number(c,"additionalModelCalls")!=0||number(c,"worldWrites")!=0)throw new IllegalStateException("不是原候选工程回执");no(c,"serverBaselineVerified","canAuthorizePlacement");
            for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash"))same(c.get(k),r.get(k));for(var k:List.of("responseHash","patchHash","candidateHash","previewHash"))digest(c,k);
            if(!flag(v,"candidatePublished"))throw new IllegalStateException("缺少原候选历史发布回执");same(v.get("candidateHash"),c.get("candidateHash"));
        }else{if(!check.isJsonNull()||!v.get("candidateHash").isJsonNull()||flag(v,"candidatePublished"))throw new IllegalStateException("未完成或拒绝任务不能显示候选");}
        return v;
    }
    static WorldPatchCandidateReceipt.Reference candidate(JsonObject reference,JsonObject status){
        verify(reference,status);if(!text(status,"state").equals("completed-checked"))throw new IllegalStateException("原任务没有工程核验候选");var c=status.getAsJsonObject("responseCheck");
        var binding=new WorldPatchPreview.Binding(selection(reference.getAsJsonObject("selection")),number(reference,"contextRevision"),text(reference,"snapshotHash"),text(reference,"selectionHash"),text(c,"patchHash"),text(c,"previewHash"));
        return new WorldPatchCandidateReceipt.Reference(text(reference,"capsuleId"),text(reference,"manifestHash"),text(reference,"submissionHash"),text(reference,"runtimeHash"),text(c,"responseHash"),text(c,"candidateHash"),binding);
    }
    static boolean polling(JsonObject status){return Set.of("preparing","running","checking").contains(text(status,"state"));}
    static String details(JsonObject reference,JsonObject status){
        verify(reference,status);var recipient=reference.getAsJsonObject("recipient");String state=switch(text(status,"state")){
            case "preparing"->"准备原调用";case "running"->"原模型调用进行中";case "checking"->"核验完整原响应";
            case "response-retained"->"完整原响应已保留；可独立确认本地重检";case "unknown"->"原调用结果未知；不重新发送";
            case "failed"->"原任务失败；不重新发送";case "completed-rejected"->"原响应未通过工程规则；没有可加载候选";
            case "completed-checked"->"候选通过原归档快照工程校验；可显式加载差异预览";default->throw new IllegalStateException("未知原状态");};
        String details="状态："+state+"\nAgent / 模型 / 推理："+text(recipient,"agent")+" / "+text(recipient,"model")+" / "+text(recipient,"effort")+"\n已预留调用："+number(status,"callsReserved")+" / 1；自动重试 0\n模型发送："+(number(status,"callsReserved")==0?"尚未预留":"可能或已确认发送；不是零费用证明")+"\n原任务："+text(reference,"capsuleId")+"\n\n所有结果仅绑定原世界、选区、快照与原模型。不把回执、预览或内容同意当作放置权限。\n\n";
        if(text(status,"state").equals("completed-checked")){var c=status.getAsJsonObject("responseCheck");details+="原候选："+text(c,"candidateHash")+"\n原补丁："+text(c,"patchHash")+"\n\n当前文件尚未重新下载核验；当前 ServerWorld BEFORE 未验证。点击预览时将重新核验原字节及环境，不修改世界。";}
        else details+="没有建造权限或可采用的新世界基线。结果未知只允许另行确认观察原 turn；完整原响应只允许另行确认本地重检，不自动生成替代任务。";
        return details;
    }
    static String capabilitiesRuntime(JsonObject v){
        keys(v,"format","version","purpose","preparationImplemented","reviewPreparationImplemented","freezePreparationImplemented","frozenTaskAuditImplemented","preparationEnabled","sendingImplemented","placementImplemented","maximumCalls","automaticRetries","experimentalSendingImplemented","experimentalSendingEnabled","jobStatusVersion","previewDownloadVersion","runtimeHash","exactDataRequiresIndependentConfirmation","summaryConsentTransferable","sourceAuthority","serverBaselineVerified","canAuthorizePlacement");
        if(!text(v,"format").equals("WorldPatchCapabilities")||number(v,"version")!=1||!text(v,"purpose").equals("world-patch-design")||number(v,"maximumCalls")!=1||number(v,"automaticRetries")!=0||number(v,"jobStatusVersion")!=2||number(v,"previewDownloadVersion")!=1||!flag(v,"exactDataRequiresIndependentConfirmation")||!text(v,"sourceAuthority").equals("client-submitted-block-facts-not-a-server-signature"))throw new IllegalStateException("改造能力协议无效");
        no(v,"sendingImplemented","placementImplemented","summaryConsentTransferable","serverBaselineVerified","canAuthorizePlacement");
        for(var k:List.of("preparationImplemented","reviewPreparationImplemented","freezePreparationImplemented","frozenTaskAuditImplemented","experimentalSendingImplemented"))if(!flag(v,k))throw new IllegalStateException("本机改造协议未实现");
        flag(v,"preparationEnabled");boolean enabled=flag(v,"experimentalSendingEnabled");if(v.get("runtimeHash").isJsonNull()){if(enabled)throw new IllegalStateException("缺少独立 runtime 身份");return null;}digest(v,"runtimeHash");return enabled?text(v,"runtimeHash"):null;
    }
    /** Production v2 only. No fallback to a legacy experimental capability or
     * an unknown protocol; sending a model request is not world-write authority. */
    static String sendingCapabilitiesRuntime(JsonObject v){
        keys(v,"format","version","purpose","preparationImplemented","reviewPreparationImplemented","freezePreparationImplemented","frozenTaskAuditImplemented","preparationEnabled","sendingImplemented","sendingEnabled","placementImplemented","maximumCalls","automaticRetries","jobApiVersion","sendRequestVersion","jobStatusVersion","previewDownloadVersion","candidateDownloadVersion","runtimeHash","exactDataRequiresIndependentConfirmation","summaryConsentTransferable","sendAuthorization","worldWriteAuthorization","sourceAuthority","serverBaselineVerified","canAuthorizePlacement");
        if(!text(v,"format").equals("WorldPatchCapabilities")||number(v,"version")!=2||!text(v,"purpose").equals("world-patch-design")
            ||number(v,"maximumCalls")!=1||number(v,"automaticRetries")!=0||number(v,"jobApiVersion")!=2||number(v,"sendRequestVersion")!=1||number(v,"jobStatusVersion")!=2
            ||number(v,"previewDownloadVersion")!=1||number(v,"candidateDownloadVersion")!=1||!flag(v,"exactDataRequiresIndependentConfirmation")
            ||!text(v,"sendAuthorization").equals("independent-player-confirmation")||!text(v,"worldWriteAuthorization").equals("independent-in-game-confirmation")
            ||!text(v,"sourceAuthority").equals("client-submitted-block-facts-not-a-server-signature"))throw new IllegalStateException("改造生产发送协议无效；不会降级发送");
        no(v,"placementImplemented","summaryConsentTransferable","serverBaselineVerified","canAuthorizePlacement");
        for(var k:List.of("preparationImplemented","reviewPreparationImplemented","freezePreparationImplemented","frozenTaskAuditImplemented","sendingImplemented"))if(!flag(v,k))throw new IllegalStateException("本机生产改造协议未实现");
        boolean prepared=flag(v,"preparationEnabled"),enabled=flag(v,"sendingEnabled");
        if(enabled&&!prepared)throw new IllegalStateException("改造准备不可用，不能发送");
        if(v.get("runtimeHash").isJsonNull()){if(enabled)throw new IllegalStateException("缺少独立 runtime 身份");return null;}
        digest(v,"runtimeHash");return enabled?text(v,"runtimeHash"):null;
    }
    static WorldSelection selection(JsonObject s){keys(s,"format","version","world","revision","context","edit","protected");if(!text(s,"format").equals("WorldSelection")||number(s,"version")!=1)throw new IllegalStateException("选区格式无效");var w=s.getAsJsonObject("world");keys(w,"worldId","dimension","minY","maxY");var regions=new ArrayList<SelectionRegion>();for(var item:s.getAsJsonArray("protected"))regions.add(region(item.getAsJsonObject()));return new WorldSelection(new WorldSelection.WorldIdentity(text(w,"worldId"),text(w,"dimension"),integer(w.get("minY")),integer(w.get("maxY"))),number(s,"revision"),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),regions);}
    private static SelectionRegion region(JsonObject r){keys(r,"min","max");return new SelectionRegion(point(r.getAsJsonArray("min")),point(r.getAsJsonArray("max")));}
    private static SelectionRegion.Point point(JsonArray a){if(a.size()!=3)throw new IllegalStateException("选区坐标无效");return new SelectionRegion.Point(integer(a.get(0)),integer(a.get(1)),integer(a.get(2)));}
    private static int integer(JsonElement v){try{if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber())throw new IllegalStateException("选区整数无效");return v.getAsBigDecimal().intValueExact();}catch(ArithmeticException e){throw new IllegalStateException("选区整数不可截断",e);}}
    private WorldPatchJobReceipt(){}
}
