package dev.voxelstudio.client;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/** Read-only receipt integrity, NOT a factual verifier or a send/placement API.
 * The reference always names the original snapshot; never rebase it to the
 * current world. Unknown outcomes are queried, not regenerated here. */
final class ContextAnalysisReceipt {
    private static final Set<String> STATES=Set.of("not-dispatched","running","unknown","completed","completed-rejected","failed");
    private static final String[] SECTIONS={"observations","inferences","unknowns","recommendations"};
    private static void keys(JsonObject o,String... fields){if(o==null||!o.keySet().equals(Set.of(fields)))throw new IllegalStateException("Unexpected read-only analysis receipt fields");}
    private static String text(JsonObject o,String field){var v=o.get(field);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString())throw new IllegalStateException("Invalid analysis string: "+field);return v.getAsString();}
    private static long integer(JsonObject o,String field){var v=o.get(field);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber()||!v.getAsString().matches("[0-9]+"))throw new IllegalStateException("Invalid analysis integer: "+field);return v.getAsLong();}
    private static boolean bool(JsonObject o,String field){var v=o.get(field);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isBoolean())throw new IllegalStateException("Invalid analysis boolean: "+field);return v.getAsBoolean();}
    private static void no(JsonObject o,String field){if(bool(o,field))throw new IllegalStateException("Analysis receipt claims verified facts or world authority");}
    private static void same(JsonElement actual,JsonElement expected){if(actual==null||!actual.equals(expected))throw new IllegalStateException("Original analysis identity changed");}
    private static void digest(JsonObject o,String field){if(!text(o,field).matches("[a-f0-9]{64}"))throw new IllegalStateException("Invalid analysis hash");}
    private static boolean blank(String value){return value.codePoints().allMatch(ch->ch>=9&&ch<=13||ch==32||ch==0xa0||ch==0x1680||ch>=0x2000&&ch<=0x200a||ch==0x2028||ch==0x2029||ch==0x202f||ch==0x205f||ch==0x3000||ch==0xfeff);}

    /** Called only with an already independently verified disclosure. Merely
     * constructing this immutable reference does NOT submit any model call. */
    static JsonObject reference(JsonObject prepared){
        var request=prepared.getAsJsonObject("request");
        if(integer(prepared,"version")!=2||integer(request,"version")!=2||!ContextReceipt.jsonHash(request).equals(text(prepared,"requestHash"))
            ||!ContextReceipt.jsonHash(request.get("protocol")).equals(text(request,"protocolHash"))||!text(request,"protocolHash").equals(ContextTaskReceipt.analysisProtocolHash()))throw new IllegalStateException("A verified v2 analysis request is required");
        no(prepared,"modelSent");no(prepared,"canAuthorizePlacement");
        var result=new JsonObject();result.addProperty("format","WorldContextAnalysisReference");result.addProperty("version",1);result.addProperty("requestVersion",2);
        result.add("requestHash",prepared.get("requestHash"));for(var field:new String[]{"contextId","snapshotHash","summaryHash","protocolHash","identity"})result.add(field,request.get(field).deepCopy());
        var recipient=new JsonObject();for(var field:new String[]{"agent","model","effort"})recipient.add(field,request.getAsJsonObject("intent").get(field).deepCopy());
        result.add("recipient",recipient);result.addProperty("canAuthorizePlacement",false);return verifyReference(result);
    }
    static JsonObject verifyReference(JsonObject value){
        keys(value,"format","version","requestVersion","requestHash","contextId","snapshotHash","summaryHash","protocolHash","identity","recipient","canAuthorizePlacement");
        if(!text(value,"format").equals("WorldContextAnalysisReference")||integer(value,"version")!=1||integer(value,"requestVersion")!=2
            ||!text(value,"contextId").matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))throw new IllegalStateException("Invalid original analysis reference");
        for(var field:new String[]{"requestHash","snapshotHash","summaryHash","protocolHash"})digest(value,field);
        if(!text(value,"protocolHash").equals(ContextTaskReceipt.analysisProtocolHash()))throw new IllegalStateException("Unsupported original analysis protocol");no(value,"canAuthorizePlacement");
        var recipient=value.getAsJsonObject("recipient");keys(recipient,"agent","model","effort");ContextTaskReceipt.analysisIntent(text(recipient,"agent"),text(recipient,"model"),text(recipient,"effort"),"只读回执核验");
        var identity=value.getAsJsonObject("identity");keys(identity,"worldId","dimension","selectionRevision","contextRevision");
        if(text(identity,"worldId").isEmpty()||text(identity,"worldId").length()>128||!text(identity,"dimension").matches("[a-z0-9_.-]+:[a-z0-9/._-]+"))throw new IllegalStateException("Invalid original snapshot identity");
        integer(identity,"selectionRevision");integer(identity,"contextRevision");return value;
    }
    static JsonObject verify(JsonObject reference,JsonObject value){
        verifyReference(reference);
        if(ContextReceipt.canonicalJson(value).getBytes(StandardCharsets.UTF_8).length>256*1024)throw new IllegalStateException("Analysis status byte quota exceeded");
        keys(value,"format","version","id","contextId","requestVersion","protocolHash","requestHash","snapshotHash","summaryHash","recipient","state","callsReserved","maximumCalls","automaticRetries",
            "canObserveOriginal","modelSent","analysis","rejection","analysisClaimsVerified","localStop","canAuthorizePlacement");
        if(!text(value,"format").equals("WorldContextAnalysisStatus")||integer(value,"version")!=1||integer(value,"maximumCalls")!=1||integer(value,"automaticRetries")!=0)throw new IllegalStateException("Analysis receipt changed its protocol/budget");
        for(var field:new String[]{"contextId","requestVersion","protocolHash","requestHash","snapshotHash","summaryHash","recipient"})same(value.get(field),reference.get(field));same(value.get("id"),reference.get("requestHash"));
        no(value,"analysisClaimsVerified");no(value,"canAuthorizePlacement");String state=text(value,"state");long calls=integer(value,"callsReserved");
        if(!STATES.contains(state)||calls!=(state.equals("not-dispatched")?0:1))throw new IllegalStateException("Invalid analysis reservation/state");
        if(calls==0)no(value,"modelSent");else if(!text(value,"modelSent").equals("possibly-or-confirmed"))throw new IllegalStateException("Unknown analysis must not claim zero model use");
        if(bool(value,"canObserveOriginal")&&!state.equals("unknown"))throw new IllegalStateException("Only an unknown original turn can be observed");
        if(state.equals("completed"))verifyAnalysis(reference,value.getAsJsonObject("analysis"));else if(!value.get("analysis").isJsonNull())throw new IllegalStateException("Incomplete/rejected analysis cannot publish prose");
        var rejection=value.get("rejection");if(!rejection.isJsonNull()&&(!state.equals("completed-rejected")||!text(value,"rejection").equals("analysis-contract-rejected")))throw new IllegalStateException("Invalid analysis rejection");
        var stop=value.get("localStop");if(!stop.isJsonNull()){var detail=stop.getAsJsonObject();keys(detail,"category","code","type");
            if(!Set.of("provider-outcome","local-journal-or-invariant").contains(text(detail,"category"))||!Set.of("EPERM","EACCES","EBUSY","ENOENT","ENOSPC","EIO","unspecified").contains(text(detail,"code"))
                ||!Set.of("Error","TypeError","ReferenceError","SyntaxError").contains(text(detail,"type")))throw new IllegalStateException("Unbounded analysis diagnostic rejected");}
        return value;
    }
    private static void verifyAnalysis(JsonObject reference,JsonObject value){
        keys(value,"format","version","requestHash","snapshotHash","summaryHash","observations","inferences","unknowns","recommendations");
        if(!text(value,"format").equals("WorldContextAnalysis")||integer(value,"version")!=1||ContextReceipt.canonicalJson(value).getBytes(StandardCharsets.UTF_8).length>128*1024)throw new IllegalStateException("Invalid bounded analysis prose");
        for(var field:new String[]{"requestHash","snapshotHash","summaryHash"})same(value.get(field),reference.get(field));
        for(var section:SECTIONS){var list=value.getAsJsonArray(section);if(list==null||list.size()>32)throw new IllegalStateException("Analysis section quota exceeded");for(var item:list){
            if(!item.isJsonPrimitive()||!item.getAsJsonPrimitive().isString())throw new IllegalStateException("Analysis is untrusted prose, not an operation");String content=item.getAsString();
            if(blank(content)||content.length()>2000||content.indexOf('\0')>=0)throw new IllegalStateException("Invalid bounded analysis text");}}
    }
    static String details(JsonObject reference,JsonObject status){
        verify(reference,status);var recipient=reference.getAsJsonObject("recipient");var out=new StringBuilder("原任务的只读分析回执\n\n")
            .append("模型：").append(recipient.get("agent").getAsString()).append(" · ").append(recipient.get("model").getAsString()).append(" · ").append(recipient.get("effort").getAsString())
            .append("\n状态：").append(status.get("state").getAsString()).append("\n调用预留：").append(status.get("callsReserved")).append("/1；自动重发 0 次")
            .append("\n\n结果只针对原快照，不证明当前环境仍相同。所有 AI 结论未经事实验证；不产生补丁、建造或世界权限。\n未知结果只能查询原任务；不可自动替换或重发。\n\n任务 hash：").append(reference.get("requestHash").getAsString())
            .append("\n快照 hash：").append(reference.get("snapshotHash").getAsString());
        if(!status.get("analysis").isJsonNull()){var analysis=status.getAsJsonObject("analysis");String[] labels={"模型声称的观察（未验证）","模型推断（未验证）","未知与证据缺口","仅供考虑的建议（不执行）"};
            for(int i=0;i<SECTIONS.length;i++){out.append("\n\n").append(labels[i]).append("：\n");for(var item:analysis.getAsJsonArray(SECTIONS[i]))out.append(item.getAsString()).append("\n");}}
        return out.toString();
    }
    private ContextAnalysisReceipt(){}
}
