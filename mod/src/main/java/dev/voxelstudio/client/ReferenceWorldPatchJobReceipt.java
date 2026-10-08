package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Independent joint job references. Original capture, verified preparation,
 * freeze and live capabilities select the pins; status/downloads cannot select
 * their own pictures, runtime or world baseline. No submit or world-write API. */
final class ReferenceWorldPatchJobReceipt {
    static final int MAX_STATUS_BYTES=16384;
    private static final List<String> SEND_PINS=List.of("capsuleId","manifestHash","taskDisclosureHash","taskHash","requestHash","disclosureHash","promptSha256","reviewHash","confirmationHash","snapshotHash","selectionHash","referenceSetHash","runtimeHash","imageCapabilityHash");
    static JsonObject reference(SelectionReadService.Capture capture,JsonObject prepared,JsonObject frozen,String runtimeHash){
        ReferenceWorldPatchTaskReceipt.verifyFrozen(prepared,ReferenceWorldPatchTaskReceipt.confirmation(prepared),frozen);
        if(capture.canAuthorizePlacement()||!capture.id().equals(text(frozen,"contextId"))
            ||!ContextReceipt.jsonHash(capture.selection().json()).equals(text(frozen,"selectionHash"))
            ||capture.contextRevision()!=number(prepared.getAsJsonObject("identity"),"contextRevision")
            ||!text(frozen,"runtimeHash").equals(runtimeHash))throw new IllegalStateException("联合原引用不能更换快照或 runtime");
        var send=new JsonObject();send.addProperty("format","FrozenReferenceWorldPatchExplicitSend");send.addProperty("version",1);
        send.addProperty("purpose",ReferenceWorldPatchTaskReceipt.PURPOSE);send.addProperty("confirmed",true);send.addProperty("maximumCalls",1);
        for(var k:SEND_PINS)send.add(k,frozen.get(k).deepCopy());
        var r=new JsonObject();r.addProperty("format","FrozenReferenceWorldPatchJobReference");r.addProperty("version",1);
        for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash","recipient","runtimeHash","referenceSetHash","imageCapabilityHash"))r.add(k,frozen.get(k).deepCopy());
        r.addProperty("submissionHash",ContextReceipt.jsonHash(send));r.addProperty("protocolHash",ReferenceWorldPatchTaskReceipt.protocolHash());
        r.addProperty("patchProtocolHash",WorldPatchTaskReceipt.protocolHash());r.add("selection",capture.selection().json());
        r.addProperty("contextRevision",capture.contextRevision());r.add("send",send);r.addProperty("canAuthorizePlacement",false);return verifyReference(r);
    }
    static JsonObject verifyReference(JsonObject r){
        keys(r,"format","version","capsuleId","manifestHash","snapshotHash","selectionHash","recipient","submissionHash","runtimeHash","referenceSetHash","imageCapabilityHash","protocolHash","patchProtocolHash","selection","contextRevision","send","canAuthorizePlacement");
        if(!text(r,"format").equals("FrozenReferenceWorldPatchJobReference")||number(r,"version")!=1
            ||!text(r,"protocolHash").equals(ReferenceWorldPatchTaskReceipt.protocolHash())||!text(r,"patchProtocolHash").equals(WorldPatchTaskReceipt.protocolHash()))throw new IllegalStateException("联合原引用版本/规则改变");
        no(r,"canAuthorizePlacement");for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash","submissionHash","runtimeHash","referenceSetHash","imageCapabilityHash","protocolHash","patchProtocolHash"))digest(r,k);
        number(r,"contextRevision");var selection=WorldPatchJobReceipt.selection(r.getAsJsonObject("selection"));
        if(!ContextReceipt.jsonHash(selection.json()).equals(text(r,"selectionHash")))throw new IllegalStateException("联合选区 hash 改变");
        var recipient=r.getAsJsonObject("recipient");keys(recipient,"agent","model","effort");
        if(!text(recipient,"agent").equals("codex"))throw new IllegalStateException("联合原调用不是支持的识图 Agent");
        intent("codex",text(recipient,"model"),text(recipient,"effort"),"核验联合原引用");
        var send=r.getAsJsonObject("send");var fields=new HashSet<>(SEND_PINS);fields.addAll(Set.of("format","version","purpose","confirmed","maximumCalls"));
        if(!send.keySet().equals(fields)||!text(send,"format").equals("FrozenReferenceWorldPatchExplicitSend")||number(send,"version")!=1
            ||!text(send,"purpose").equals(ReferenceWorldPatchTaskReceipt.PURPOSE)||!flag(send,"confirmed")||number(send,"maximumCalls")!=1)throw new IllegalStateException("不是独立联合 SEND");
        for(var k:SEND_PINS)digest(send,k);
        for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash","referenceSetHash","runtimeHash","imageCapabilityHash"))same(r.get(k),send.get(k));
        if(!ContextReceipt.jsonHash(send).equals(text(r,"submissionHash")))throw new IllegalStateException("联合原 SEND 被替换");return r;
    }
    static SelectionReadService.PatchSendBinding retentionBinding(SelectionReadService.Capture capture,JsonObject r){
        verifyReference(r);
        if(capture.canAuthorizePlacement()||!capture.selection().equals(WorldPatchJobReceipt.selection(r.getAsJsonObject("selection")))
            ||capture.contextRevision()!=number(r,"contextRevision"))throw new IllegalStateException("联合原发送保留选区改变");
        return new SelectionReadService.PatchSendBinding(capture.id(),text(r,"snapshotHash"),text(r,"selectionHash"),number(r,"contextRevision"),
            text(r,"capsuleId"),text(r,"manifestHash"),text(r,"submissionHash"),text(r,"runtimeHash"),text(r,"protocolHash"));
    }
    static JsonObject parseStatus(byte[] bytes,JsonObject reference,BooleanSupplier cancelled){
        Objects.requireNonNull(bytes);Objects.requireNonNull(cancelled);allowed(cancelled);
        if(bytes.length==0||bytes.length>MAX_STATUS_BYTES)throw new IllegalStateException("联合原状态超额，不截断");
        final String json;try{json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException error){throw new IllegalStateException("联合原状态不是完整 UTF-8",error);}
        var status=verify(reference,WorldPatchCandidateReceipt.strictJson(json,cancelled).getAsJsonObject());allowed(cancelled);return status.deepCopy();
    }
    static JsonObject verify(JsonObject r,JsonObject v){
        verifyReference(r);keys(v,"format","version","id","capsuleId","manifestHash","runtimeHash","submissionHash","state","recipient","callsReserved","maximumCalls","automaticRetries","modelSent","canObserveOriginal","responseCheck","localStop","candidatePublished","candidateHash","candidateCurrentFilesReverified","serverBaselineVerified","canAuthorizePlacement","worldWrites");
        if(!text(v,"format").equals("FrozenReferenceWorldPatchJobStatus")||number(v,"version")!=1||number(v,"maximumCalls")!=1
            ||number(v,"automaticRetries")!=0||number(v,"worldWrites")!=0)throw new IllegalStateException("联合状态协议/预算改变");
        for(var k:List.of("capsuleId","manifestHash","runtimeHash","submissionHash","recipient"))same(v.get(k),r.get(k));same(v.get("id"),r.get("capsuleId"));
        no(v,"candidateCurrentFilesReverified","serverBaselineVerified","canAuthorizePlacement");
        String state=text(v,"state");if(!Set.of("reserved-not-dispatched","running","checking","response-retained","unknown","failed","completed-checked","completed-rejected").contains(state))throw new IllegalStateException("联合状态未知");
        long calls=number(v,"callsReserved");if(calls>1||calls==0&&!Set.of("reserved-not-dispatched","running").contains(state)||calls==1&&state.equals("reserved-not-dispatched"))throw new IllegalStateException("联合预留调用数与状态矛盾");
        if(calls==0)no(v,"modelSent");else if(!text(v,"modelSent").equals("possibly-or-confirmed"))throw new IllegalStateException("联合未知费用不能称零调用");
        if(flag(v,"canObserveOriginal")&&!state.equals("unknown"))throw new IllegalStateException("只能观察未知联合原 turn");
        var stop=v.get("localStop");if(!stop.isJsonNull()){
            var local=stop.getAsJsonObject();keys(local,"phase","reason","isProviderTerminalReceipt");no(local,"isProviderTerminalReceipt");
            if(!Set.of("live-capability-preflight","original-source-preflight","provider-dispatch","response-compile").contains(text(local,"phase"))
                ||!text(local,"reason").equals("original-outcome-retained-no-resubmission"))throw new IllegalStateException("联合本地停止不是提供方终态");
        }
        var check=v.get("responseCheck");if(state.equals("completed-checked")){
            var c=check.getAsJsonObject();keys(c,"format","version","capsuleId","manifestHash","responseHash","snapshotHash","selectionHash","patchHash","candidateHash","previewHash","candidateSaved","sourceArchiveReverified","serverBaselineVerified","canAuthorizePlacement","additionalModelCalls","worldWrites");
            if(!text(c,"format").equals("FrozenReferenceWorldPatchResponseCheck")||number(c,"version")!=1||!flag(c,"candidateSaved")
                ||!flag(c,"sourceArchiveReverified")||number(c,"additionalModelCalls")!=0||number(c,"worldWrites")!=0)throw new IllegalStateException("不是联合原候选回执");
            no(c,"serverBaselineVerified","canAuthorizePlacement");for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash"))same(c.get(k),r.get(k));
            for(var k:List.of("responseHash","patchHash","candidateHash","previewHash"))digest(c,k);
            if(!flag(v,"candidatePublished"))throw new IllegalStateException("联合原候选未发布");same(v.get("candidateHash"),c.get("candidateHash"));
        }else if(!check.isJsonNull()||!v.get("candidateHash").isJsonNull()||flag(v,"candidatePublished"))throw new IllegalStateException("未完成联合任务不能显示候选");
        return v;
    }
    static ReferenceWorldPatchCandidateReceipt.Reference candidate(JsonObject r,JsonObject status){
        verify(r,status);if(!text(status,"state").equals("completed-checked"))throw new IllegalStateException("联合原任务没有工程核验候选");
        var c=status.getAsJsonObject("responseCheck");var binding=new WorldPatchPreview.Binding(WorldPatchJobReceipt.selection(r.getAsJsonObject("selection")),number(r,"contextRevision"),text(r,"snapshotHash"),text(r,"selectionHash"),text(c,"patchHash"),text(c,"previewHash"));
        return new ReferenceWorldPatchCandidateReceipt.Reference(text(r,"capsuleId"),text(r,"manifestHash"),text(r,"submissionHash"),text(r,"runtimeHash"),text(c,"responseHash"),text(c,"candidateHash"),text(r,"referenceSetHash"),text(r,"imageCapabilityHash"),binding);
    }
    static String capabilitiesRuntime(JsonObject v){
        keys(v,"format","version","purpose","preparationImplemented","preparationEnabled","sendingImplemented","sendingEnabled","runtimeHash","maximumCalls","automaticRetries","agents","jointConfirmationRequired","legacyConsentTransferable","previewDownloadVersion","playerUiImplemented","placementImplemented","serverBaselineVerified","canAuthorizePlacement");
        if(!text(v,"format").equals("ReferenceWorldPatchCapabilities")||number(v,"version")!=1||!text(v,"purpose").equals(ReferenceWorldPatchTaskReceipt.PURPOSE)
            ||number(v,"maximumCalls")!=1||number(v,"automaticRetries")!=0||number(v,"previewDownloadVersion")!=1
            ||!flag(v,"preparationImplemented")||!flag(v,"sendingImplemented")||!flag(v,"jointConfirmationRequired"))throw new IllegalStateException("联合能力协议不支持");
        no(v,"legacyConsentTransferable","playerUiImplemented","placementImplemented","serverBaselineVerified","canAuthorizePlacement");
        same(v.get("agents"),JsonParser.parseString("[\"codex\"]"));boolean prepared=flag(v,"preparationEnabled"),enabled=flag(v,"sendingEnabled");
        if(enabled&&!prepared)throw new IllegalStateException("联合准备不可用，不能发送");
        if(v.get("runtimeHash").isJsonNull()){if(enabled)throw new IllegalStateException("联合缺少独立 runtime");return null;}
        digest(v,"runtimeHash");return enabled?text(v,"runtimeHash"):null;
    }
    static boolean polling(JsonObject status){return Set.of("running","checking").contains(text(status,"state"));}
    static String details(JsonObject reference,JsonObject status){
        verify(reference,status);String state=text(status,"state");
        String meaning=switch(state){
            case "reserved-not-dispatched"->"原引用已保留，尚未取得派发证据；不能据此重新提交";
            case "running"->"原联合任务运行中；本页自动 GET，不调用新模型";
            case "checking"->"原回答正在工程校验；未取得世界写入权限";
            case "unknown"->"原调用结果未知，费用不能称零；仅可独立确认观察原回合";
            case "response-retained"->"原响应已保留，尚无已校验候选；不重新生成或替换原回答";
            case "completed-checked"->"原候选已通过工程校验；不是设计品质、当前世界或放置验收";
            case "completed-rejected"->"原候选未通过工程校验；原回答与拒绝原因保留，不自动重试";
            default->"原任务失败或本地停止；完整原证据保留，不重发";
        };
        var out=new StringBuilder("参考图＋选区的原任务结果。当前是一调用开发合同，不是完整四档任务。\n\n")
            .append("模型：").append(reference.get("recipient")).append("\n状态：").append(state).append("\n").append(meaning)
            .append("\n调用预留：").append(number(status,"callsReserved")).append(" / 1；自动重试：0")
            .append("\n发送证据：").append(status.get("modelSent")).append("\n世界写入：0；本页没有放置授权。")
            .append("\n\n原任务：").append(text(reference,"capsuleId")).append("\n原图片组：").append(text(reference,"referenceSetHash"))
            .append("\n原图像能力：").append(text(reference,"imageCapabilityHash"))
            .append("\n原快照：").append(text(reference,"snapshotHash")).append("\n原选区：").append(reference.get("selection"));
        if(!status.get("localStop").isJsonNull())out.append("\n\n本地停止证据（不是提供方终态）：").append(status.get("localStop"));
        if(state.equals("completed-checked"))out.append("\n\n原候选：").append(text(status,"candidateHash"))
            .append("\n加载时重新校验原文件、原图片身份和同一服务器快照；不可拖移或绑定另一世界。确认应用前仍需独立 BEFORE/物理核验，实际写入需最终明确确认。未验证的通行与设计质量不标为通过。");
        return out.toString();
    }
    private static void allowed(BooleanSupplier cancelled){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("联合状态核验已取消");}
    private ReferenceWorldPatchJobReceipt(){}
}
