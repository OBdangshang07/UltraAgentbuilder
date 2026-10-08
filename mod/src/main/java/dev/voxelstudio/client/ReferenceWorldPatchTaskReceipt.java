package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Independent joint preparation and freeze verification, not legacy consent.
 * Expected pictures and model advertisement are retained independently by the
 * caller. This data-only parser neither sends a model nor certifies the world.
 * The common P4 baseline verifier checks the original text portion only; no
 * legacy confirmation, frozen task or SEND is synthesized from joint consent. */
final class ReferenceWorldPatchTaskReceipt {
    static final int MAX_BYTES=WorldPatchTaskReceipt.MAX_BYTES+163840;
    static final String PURPOSE="reference-world-patch-design";
    private static final List<String> REQUEST_BASE=List.of("format","version","purpose","snapshotHash","selectionHash","designInputHash","protocolHash","world","selectionRevision","contextRevision","intent","promptSha256");
    private static final List<String> DISCLOSURE_BASE=List.of("format","version","purpose","requestHash","recipient","maximumCalls","world","context","edit","protected","selectionRevision","contextRevision","designInputHash","protocolHash","transmittedData","excludedData","cells","modelPrompt","modelPromptUtf8Bytes","promptSha256","sourceAuthority","resultAuthority","summaryConsentTransferable","automaticRetry","modelSent","sendingImplemented","canAuthorizePlacement","disclosureHash");
    private static final List<String> RECORD_PINS=List.of("contextId","payloadSha256","recordHash","recordExpiresAt","snapshotHash","selectionHash","summaryHash","identity","taskDisclosureHash","taskHash","sourceAuthority");
    private static final List<String> EXTRA_PINS=List.of("referenceSetHash","runtimeHash","imageCapabilityHash");
    private static final class Protocol {
        static final JsonObject VALUE=load();
        static JsonObject load(){try(var in=ReferenceWorldPatchTaskReceipt.class.getResourceAsStream("/voxelstudio/reference-world-patch-review-protocol.json")){
            if(in==null)throw new IllegalStateException("缺少联合改造本地协议");
            var v=WorldPatchCandidateReceipt.strictJson(new String(in.readAllBytes(),StandardCharsets.UTF_8),()->false).getAsJsonObject();
            keys(v,"version","patchProtocolHash","rules","protocolHash");
            if(number(v,"version")!=1||!text(v,"patchProtocolHash").equals(WorldPatchTaskReceipt.protocolHash()))throw new IllegalStateException("联合/原改造协议不一致");
            hash(v,"protocolHash");return v;
        }catch(java.io.IOException error){throw new IllegalStateException("不能读取联合改造规则",error);}}
    }
    static String protocolHash(){return text(Protocol.VALUE,"protocolHash");}
    static JsonObject advertisedCapability(JsonObject selected,JsonObject models,String runtime){
        keys(selected,"agent","model","effort");digestValue(runtime);if(!text(selected,"agent").equals("codex"))throw new IllegalStateException("联合图片目前仅支持明确声明图片能力的 Codex 模型");
        var list=models.getAsJsonArray("models");JsonObject chosen=null;
        for(var value:list){var model=value.getAsJsonObject();if(text(model,"id").equals(text(selected,"model"))){if(chosen!=null)throw new IllegalStateException("模型能力身份重复");chosen=model;}}
        if(chosen==null||!chosen.has("supportsImages")||!flag(chosen,"supportsImages"))throw new IllegalStateException("所选模型没有声明识图；未发送或替换模型");
        var c=selected.deepCopy();c.addProperty("supportsImages",true);c.addProperty("runtimeHash",runtime);var efforts=new JsonArray();
        if(!chosen.has("efforts")||!chosen.get("efforts").isJsonArray())throw new IllegalStateException("所选模型没有声明准确推理强度");
        for(var effort:chosen.getAsJsonArray("efforts")){if(effort.isJsonObject())efforts.add(text(effort.getAsJsonObject(),"reasoningEffort"));else efforts.add(effort.deepCopy());}
        c.add("advertisedEfforts",efforts);verifyCapability(selected,c);return c;
    }
    static String details(JsonObject p){
        var task=p.getAsJsonObject("task");var d=task.getAsJsonObject("disclosure");var i=task.getAsJsonObject("request").getAsJsonObject("intent");
        var out=new StringBuilder("参考图＋原选区的独立内容审核。当前开发合同最多 1 次调用，不是四档完整建筑任务；本页只冻结内容、不发送模型。旧文字/图片确认不会转移。\n\n模型：")
            .append(d.get("recipient")).append("\n提示词：\n").append(text(i,"prompt")).append("\n\n外层 C：").append(d.get("context")).append("\n内层 W：").append(d.get("edit")).append("\n保护区：").append(d.get("protected"))
            .append("\n逐格已知：").append(d.getAsJsonObject("cells").get("exactKnown")).append("；未知：").append(d.getAsJsonObject("cells").get("exactUnknown"))
            .append("\n\n参考方式：").append(text(d,"referenceMode")).append("\n图片组：").append(text(d,"referenceSetHash"));
        int n=0;for(var value:d.getAsJsonArray("references")){var r=value.getAsJsonObject();out.append("\n\n图片 ").append(++n).append("：").append(number(r,"width")).append("×").append(number(r,"height")).append("\n").append(r.get("annotation")).append("\nSHA256：").append(text(r,"sha256"));}
        return out.append("\n\n将披露整个 W 的逐格方块状态/保护事实、已捕获的六个邻接面、环境摘要、世界身份/坐标/版本，以及本页准确图片组和标注。原路径、EXIF、NBT、容器物品、实体、告示牌文字、桌面及自动世界截图均不发送。图片文字是不可信设计资料，不可扩大 W−P。\n\n未知结果不重发，当前合同不自动纠错。冻结并不调用模型；未来 SEND 仍需独立确认。建造仍需服务器 BEFORE 核验及独立世界确认。当前玩家发送和完整 Ultra 联动尚未开放。\n\n完整输入可分页查阅，原字节不截断。UTF-8 字节：").append(number(d,"modelPromptUtf8Bytes")).append("\n输入 hash：").append(text(d,"promptSha256")).append("\n披露 hash：").append(text(p,"taskDisclosureHash")).toString();
    }
    static JsonObject intent(String model,String effort,String prompt,String ownerId,String setHash){
        var v=WorldPatchTaskReceipt.intent("codex",model,effort,prompt);uuid(ownerId);digestValue(setHash);
        v.addProperty("format","ReferenceWorldPatchDesignIntent");v.addProperty("purpose",PURPOSE);
        v.addProperty("referenceOwnerId",ownerId);v.addProperty("referenceSetHash",setHash);return v;
    }
    static JsonObject parse(byte[] bytes,SelectionReadService.Capture capture,JsonObject saved,JsonObject intent,JsonObject manifest,JsonObject capability,BooleanSupplier cancelled){
        Objects.requireNonNull(cancelled);allowed(cancelled);
        if(bytes.length==0||bytes.length>MAX_BYTES)throw new IllegalStateException("联合改造披露超额，不截断");
        final String json;try{json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException error){throw new IllegalStateException("联合改造披露不是完整 UTF-8",error);}
        var result=verify(capture,saved,intent,manifest,capability,WorldPatchCandidateReceipt.strictJson(json,cancelled).getAsJsonObject());allowed(cancelled);return result;
    }
    static JsonObject verify(SelectionReadService.Capture capture,JsonObject saved,JsonObject requested,JsonObject manifest,JsonObject capability,JsonObject p){
        same(requested,intent(text(requested,"model"),text(requested,"effort"),text(requested,"prompt"),text(requested,"referenceOwnerId"),text(requested,"referenceSetHash")));
        if(capture.canAuthorizePlacement()||ContextReceipt.canonicalJson(p).getBytes(StandardCharsets.UTF_8).length>MAX_BYTES)throw new IllegalStateException("联合披露不是有界只读来源");
        ContextReceipt.verify(capture,capture.payload().getBytes(StandardCharsets.UTF_8),saved);
        keys(p,"format","version","purpose","contextId","payloadSha256","recordHash","recordExpiresAt","snapshotHash","selectionHash","summaryHash","identity","task","taskHash","sourceAuthority","summaryConsentTransferable","referenceConsentTransferable","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement","taskDisclosureHash");
        kind(p,"SavedReferenceWorldPatchTaskDisclosure");no(p,"summaryConsentTransferable","referenceConsentTransferable","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement");hash(p,"taskDisclosureHash");
        var task=p.getAsJsonObject("task");keys(task,"format","version","request","requestHash","disclosure","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement","taskHash");
        if(!text(task,"format").equals("ReferenceWorldPatchDesignPreparedTask")||number(task,"version")!=1)throw new IllegalStateException("不是联合准备任务");
        no(task,"modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement");hash(task,"taskHash");same(task.get("taskHash"),p.get("taskHash"));
        var r=task.getAsJsonObject("request");exact(r,REQUEST_BASE,List.of("baseTaskHash","patchProtocolHash","maximumCalls","referenceOwnerId","referenceSetHash","runtimeHash","imageCapabilityHash"));
        kind(r,"ReferenceWorldPatchDesignTask");same(r.get("intent"),requested);digest(r,"baseTaskHash");
        if(number(r,"maximumCalls")!=1||!text(r,"protocolHash").equals(protocolHash())||!text(r,"patchProtocolHash").equals(WorldPatchTaskReceipt.protocolHash())||!ContextReceipt.jsonHash(r).equals(text(task,"requestHash")))throw new IllegalStateException("联合任务/规则/预算改变");
        verifyManifest(requested,manifest);verifyCapability(requested,capability);
        var d=task.getAsJsonObject("disclosure");exact(d,DISCLOSURE_BASE,List.of("patchProtocolHash","referenceOwnerId","referenceSetHash","referenceMode","references","imagePixels","imageBytes","imageCapability","imageCapabilityHash","runtimeHash","referenceConsentTransferable","providerCapabilityIndependentlyVerified"));
        kind(d,"ReferenceWorldPatchDesignDisclosure");hash(d,"disclosureHash");no(d,"referenceConsentTransferable","providerCapabilityIndependentlyVerified");
        same(d.get("requestHash"),task.get("requestHash"));
        for(var k:List.of("referenceOwnerId","referenceSetHash")){same(r.get(k),requested.get(k));same(d.get(k),requested.get(k));}
        for(var k:List.of("runtimeHash","imageCapabilityHash","protocolHash","patchProtocolHash","promptSha256"))same(d.get(k),r.get(k));
        same(d.get("imageCapability"),capability);same(r.get("runtimeHash"),capability.get("runtimeHash"));
        if(!ContextReceipt.jsonHash(capability).equals(text(r,"imageCapabilityHash")))throw new IllegalStateException("联合独立模型图像能力改变");
        same(d.get("references"),manifest.get("references"));same(d.get("referenceMode"),manifest.get("mode"));same(d.get("imagePixels"),manifest.get("pixels"));same(d.get("imageBytes"),manifest.get("bytes"));
        String full=text(d,"modelPrompt"),marker="\n\n"+text(Protocol.VALUE,"rules")+"\n\n";int boundary=full.lastIndexOf(marker);
        if(boundary<0)throw new IllegalStateException("缺少完整联合图像规则");
        var evidence=WorldPatchCandidateReceipt.strictJson(full.substring(boundary+marker.length()),()->Thread.currentThread().isInterrupted()).getAsJsonObject();
        var expected=new JsonObject();expected.addProperty("format","ReferenceWorldPatchEvidence");expected.addProperty("version",1);expected.add("referenceOwnerId",manifest.get("ownerId"));expected.add("referenceSetHash",manifest.get("setHash"));
        for(var k:List.of("mode","references","pixels","bytes"))expected.add(k,manifest.get(k));expected.addProperty("untrustedData",true);expected.addProperty("canAuthorizePlacement",false);same(evidence,expected);
        var fullBytes=full.getBytes(StandardCharsets.UTF_8);if(fullBytes.length!=number(d,"modelPromptUtf8Bytes")||!ContextReceipt.sha256(fullBytes).equals(text(r,"promptSha256")))throw new IllegalStateException("联合实际模型输入字节改变");
        var transmitted=JsonParser.parseString("[\"exact-user-task-and-rules\",\"absolute-context-edit-protection-coordinates\",\"opaque-world-id-dimension-and-revisions\",\"whole-W-exact-block-state-and-protection-facts\",\"six-already-captured-adjacent-face-slabs\",\"context-material-counts-coverage-and-height-LOD\",\"supported-target-state-catalog\",\"selected-canonical-user-reference-pixels\",\"reference-mode-view-purpose-and-scale-annotations\"]");
        var excluded=JsonParser.parseString("[\"NBT\",\"container-items\",\"sign-book-text\",\"entities\",\"save-paths\",\"diagonal-neighbor-cells\",\"automatic-world-or-desktop-screen-capture\",\"local-image-source-paths-and-metadata\",\"unselected-reference-images\"]");same(d.get("transmittedData"),transmitted);same(d.get("excludedData"),excluded);
        // Rebuild ONLY the base data transcript, exactly as the production
        // joint capsule stores a base-disclosure.json. Never create legacy
        // consent, review, capsule or SEND rights from this private local value.
        var baseIntent=WorldPatchTaskReceipt.intent("codex",text(requested,"model"),text(requested,"effort"),text(requested,"prompt"));
        var baseRequest=pick(r,REQUEST_BASE);baseRequest.addProperty("format","WorldPatchDesignTask");baseRequest.addProperty("purpose","world-patch-design");baseRequest.add("intent",baseIntent);baseRequest.add("protocolHash",r.get("patchProtocolHash"));
        String basePrompt=full.substring(0,boundary);String basePromptHash=ContextReceipt.sha256(basePrompt.getBytes(StandardCharsets.UTF_8));baseRequest.addProperty("promptSha256",basePromptHash);
        var baseDisclosure=pick(d,DISCLOSURE_BASE);baseDisclosure.addProperty("format","WorldPatchDesignDisclosure");baseDisclosure.addProperty("purpose","world-patch-design");baseDisclosure.addProperty("requestHash",ContextReceipt.jsonHash(baseRequest));baseDisclosure.add("protocolHash",r.get("patchProtocolHash"));
        baseDisclosure.addProperty("modelPrompt",basePrompt);baseDisclosure.addProperty("modelPromptUtf8Bytes",basePrompt.getBytes(StandardCharsets.UTF_8).length);baseDisclosure.addProperty("promptSha256",basePromptHash);
        var baseTransmitted=transmitted.getAsJsonArray().deepCopy();baseTransmitted.remove(baseTransmitted.size()-1);baseTransmitted.remove(baseTransmitted.size()-1);baseDisclosure.add("transmittedData",baseTransmitted);
        baseDisclosure.add("excludedData",JsonParser.parseString("[\"NBT\",\"container-items\",\"sign-book-text\",\"entities\",\"save-paths\",\"screenshots\",\"diagonal-neighbor-cells\"]"));rehash(baseDisclosure,"disclosureHash");
        var baseTask=task.deepCopy();baseTask.addProperty("format","WorldPatchDesignPreparedTask");baseTask.add("request",baseRequest);baseTask.addProperty("requestHash",ContextReceipt.jsonHash(baseRequest));baseTask.add("disclosure",baseDisclosure);rehash(baseTask,"taskHash");same(baseTask.get("taskHash"),r.get("baseTaskHash"));
        var base=p.deepCopy();base.remove("referenceConsentTransferable");base.addProperty("format","SavedWorldPatchTaskDisclosure");base.addProperty("purpose","world-patch-design");base.add("task",baseTask);base.add("taskHash",baseTask.get("taskHash"));rehash(base,"taskDisclosureHash");
        WorldPatchTaskReceipt.verify(capture,saved,baseIntent,base);return p.deepCopy();
    }
    static JsonObject confirmation(JsonObject p){
        var c=new JsonObject();c.addProperty("format","SavedReferenceWorldPatchDesignConfirmation");c.addProperty("version",1);c.addProperty("purpose",PURPOSE);c.addProperty("confirmed",true);
        for(var k:List.of("taskDisclosureHash","taskHash"))c.add(k,p.get(k));var task=p.getAsJsonObject("task");c.add("requestHash",task.get("requestHash"));c.add("disclosureHash",task.getAsJsonObject("disclosure").get("disclosureHash"));
        var r=task.getAsJsonObject("request");for(var k:List.of("promptSha256","referenceSetHash","runtimeHash","imageCapabilityHash"))c.add(k,r.get(k));return c;
    }
    static JsonObject verifyFrozen(JsonObject p,JsonObject c,JsonObject frozen){
        same(c,confirmation(p));keys(frozen,"format","version","purpose","capsuleId","contextId","frozenAt","recordExpiresAt","recordHash","payloadSha256","snapshotHash","selectionHash","summaryHash","taskDisclosureHash","taskHash","requestHash","disclosureHash","promptSha256","confirmationHash","reviewHash","referenceOwnerId","referenceSetHash","runtimeHash","imageCapabilityHash","recipient","maximumCalls","imageCount","bytes","state","sourceAuthority","summaryConsentTransferable","referenceConsentTransferable","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement","manifestHash");
        kind(frozen,"FrozenReferenceWorldPatchTaskReceipt");no(frozen,"summaryConsentTransferable","referenceConsentTransferable","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement");
        var task=p.getAsJsonObject("task");var r=task.getAsJsonObject("request");var d=task.getAsJsonObject("disclosure");
        for(var k:RECORD_PINS)if(!k.equals("identity"))same(frozen.get(k),p.get(k));
        for(var k:List.of("requestHash","disclosureHash","promptSha256"))same(frozen.get(k),c.get(k));
        for(var k:EXTRA_PINS)same(frozen.get(k),r.get(k));same(frozen.get("referenceOwnerId"),r.get("referenceOwnerId"));same(frozen.get("recipient"),d.get("recipient"));
        if(!text(frozen,"state").equals("frozen-not-sent")||number(frozen,"maximumCalls")!=1||number(frozen,"imageCount")!=d.getAsJsonArray("references").size())throw new IllegalStateException("联合冻结预算/图片/状态改变");
        for(var k:List.of("capsuleId","manifestHash","recordHash","payloadSha256","snapshotHash","selectionHash","summaryHash","taskDisclosureHash","taskHash","requestHash","disclosureHash","promptSha256","confirmationHash","reviewHash","referenceSetHash","runtimeHash","imageCapabilityHash"))digest(frozen,k);
        long at=number(frozen,"frozenAt"),bytes=number(frozen,"bytes");if(at==0||at>=number(frozen,"recordExpiresAt")||at>System.currentTimeMillis()+10000||bytes==0||bytes>512L*1024*1024)throw new IllegalStateException("联合冻结时间或体积无效");
        var review=review(p,c);if(!text(frozen,"confirmationHash").equals(ContextReceipt.jsonHash(c))||!text(frozen,"reviewHash").equals(text(review,"reviewHash")))throw new IllegalStateException("联合独立确认/审核改变");
        var id=new JsonObject();id.addProperty("version",1);id.addProperty("purpose",PURPOSE);for(var k:List.of("contextId","recordHash","taskDisclosureHash","confirmationHash","reviewHash"))id.add(k,frozen.get(k));
        if(!ContextReceipt.jsonHash(id).equals(text(frozen,"capsuleId")))throw new IllegalStateException("联合 capsule 身份改变");return frozen.deepCopy();
    }
    private static JsonObject review(JsonObject p,JsonObject c){
        var task=p.getAsJsonObject("task");var r=task.getAsJsonObject("request");var inner=new JsonObject();inner.addProperty("format","ReferenceWorldPatchDesignReviewedTask");inner.addProperty("version",1);inner.addProperty("purpose",PURPOSE);
        for(var k:List.of("taskHash","requestHash","disclosureHash","promptSha256"))inner.add(k,c.get(k));for(var k:List.of("snapshotHash","selectionHash","referenceOwnerId","referenceSetHash","runtimeHash","imageCapabilityHash"))inner.add(k,r.get(k));
        inner.add("recipient",task.getAsJsonObject("disclosure").get("recipient"));inner.addProperty("maximumCalls",1);inner.addProperty("state","reviewed-not-sent");for(var k:List.of("modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement"))inner.addProperty(k,false);rehash(inner,"reviewHash");
        var outer=pick(p,RECORD_PINS);outer.addProperty("format","SavedReferenceWorldPatchDesignReview");outer.addProperty("version",1);outer.addProperty("purpose",PURPOSE);outer.add("requestHash",c.get("requestHash"));outer.add("taskReview",inner);outer.addProperty("state","reviewed-not-sent");
        for(var k:List.of("summaryConsentTransferable","referenceConsentTransferable","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement"))outer.addProperty(k,false);rehash(outer,"reviewHash");return outer;
    }
    static void verifyManifest(JsonObject intent,JsonObject m){
        keys(m,"format","version","ownerId","mode","references","pixels","bytes","metadataRemoved","untrustedData","worldCaptured","canAuthorizePlacement","setHash");
        if(!text(m,"format").equals("UserReferenceSet")||number(m,"version")!=1||!text(m,"ownerId").equals(text(intent,"referenceOwnerId"))||!text(m,"setHash").equals(text(intent,"referenceSetHash"))||!Set.of("reconstruct","inspire","multi-view").contains(text(m,"mode"))||!flag(m,"metadataRemoved")||!flag(m,"untrustedData"))throw new IllegalStateException("联合图片不是原批准图片组");
        no(m,"worldCaptured","canAuthorizePlacement");hash(m,"setHash");var records=m.getAsJsonArray("references");if(records.size()<1||records.size()>4)throw new IllegalStateException("联合图片数量超额");long pixels=0,bytes=0;
        for(int i=0;i<records.size();i++){var v=records.get(i).getAsJsonObject();keys(v,"id","file","sha256","width","height","bytes","annotation");hash(v,"id");digest(v,"sha256");long w=number(v,"width"),h=number(v,"height"),b=number(v,"bytes");
            if(!text(v,"file").equals("image-"+i+".png")||w<1||h<1||w>2048||h>2048||b<1||b>12582912)throw new IllegalStateException("联合规范化图片顺序/尺寸无效");pixels+=w*h;bytes+=b;
            var a=v.getAsJsonObject("annotation");var fields=new HashSet<>(Set.of("purpose","view","caption"));if(a.has("scale"))fields.add("scale");if(!a.keySet().equals(fields)||!Set.of("exterior","interior","plan","style").contains(text(a,"purpose"))||!Set.of("front","side","rear","aerial","section","unknown").contains(text(a,"view"))||text(a,"caption").length()>500||text(a,"caption").matches("(?s).*[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f].*"))throw new IllegalStateException("联合图片标注无效");
            if(a.has("scale")){var scale=a.getAsJsonObject("scale");keys(scale,"dimension","meters");var n=scale.get("meters");if(!Set.of("height","width","bay").contains(text(scale,"dimension"))||!n.isJsonPrimitive()||!n.getAsJsonPrimitive().isNumber()||n.getAsBigDecimal().signum()<=0||n.getAsBigDecimal().compareTo(java.math.BigDecimal.valueOf(4096))>0)throw new IllegalStateException("联合尺度锚点无效");}
        }if(pixels>12582912||bytes>25165824||pixels!=number(m,"pixels")||bytes!=number(m,"bytes"))throw new IllegalStateException("联合图片组总量改变");
    }
    static void verifyCapability(JsonObject i,JsonObject c){
        keys(c,"agent","model","effort","supportsImages","advertisedEfforts","runtimeHash");for(var k:List.of("agent","model","effort"))same(c.get(k),i.get(k));if(!flag(c,"supportsImages"))throw new IllegalStateException("所选联合模型未声明识图");digest(c,"runtimeHash");
        var efforts=c.getAsJsonArray("advertisedEfforts");var unique=new HashSet<String>();if(efforts.size()<1||efforts.size()>16)throw new IllegalStateException("联合能力配额无效");
        for(var e:efforts){if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString()||!Set.of("default","none","minimal","low","medium","high","xhigh","max","ultra").contains(e.getAsString())||!unique.add(e.getAsString()))throw new IllegalStateException("联合能力声明无效");}
        if(!unique.contains(text(i,"effort")))throw new IllegalStateException("所选联合推理强度未声明");
    }
    private static void kind(JsonObject v,String format){if(!text(v,"format").equals(format)||number(v,"version")!=1||!text(v,"purpose").equals(PURPOSE))throw new IllegalStateException("联合回执用途/版本改变");}
    private static void exact(JsonObject v,List<String> base,List<String> extra){var fields=new HashSet<>(base);fields.addAll(extra);if(!v.keySet().equals(fields))throw new IllegalStateException("联合精确字段改变");}
    private static JsonObject pick(JsonObject v,List<String> fields){var o=new JsonObject();for(var k:fields){if(!v.has(k))throw new IllegalStateException("缺少联合来源字段");o.add(k,v.get(k).deepCopy());}return o;}
    private static void rehash(JsonObject v,String key){v.remove(key);v.addProperty(key,ContextReceipt.jsonHash(v));}
    private static void uuid(String v){if(!v.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw new IllegalStateException("联合图片来源 ID 无效");}
    private static void digestValue(String v){if(!v.matches("[a-f0-9]{64}"))throw new IllegalStateException("联合图片来源 hash 无效");}
    private static void allowed(BooleanSupplier cancelled){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("联合披露核验已取消");}
    private ReferenceWorldPatchTaskReceipt(){}
}
