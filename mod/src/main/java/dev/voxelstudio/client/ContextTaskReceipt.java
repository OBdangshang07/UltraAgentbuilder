package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/** Exact recipient/task/disclosure integrity. Never grants model or world authority. */
final class ContextTaskReceipt {
    private static void keys(JsonObject o,String... names){if(o==null||!o.keySet().equals(Set.of(names)))throw new IllegalStateException("Unexpected context task receipt fields");}
    private static String string(JsonObject o,String key){var v=o.get(key);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString())throw new IllegalStateException("Invalid task string: "+key);return v.getAsString();}
    private static long number(JsonObject o,String key){var v=o.get(key);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber()||!v.getAsString().matches("[0-9]+"))throw new IllegalStateException("Invalid task integer: "+key);return v.getAsLong();}
    private static void no(JsonObject o,String key){var v=o.get(key);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isBoolean()||v.getAsBoolean())throw new IllegalStateException("Context task claims authority: "+key);}
    private static void same(JsonElement actual,JsonElement expected){if(actual==null||!actual.equals(expected))throw new IllegalStateException("Context task identity/content changed");}
    private static void hash(JsonObject o,String field){String wanted=string(o,field);var content=o.deepCopy();content.remove(field);if(!wanted.matches("[a-f0-9]{64}")||!ContextReceipt.jsonHash(content).equals(wanted))throw new IllegalStateException("Context task hash changed: "+field);}
    private static boolean blank(String text){return text.codePoints().allMatch(ch->ch>=9&&ch<=13||ch==32||ch==0xa0||ch==0x1680||ch>=0x2000&&ch<=0x200a||ch==0x2028||ch==0x2029||ch==0x202f||ch==0x205f||ch==0x3000||ch==0xfeff);}
    static JsonObject intent(String agent,String model,String effort,String prompt){
        if(agent==null||!Set.of("codex","claude","deepseek").contains(agent)||model==null||!model.matches("[a-zA-Z0-9._:/-]{1,128}")||effort==null||!Set.of("default","low","medium","high","xhigh","max").contains(effort)
            ||prompt==null||blank(prompt)||prompt.length()>6000||prompt.indexOf('\0')>=0)throw new IllegalArgumentException("先选择确切模型/推理强度，并输入不超过 6000 字符的环境分析任务");
        var result=new JsonObject();result.addProperty("format","WorldContextTaskIntent");result.addProperty("version",1);result.addProperty("purpose","context-analysis");
        result.addProperty("agent",agent);result.addProperty("model",model);result.addProperty("effort",effort);result.addProperty("prompt",prompt);result.addProperty("maximumCalls",1);return result;
    }
    /** Separate version, not a reinterpretation of a preparation-only intent. */
    static JsonObject analysisIntent(String agent,String model,String effort,String prompt){var result=intent(agent,model,effort,prompt);result.addProperty("version",2);return result;}
    private static final class Protocol {
        static final JsonObject EXPECTED=load();
        private static JsonObject load(){
            try(var input=ContextTaskReceipt.class.getResourceAsStream("/voxelstudio/context-analysis-protocol.json")){
                if(input==null)throw new IllegalStateException("Missing packaged analysis protocol");
                var value=JsonParser.parseString(new String(input.readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();
                keys(value,"version","rules","schema");if(number(value,"version")!=1)throw new IllegalStateException("Unsupported packaged analysis protocol");return value;
            }catch(java.io.IOException e){throw new IllegalStateException("Cannot verify packaged analysis protocol",e);}
        }
    }
    private static void verifyProtocol(JsonObject request){
        var protocol=request.getAsJsonObject("protocol");same(protocol,Protocol.EXPECTED);
        String actual=string(request,"protocolHash");if(!actual.matches("[a-f0-9]{64}")||!ContextReceipt.jsonHash(protocol).equals(actual))throw new IllegalStateException("Analysis rules/protocol changed");
    }
    static String analysisProtocolHash(){return ContextReceipt.jsonHash(Protocol.EXPECTED);}
    private static void verifyIntent(JsonObject value){
        keys(value,"format","version","purpose","agent","model","effort","prompt","maximumCalls");
        if(!string(value,"format").equals("WorldContextTaskIntent")||!Set.of(1L,2L).contains(number(value,"version"))||!string(value,"purpose").equals("context-analysis")||number(value,"maximumCalls")!=1)throw new IllegalStateException("Only a single read-only analysis task can be prepared");
        intent(string(value,"agent"),string(value,"model"),string(value,"effort"),string(value,"prompt"));
    }
    static JsonObject verify(SelectionReadService.Capture capture,JsonObject saved,JsonObject intent,JsonObject response){
        verifyIntent(intent);
        ContextReceipt.verify(capture,capture.payload().getBytes(StandardCharsets.UTF_8),saved);
        keys(response,"format","version","request","requestHash","disclosure","modelSent","canAuthorizePlacement","sendingImplemented","taskDisclosureHash");
        long version=number(intent,"version");
        if(!string(response,"format").equals("WorldContextTaskDisclosure")||number(response,"version")!=version)throw new IllegalStateException("Unsupported context task disclosure");
        no(response,"modelSent");no(response,"canAuthorizePlacement");no(response,"sendingImplemented");hash(response,"taskDisclosureHash");
        var record=saved.getAsJsonObject("record");var request=response.getAsJsonObject("request");
        if(version==2){keys(request,"format","version","contextId","snapshotHash","summaryHash","selectionHash","identity","intent","protocol","protocolHash");verifyProtocol(request);}
        else keys(request,"format","version","contextId","snapshotHash","summaryHash","selectionHash","identity","intent");
        if(!string(request,"format").equals("WorldContextTask")||number(request,"version")!=version||!string(request,"contextId").equals(capture.id())
            ||!ContextReceipt.jsonHash(request).equals(string(response,"requestHash")))throw new IllegalStateException("Exact context request changed");
        same(request.get("intent"),intent);same(request.get("identity"),record.get("identity"));
        for(var key:new String[]{"snapshotHash","selectionHash","summaryHash"})same(request.get(key),record.get(key));
        var disclosure=response.getAsJsonObject("disclosure");
        keys(disclosure,"format","version","contextId","payloadSha256","snapshotHash","summaryHash","selectionHash","identity","recordExpiresAt","recipient","summary",
            "disclosedData","excludedData","sourceAuthority","modelSent","canAuthorizePlacement","disclosureHash");
        if(!string(disclosure,"format").equals("WorldContextDisclosure")||number(disclosure,"version")!=1||!string(disclosure,"contextId").equals(capture.id())
            ||!string(disclosure,"sourceAuthority").equals("client-submitted-block-facts-not-a-server-signature"))throw new IllegalStateException("Context source/authority changed");
        no(disclosure,"modelSent");no(disclosure,"canAuthorizePlacement");hash(disclosure,"disclosureHash");
        for(var key:new String[]{"payloadSha256","snapshotHash","summaryHash","selectionHash","identity"})same(disclosure.get(key),record.get(key));
        same(disclosure.get("recordExpiresAt"),record.get("expiresAt"));same(disclosure.get("summary"),saved.get("summary"));
        var recipient=disclosure.getAsJsonObject("recipient");keys(recipient,"agent","model","requestHash");
        same(recipient.get("agent"),intent.get("agent"));same(recipient.get("model"),intent.get("model"));same(recipient.get("requestHash"),response.get("requestHash"));
        same(disclosure.get("disclosedData"),JsonParser.parseString("[\"absolute-context-edit-protection-coordinates\",\"block-state-material-counts\",\"known-unknown-coverage\",\"bounded-observed-height-LOD\",\"opaque-session-identity-and-revisions\"]"));
        same(disclosure.get("excludedData"),JsonParser.parseString("[\"NBT\",\"container-items\",\"sign-book-text\",\"entities\",\"save-paths\",\"precise-per-cell-baseline\",\"screenshots\"]"));
        return response;
    }
    static JsonObject verifyConsent(JsonObject prepared,JsonObject response){
        return verifyConsent(prepared,response,System.currentTimeMillis());
    }
    static JsonObject verifyConsent(JsonObject prepared,JsonObject response,long now){
        keys(response,"format","version","id","contextId","disclosureHash","snapshotHash","summaryHash","selectionHash","recipient","createdAt","expiresAt","state","modelSent","canAuthorizePlacement");
        if(!string(response,"format").equals("WorldContextConsent")||number(response,"version")!=1||!string(response,"id").matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")||!string(response,"state").equals("confirmed-not-sent"))throw new IllegalStateException("Invalid unsent context confirmation");
        no(response,"modelSent");no(response,"canAuthorizePlacement");var disclosure=prepared.getAsJsonObject("disclosure");
        for(var key:new String[]{"contextId","disclosureHash","snapshotHash","summaryHash","selectionHash","recipient"})same(response.get(key),disclosure.get(key));
        long created=number(response,"createdAt"),expires=number(response,"expiresAt");
        if(created>now+10000||expires<=now||expires<=created||expires>created+300000||expires>number(disclosure,"recordExpiresAt"))throw new IllegalStateException("Context confirmation expired or lifetime changed");
        return response;
    }
    static String details(JsonObject prepared){
        var request=prepared.getAsJsonObject("request");var intent=request.getAsJsonObject("intent");var summary=prepared.getAsJsonObject("disclosure").getAsJsonObject("summary");
        String protocol=number(request,"version")==2?"\n\n只读分析规则原文：\n"+request.getAsJsonObject("protocol").get("rules").getAsString()+"\n\n输出数据协议：\n"+request.getAsJsonObject("protocol").get("schema")+"\n协议 hash："+request.get("protocolHash").getAsString():"";
        return "精确任务与发送内容（开发预备，尚不发送模型）\n\nAgent："+intent.get("agent").getAsString()+"\n模型："+intent.get("model").getAsString()+"\n推理："+intent.get("effort").getAsString()+"\n用途：只读环境分析；最多 1 次调用，不自动纠错/重发\n\n提示词原文：\n"+intent.get("prompt").getAsString()+protocol
            +"\n\n外层 C："+summary.get("context")+"\n内层 W："+summary.get("edit")+"\n保护区："+summary.get("protected")+"\n已知格数："+summary.get("knownCells")+"；未知格数："+summary.get("unknownCells")
            +"\n\n拟发送：范围坐标、材质统计、已知/未知覆盖、高度 LOD、opaque 身份与版本。\n不发送：NBT、容器物品、告示牌/书籍文字、实体、存档路径、逐格内层基线或截图。\nLOD 不证明道路、入口、支撑或通行；未知不是空气。"
            +"\n\n任务 hash："+prepared.get("requestHash").getAsString()+"\n快照 hash："+request.get("snapshotHash").getAsString()+"\n\n此准备回执仅确认内容，不执行调用、不写世界。发送须在独立审核页另行确认一次，且配套须明确开放能力；正常配套仍关闭。确认最多有效 5 分钟；改环境/选区/模型/提示词后不可使用旧确认。";
    }
    private ContextTaskReceipt(){}
}
