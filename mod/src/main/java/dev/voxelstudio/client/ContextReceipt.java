package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.TreeSet;
import java.nio.charset.StandardCharsets;

/** Integrity binding only. A hash from the Bridge is NOT server authority. */
final class ContextReceipt {
    static String sha256(byte[] bytes){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception e){throw new IllegalStateException(e);}}
    static String jsonHash(JsonElement value){return sha256(canonicalJson(value).getBytes(StandardCharsets.UTF_8));}
    static String canonicalJson(JsonElement value){if(value.isJsonObject()){var o=value.getAsJsonObject();return "{"+new TreeSet<>(o.keySet()).stream().map(k->quote(k)+":"+canonicalJson(o.get(k))).collect(java.util.stream.Collectors.joining(","))+"}";}if(value.isJsonArray())return "["+java.util.stream.StreamSupport.stream(value.getAsJsonArray().spliterator(),false).map(ContextReceipt::canonicalJson).collect(java.util.stream.Collectors.joining(","))+"]";if(value.isJsonPrimitive()&&value.getAsJsonPrimitive().isString())return quote(value.getAsString());return value.toString();}
    /** JSON.stringify string semantics: Gson escapes U+2028/2029 differently,
     * and raw lone UTF-16 surrogates would otherwise be lost in UTF-8 HTTP. */
    private static String quote(String text){var out=new StringBuilder("\"");for(int i=0;i<text.length();i++){char ch=text.charAt(i);switch(ch){
        case '"'->out.append("\\\"");case '\\'->out.append("\\\\");case '\b'->out.append("\\b");case '\f'->out.append("\\f");case '\n'->out.append("\\n");case '\r'->out.append("\\r");case '\t'->out.append("\\t");
        default->{boolean lone=Character.isHighSurrogate(ch)?i+1>=text.length()||!Character.isLowSurrogate(text.charAt(i+1)):Character.isLowSurrogate(ch)&&(i==0||!Character.isHighSurrogate(text.charAt(i-1)));
            if(ch<32||lone){var hex=Integer.toHexString(ch);out.append("\\u").append("0".repeat(4-hex.length())).append(hex);}else out.append(ch);}
    }}return out.append('"').toString();}
    private static String string(JsonObject o,String k){var v=o.get(k);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString())throw new IllegalStateException("Invalid context receipt field: "+k);return v.getAsString();}
    private static long integer(JsonObject o,String k){var v=o.get(k);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber()||!v.getAsString().matches("[0-9]+"))throw new IllegalStateException("Invalid context receipt integer: "+k);return v.getAsLong();}
    private static void readOnly(JsonObject o){for(var k:new String[]{"modelSent","canAuthorizePlacement"}){var v=o.get(k);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isBoolean()||v.getAsBoolean())throw new IllegalStateException("Context receipt claims model/world authority");}}
    static JsonObject verify(SelectionReadService.Capture capture,byte[] payload,JsonObject response){
        var record=response.getAsJsonObject("record");var summary=response.getAsJsonObject("summary");if(record==null||summary==null)throw new IllegalStateException("Missing saved context identity");
        readOnly(record);if(!summary.has("canAuthorizePlacement")||summary.get("canAuthorizePlacement").getAsBoolean())throw new IllegalStateException("Context summary claims placement authority");
        if(!string(record,"format").equals("SavedWorldContext")||integer(record,"version")!=1||!string(record,"id").equals(capture.id())
            ||!string(record,"payloadSha256").equals(sha256(payload))||integer(record,"payloadBytes")!=payload.length
            ||!string(record,"sourceAuthority").equals("client-submitted-block-facts-not-a-server-signature")||!string(record,"privacy").equals("block-states-only"))throw new IllegalStateException("Saved context payload/source binding changed");
        for(var field:new String[]{"snapshotHash","selectionHash","summaryHash"})if(!string(record,field).matches("[a-f0-9]{64}")||!string(record,field).equals(string(summary,field)))throw new IllegalStateException("Context summary hash binding changed");
        var content=summary.deepCopy();content.remove("summaryHash");if(!jsonHash(content).equals(string(record,"summaryHash"))||!jsonHash(capture.selection().json()).equals(string(record,"selectionHash")))throw new IllegalStateException("Context summary or selection integrity changed");
        var identity=record.getAsJsonObject("identity");var selection=capture.selection();
        if(identity==null||!string(identity,"worldId").equals(selection.world().worldId())||!string(identity,"dimension").equals(selection.world().dimension())
            ||integer(identity,"selectionRevision")!=selection.revision()||integer(identity,"contextRevision")!=capture.contextRevision())throw new IllegalStateException("Saved context world, dimension or revision changed");
        if(!selection.context().json().equals(summary.get("context"))||!selection.edit().json().equals(summary.get("edit"))
            ||!selection.json().get("protected").equals(summary.get("protected"))||integer(summary,"totalCells")!=selection.context().cells()
            ||integer(record,"totalCells")!=integer(summary,"totalCells")||integer(record,"knownCells")!=integer(summary,"knownCells")
            ||integer(record,"unknownCells")!=integer(summary,"unknownCells")||integer(summary,"knownCells")+integer(summary,"unknownCells")!=selection.context().cells())throw new IllegalStateException("Saved context bounds or coverage changed");
        long created=integer(record,"createdAt"),expires=integer(record,"expiresAt");if(expires<=System.currentTimeMillis()||expires-created!=86_400_000L)throw new IllegalStateException("Saved context expired or lifetime changed");
        return response;
    }
    static String details(JsonObject response){
        var record=response.getAsJsonObject("record");var s=response.getAsJsonObject("summary");var text=new StringBuilder("本地快照与环境摘要\n\n")
            .append("外层环境 C：").append(s.get("context")).append("\n内层改造 W：").append(s.get("edit")).append("\n保护区：").append(s.get("protected"))
            .append("\n\n已知 ").append(s.get("knownCells")).append(" 格；未知 ").append(s.get("unknownCells")).append(" 格。未知不是空气。")
            .append("\n已观察非空气 ").append(s.get("knownNonAirCells")).append(" 格；方块实体类型能力标记 ").append(s.get("knownBlockEntityCells")).append(" 格。")
            .append("\n高度 LOD：").append(s.getAsJsonObject("heightLod").get("cellSize")).append(" 格一组；仅表示已观察最高非空气 Y，不推断道路、入口、支撑或通行。\n\n主要方块状态：\n");
        for(var material:s.getAsJsonArray("materialCounts")){var m=material.getAsJsonObject();text.append(m.get("state").getAsString()).append(" · ").append(m.get("cells")).append(" 格\n");}
        text.append("\n省略状态种类 ").append(s.get("omittedMaterialKinds")).append("，省略格数 ").append(s.get("omittedMaterialCells"))
            .append("\n\n快照 ").append(record.get("snapshotHash").getAsString()).append("\n摘要 ").append(record.get("summaryHash").getAsString())
            .append("\n\n仅保存到本机。没有发送模型，没有生成改造，也没有建造权限。\n不读取 NBT、容器物品、告示牌/书籍文字、实体、存档路径或世界截图。")
            .append("\n后续发送必须明确确认具体模型、任务和本快照；改选区/环境/提示词/模型后须重新确认。hash 是完整性校验，不是世界授权签名。");return text.toString();
    }
    private ContextReceipt(){}
}
