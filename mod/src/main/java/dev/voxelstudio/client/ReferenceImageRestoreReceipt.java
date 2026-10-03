package dev.voxelstudio.client;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import static dev.voxelstudio.client.ReferencePreparationReceipt.*;

/** Exact original bytes become pictures in a NEW editor owner, never a
 * preparation, model confirmation, task recovery or world capability. */
final class ReferenceImageRestoreReceipt {
    static final int RECORD_BYTES=131072;
    record Loaded(JsonObject preparation,List<ReferenceImageDraft.Photo> photos) {
        Loaded {preparation=preparation.deepCopy();photos=List.copyOf(photos);}
        @Override public JsonObject preparation(){return preparation.deepCopy();}
        String mode(){return text(preparation,"referenceMode");}
    }
    static JsonObject capabilities(JsonObject c){
        keys(c,"format","version","readOnly","exactOriginalRecordBytes","newEditorOwnerRequired","generationAuthorityTransferred","additionalModelCalls","worldWrites","canAuthorizePlacement","limits");
        require(text(c,"format").equals("ReferenceImageRestoreCapabilities")&&number(c,"version")==1
            &&flag(c,"readOnly")&&flag(c,"exactOriginalRecordBytes")&&flag(c,"newEditorOwnerRequired")
            &&!flag(c,"generationAuthorityTransferred")&&number(c,"additionalModelCalls")==0&&number(c,"worldWrites")==0&&!flag(c,"canAuthorizePlacement"));
        var l=c.getAsJsonObject("limits");keys(l,"recordBytes","maximumImages","imageBytes","setBytes","setPixels");
        require(number(l,"recordBytes")==RECORD_BYTES&&number(l,"maximumImages")==ReferenceImageDraft.MAX_IMAGES
            &&number(l,"imageBytes")==ReferenceImageNormalizer.MAX_OUTPUT_BYTES&&number(l,"setBytes")==ReferenceImageDraft.MAX_SET_BYTES&&number(l,"setPixels")==ReferenceImageDraft.MAX_SET_PIXELS);return c.deepCopy();
    }
    static JsonObject selectedSnapshot(JsonObject s,String selectedHash){
        var exact=ReferenceArchiveReceipt.snapshot(text(s,"ownerId"),s);
        require(selectedHash!=null&&selectedHash.matches("[a-f0-9]{64}")&&exact.getAsJsonArray("preparationHashes").asList().stream().anyMatch(e->e.getAsString().equals(selectedHash)));
        file(exact,"preparations/"+selectedHash+"/preparation.json");return exact;
    }
    private static JsonObject file(JsonObject snapshot,String path){
        return snapshot.getAsJsonArray("files").asList().stream().map(JsonElement::getAsJsonObject)
            .filter(f->text(f,"path").equals(path)).findFirst().orElseThrow(()->new IllegalStateException("原图片文件不属于所选准确清单"));
    }
    private static void exactBytes(JsonObject f,byte[] bytes){
        require(bytes!=null&&bytes.length==number(f,"bytes")&&ContextReceipt.sha256(bytes).equals(text(f,"sha256")));
    }
    static JsonObject record(JsonObject snapshot,String selectedHash,byte[] bytes)throws Exception {
        var s=selectedSnapshot(snapshot,selectedHash);require(bytes!=null&&bytes.length>0&&bytes.length<=RECORD_BYTES);
        // The inventory is a RAW-FILE hash, not canonical/transport JSON.
        exactBytes(file(s,"preparations/"+selectedHash+"/preparation.json"),bytes);
        var utf8=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
        var p=WorldPatchCandidateReceipt.strictJson(utf8.decode(ByteBuffer.wrap(bytes)).toString(),()->Thread.currentThread().isInterrupted()).getAsJsonObject();
        keys(p,"format","version","ownerId","provider","model","generation","generationHash","requestHash","referenceSetHash","references","referenceMode","policy","runtimeHash","referenceAnalysisUsesTaskBudget","generationSubmitted","callsReserved","sendingImplemented","canAuthorizePlacement","preparationHash");
        hash(p,"preparationHash");noAuthority(p);digest(p,"runtimeHash");digest(p,"referenceSetHash");
        long version=number(p,"version");
        require(text(p,"format").equals("ReferenceGenerationPreparation")&&(version==1||version==2)
            &&text(p,"ownerId").equals(text(s,"ownerId"))&&text(p,"preparationHash").equals(selectedHash)
            &&text(p,"provider").equals("codex")&&flag(p,"referenceAnalysisUsesTaskBudget")&&ReferenceImageDraft.MODES.contains(text(p,"referenceMode")));
        var g=p.getAsJsonObject("generation");
        require(text(g,"key").equals(text(s,"ownerId"))&&text(g,"agent").equals("codex")&&text(g,"model").equals(text(p,"model"))
            &&text(g,"generationMode").equals("scene")&&text(g,"sceneWorkflow").equals("components")&&flag(g,"assemblyConfirmed")
            &&ContextReceipt.jsonHash(g).equals(text(p,"generationHash")));
        var request=new JsonObject();request.addProperty("version",version);request.add("generation",g);request.add("referenceSetHash",p.get("referenceSetHash"));
        if(version==2){request.addProperty("policyHash",ContextReceipt.jsonHash(p.get("policy")));request.add("runtimeHash",p.get("runtimeHash"));}
        require(ContextReceipt.jsonHash(request).equals(text(p,"requestHash")));
        var refs=p.getAsJsonArray("references");require(refs.size()>0&&refs.size()<=ReferenceImageDraft.MAX_IMAGES);long pixels=0,totalBytes=0;
        for(int i=0;i<refs.size();i++){
            var f=refs.get(i).getAsJsonObject();keys(f,"id","file","sha256","width","height","bytes","annotation");hash(f,"id");digest(f,"sha256");
            long w=number(f,"width"),h=number(f,"height"),size=number(f,"bytes");
            require(w>0&&h>0&&w<=2048&&h<=2048&&size>=45&&size<=ReferenceImageNormalizer.MAX_OUTPUT_BYTES&&text(f,"file").equals("image-"+i+".png"));
            var a=f.getAsJsonObject("annotation");ReferenceImageDraft.validateAnnotation(a);
            for(String k:List.of("purpose","view","caption"))text(a,k);
            if(a.has("scale")){text(a.getAsJsonObject("scale"),"dimension");require(a.getAsJsonObject("scale").get("meters").isJsonPrimitive()&&a.getAsJsonObject("scale").getAsJsonPrimitive("meters").isNumber());}
            var inventory=file(s,"reference-sets/"+text(p,"referenceSetHash")+"/"+text(f,"file"));
            require(number(inventory,"bytes")==size&&text(inventory,"sha256").equals(text(f,"sha256")));pixels+=w*h;totalBytes+=size;
        }
        require(pixels<=ReferenceImageDraft.MAX_SET_PIXELS&&totalBytes<=ReferenceImageDraft.MAX_SET_BYTES);
        var manifest=new JsonObject();manifest.addProperty("format","UserReferenceSet");manifest.addProperty("version",1);manifest.add("ownerId",p.get("ownerId"));manifest.add("mode",p.get("referenceMode"));manifest.add("references",refs);
        manifest.addProperty("pixels",pixels);manifest.addProperty("bytes",totalBytes);manifest.addProperty("metadataRemoved",true);manifest.addProperty("untrustedData",true);manifest.addProperty("worldCaptured",false);manifest.addProperty("canAuthorizePlacement",false);
        require(ContextReceipt.jsonHash(manifest).equals(text(p,"referenceSetHash")));return p.deepCopy();
    }
    static ReferenceImageDraft.Photo photo(JsonObject snapshot,JsonObject p,int index,byte[] bytes)throws Exception {
        var refs=p.getAsJsonArray("references");require(index>=0&&index<refs.size());
        var r=refs.get(index).getAsJsonObject();exactBytes(file(snapshot,"reference-sets/"+text(p,"referenceSetHash")+"/"+text(r,"file")),bytes);
        require(bytes.length>=8&&bytes[0]==(byte)137&&bytes[1]==80&&bytes[2]==78&&bytes[3]==71);
        var output=ReferenceJobHistoryReceipt.pixels(r,bytes);var source=new ReferenceImageDraft.Source(bytes);
        var normalized=new ReferenceImageDraft.Photo(UUID.randomUUID().toString(),source,null,0,source.full,r.getAsJsonObject("annotation"));
        ReferencePreparationReceipt.pixels(normalized,r,bytes);
        var photo=new ReferenceImageDraft.Photo(UUID.randomUUID().toString(),source,null,0,output,r.getAsJsonObject("annotation"));
        return photo;
    }
    static void apply(Loaded loaded,ReferenceImageDraft draft,String expectedOwner,long expectedRevision,boolean editable){
        synchronized(draft){
            require(editable&&draft.ownerId().equals(expectedOwner)&&draft.revision()==expectedRevision);
            draft.restore(loaded.mode(),loaded.photos(),expectedRevision);
        }
    }
    static String details(Loaded loaded){
        var p=loaded.preparation();var out=new StringBuilder("将明确选择的服务器规范化图片替换到当前内存编辑，创建全新的草稿身份。\n\n只有图片、排序、用途、视向、说明和已知尺度会恢复。原裁剪/旋转已烘焙到像素，无法还原未上传的原图部分。不会自动保存到本机，也不会修改或删除服务器文件、源图与任务回答。\n\n旧提示词、模型、预算、准备和 SEND 确认全部不继承。之后须重新准备并独立确认发送；零模型调用、零世界写入。\n\n来源草稿：").append(text(p,"ownerId")).append("\n准确准备：").append(text(p,"preparationHash")).append("\n参考方式：").append(StudioReferenceScreen.modeLabel(text(p,"referenceMode")));
        int i=0;for(var r:p.getAsJsonArray("references")){var a=r.getAsJsonObject();out.append("\n\n图片 ").append(++i).append(" · ").append(number(a,"width")).append("×").append(number(a,"height")).append("\n").append(a.get("annotation"));}
        return out.toString();
    }
    private static void require(boolean value){if(!value)throw new IllegalStateException("准确原图片、清单或当前编辑状态不符；未替换草稿，不重发任务");}
    private ReferenceImageRestoreReceipt(){}
}
