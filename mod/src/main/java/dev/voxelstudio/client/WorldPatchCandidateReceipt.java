package dev.voxelstudio.client;

import com.google.gson.*;
import com.google.gson.stream.*;
import java.io.*;
import dev.voxelstudio.selection.WorldPatchPreview;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Download integrity only. Original pins must be retained independently from
 * the verified task/response, NOT copied out of an unverified download. No
 * current-server certificate or world-write authority is produced here. */
final class WorldPatchCandidateReceipt {
    static final int MAX_BYTES=16*1024*1024+65536;
    static final int MAX_RESPONSE_BYTES=2*1024*1024,MAX_CANDIDATE_BYTES=MAX_BYTES+MAX_RESPONSE_BYTES;
    record Reference(String capsuleId,String manifestHash,String submissionHash,String runtimeHash,String responseHash,String candidateHash,WorldPatchPreview.Binding binding){
        Reference {Objects.requireNonNull(binding);for(var hash:List.of(capsuleId,manifestHash,submissionHash,runtimeHash,responseHash,candidateHash))if(!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("原改造候选 hash 无效");}
    }
    record Download(Reference reference,String downloadHash,WorldPatchPreview preview) {
        boolean canAuthorizePlacement(){return false;}
        boolean currentWorldVerified(){return false;}
    }
    /** Constructible only after all independently retained pins are checked.
     * Never returns mutable proposal storage or grants a server capability. */
    static final class AuditableDownload implements WorldPatchCheckedCandidate {
        private final Download display;private final byte[] response;
        private AuditableDownload(Download display,byte[] response){this.display=display;this.response=response.clone();}
        Download display(){return display;}public WorldPatchPreview preview(){return display.preview();}Reference reference(){return display.reference();}
        public byte[] originalResponse(){return response.clone();}
        public String originalResponseHash(){return display.reference().responseHash();}
        public boolean canAuthorizePlacement(){return false;}
    }
    static Download parse(byte[] bytes,Reference expected,BooleanSupplier cancelled){
        var value=checkedValue(bytes,expected,cancelled,false);return display(value,expected,cancelled);
    }
    static AuditableDownload parseCandidate(byte[] bytes,Reference expected,BooleanSupplier cancelled){
        var value=checkedValue(bytes,expected,cancelled,true);var proposal=value.get("proposal");
        if(!proposal.isJsonObject()||!ContextReceipt.jsonHash(proposal).equals(expected.responseHash()))throw new IllegalStateException("原响应不能由下载重新绑定或替换");
        var response=proposal.toString().getBytes(StandardCharsets.UTF_8);
        if(response.length==0||response.length>MAX_RESPONSE_BYTES)throw new IllegalStateException("原响应下载超额");
        var display=display(value,expected,cancelled);allowed(cancelled);return new AuditableDownload(display,response);
    }
    private static Download display(JsonObject value,Reference expected,BooleanSupplier cancelled){
        var preview=WorldPatchPreview.parse(value.get("preview").toString().getBytes(StandardCharsets.UTF_8),expected.binding(),cancelled);
        allowed(cancelled);return new Download(expected,string(value,"downloadHash"),preview);
    }
    private static JsonObject checkedValue(byte[] bytes,Reference expected,BooleanSupplier cancelled,boolean proposal){
        Objects.requireNonNull(bytes);Objects.requireNonNull(expected);Objects.requireNonNull(cancelled);
        if(bytes.length==0||bytes.length>(proposal?MAX_CANDIDATE_BYTES:MAX_BYTES))throw new IllegalStateException("改造候选下载超额");allowed(cancelled);
        final String text;try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException error){throw new IllegalStateException("改造预览不是完整 UTF-8",error);}
        var value=strictJson(text,cancelled).getAsJsonObject();
        var fields=new HashSet<>(Set.of("format","version","capsuleId","manifestHash","submissionHash","runtimeHash","responseHash","candidateHash","snapshotHash","selectionHash","patchHash","previewHash","selection","contextRevision","preview","archivedSourceOnly","originalResponseReverified","candidateFilesReverified","serverBaselineVerified","canAuthorizePlacement","additionalModelCalls","worldWrites","downloadHash"));if(proposal)fields.add("proposal");
        if(!value.keySet().equals(fields))throw new IllegalStateException("改造候选字段不一致");
        eq(value,"format",proposal?"FrozenWorldPatchCandidateDownload":"FrozenWorldPatchPreviewDownload");integer(value,"version",1);
        eq(value,"capsuleId",expected.capsuleId);eq(value,"manifestHash",expected.manifestHash);eq(value,"submissionHash",expected.submissionHash);eq(value,"runtimeHash",expected.runtimeHash);eq(value,"responseHash",expected.responseHash);eq(value,"candidateHash",expected.candidateHash);
        var binding=expected.binding;eq(value,"snapshotHash",binding.snapshotHash());eq(value,"selectionHash",binding.selectionHash());eq(value,"patchHash",binding.patchHash());eq(value,"previewHash",binding.previewHash());
        if(!binding.selection().json().equals(value.get("selection")))throw new IllegalStateException("不能把原改造候选切换选区或世界");integer(value,"contextRevision",binding.contextRevision());
        for(var field:List.of("archivedSourceOnly","originalResponseReverified","candidateFilesReverified"))flag(value,field,true);
        for(var field:List.of("serverBaselineVerified","canAuthorizePlacement"))flag(value,field,false);
        integer(value,"additionalModelCalls",0);integer(value,"worldWrites",0);
        String hash=string(value,"downloadHash");var content=value.deepCopy();content.remove("downloadHash");
        if(!hash.matches("[a-f0-9]{64}")||!ContextReceipt.jsonHash(content).equals(hash))throw new IllegalStateException("改造预览下载内容 hash 不一致");
        allowed(cancelled);
        return value;
    }
    private static void allowed(BooleanSupplier cancelled){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("改造预览加载已取消");}
    static JsonElement strictJson(String text,BooleanSupplier cancelled){
        try(var reader=new JsonReader(new StringReader(text))){
            reader.setLenient(false);var value=readJson(reader,0,new int[]{0},cancelled);
            if(reader.peek()!=JsonToken.END_DOCUMENT)throw new IllegalStateException("改造预览有额外内容");return value;
        }catch(IOException error){throw new IllegalStateException("改造预览 JSON 不完整",error);}
    }
    private static JsonElement readJson(JsonReader reader,int depth,int[] nodes,BooleanSupplier cancelled)throws IOException{
        if(depth>32||++nodes[0]>2_000_000)throw new IllegalStateException("改造预览 JSON 结构超额");
        if((nodes[0]&1023)==0)allowed(cancelled);
        return switch(reader.peek()){
            case BEGIN_OBJECT->{reader.beginObject();var o=new JsonObject();while(reader.hasNext()){String name=reader.nextName();if(o.has(name))throw new IllegalStateException("改造预览字段重复");o.add(name,readJson(reader,depth+1,nodes,cancelled));}reader.endObject();yield o;}
            case BEGIN_ARRAY->{reader.beginArray();var a=new JsonArray();while(reader.hasNext())a.add(readJson(reader,depth+1,nodes,cancelled));reader.endArray();yield a;}
            case STRING->new JsonPrimitive(reader.nextString());
            case NUMBER->new JsonPrimitive(new java.math.BigDecimal(reader.nextString()));
            case BOOLEAN->new JsonPrimitive(reader.nextBoolean());
            case NULL->{reader.nextNull();yield JsonNull.INSTANCE;}
            default->throw new IllegalStateException("改造预览 JSON 类型无效");
        };
    }
    private static String string(JsonObject o,String key){var v=o.get(key);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString())throw new IllegalStateException("改造预览字符串无效："+key);return v.getAsString();}
    private static void eq(JsonObject o,String key,String expected){if(!string(o,key).equals(expected))throw new IllegalStateException("原候选身份改变："+key);}
    private static void integer(JsonObject o,String key,long expected){var v=o.get(key);try{if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber()||v.getAsBigDecimal().longValueExact()!=expected)throw new IllegalStateException("改造预览数值不一致："+key);}catch(ArithmeticException error){throw new IllegalStateException("改造预览必须是整数",error);}}
    private static void flag(JsonObject o,String key,boolean expected){var v=o.get(key);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isBoolean()||v.getAsBoolean()!=expected)throw new IllegalStateException("改造预览权限不一致："+key);}
    private WorldPatchCandidateReceipt(){}
}
