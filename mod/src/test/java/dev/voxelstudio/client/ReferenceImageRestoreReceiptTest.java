package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceImageRestoreReceiptTest {
    static JsonObject fixture()throws Exception{return ReferencePreparationReceiptTest.fixtures().getAsJsonArray("cases").get(0).getAsJsonObject();}
    static byte[] raw(JsonObject c){return Base64.getDecoder().decode(c.getAsJsonObject("editorRestore").get("record").getAsString());}
    static JsonObject scope(JsonObject c){return c.getAsJsonObject("editorRestore").getAsJsonObject("snapshot").deepCopy();}
    static JsonObject scopeWithRaw(JsonObject s,String preparationHash,byte[] bytes){
        s=s.deepCopy();for(var e:s.getAsJsonArray("files")){var f=e.getAsJsonObject();if(f.get("path").getAsString().equals("preparations/"+preparationHash+"/preparation.json")){long old=f.get("bytes").getAsLong();f.addProperty("bytes",bytes.length);f.addProperty("sha256",ContextReceipt.sha256(bytes));s.addProperty("totalBytes",s.get("totalBytes").getAsLong()-old+bytes.length);}}
        ReferencePreparationReceiptTest.rehash(s,"snapshotHash");return s;
    }
    static ReferenceImageRestoreReceipt.Loaded loaded(JsonObject c)throws Exception{
        var s=scope(c);String hash=c.getAsJsonObject("preparation").get("preparationHash").getAsString();
        var p=ReferenceImageRestoreReceipt.record(s,hash,raw(c));var photos=new ArrayList<ReferenceImageDraft.Photo>();
        for(int i=0;i<p.getAsJsonArray("references").size();i++)photos.add(ReferenceImageRestoreReceipt.photo(s,p,i,Base64.getDecoder().decode(c.getAsJsonObject("editorRestore").getAsJsonArray("images").get(i).getAsString())));
        return new ReferenceImageRestoreReceipt.Loaded(p,photos);
    }
    @Test void allProductionWorkerVersionsRestoreExactPicturesAndAnnotationsIntoANewOwner()throws Exception{
        var root=ReferencePreparationReceiptTest.fixtures();assertEquals(0,root.get("modelCalls").getAsInt());
        assertNotNull(ReferenceImageRestoreReceipt.capabilities(root.getAsJsonObject("imageRestoreCapability")));
        for(var e:root.getAsJsonArray("cases")){
            var c=e.getAsJsonObject();var saved=loaded(c);assertEquals(c.get("preparation"),saved.preparation());
            var draft=new ReferenceImageDraft();String old=draft.ownerId();long revision=draft.revision();
            ReferenceImageRestoreReceipt.apply(saved,draft,old,revision,true);
            assertNotEquals(old,draft.ownerId());assertNotEquals(c.getAsJsonObject("generation").get("key").getAsString(),draft.ownerId());
            assertEquals(revision+1,draft.revision());assertEquals(saved.mode(),draft.mode());
            assertEquals(2,draft.photos().size());
            for(int i=0;i<2;i++){var r=c.getAsJsonObject("preparation").getAsJsonArray("references").get(i).getAsJsonObject();
                assertEquals(r.get("annotation"),draft.photos().get(i).annotation());assertEquals(r.get("sha256").getAsString(),ContextReceipt.sha256(draft.photos().get(i).output().png()));
                assertNull(draft.photos().get(i).crop());assertEquals(0,draft.photos().get(i).turns());
            }
            assertFalse(draft.current(new ReferenceImageDraft.Snapshot(old,revision,saved.mode(),saved.photos())));
            assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.apply(saved,draft,old,revision,true));
            saved.preparation().addProperty("model","cannot alter retained metadata");assertEquals(c.get("preparation"),saved.preparation());
        }
    }
    @Test void inventoryHashIsExactOriginalFileBytesNotCanonicalOrReencodedJson()throws Exception{
        var c=fixture();var s=scope(c);String hash=c.getAsJsonObject("preparation").get("preparationHash").getAsString();
        // Gson defaults omit null object fields. That is a content mutation,
        // not merely reformatting, and must remain rejected by production.
        byte[] omitted=new GsonBuilder().setPrettyPrinting().create().toJson(c.get("preparation")).getBytes(StandardCharsets.UTF_8);
        assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.record(scopeWithRaw(s,hash,omitted),hash,omitted));
        byte[] changed=(new GsonBuilder().serializeNulls().setPrettyPrinting().create().toJson(c.get("preparation"))+"\n").getBytes(StandardCharsets.UTF_8);
        assertFalse(Arrays.equals(raw(c),changed));assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.record(s,hash,changed));
        assertEquals(c.get("preparation"),ReferenceImageRestoreReceipt.record(scopeWithRaw(s,hash,changed),hash,changed));
        var scope=scopeWithRaw(s,hash,raw(c));scope.getAsJsonArray("files").get(0).getAsJsonObject().addProperty("path","../../private");
        ReferencePreparationReceiptTest.rehash(scope,"snapshotHash");assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.record(scope,hash,raw(c)));
    }
    @Test void duplicateJsonFieldsMalformedUtf8UnknownOrWrongOwnerAndAuthorityFailClosed()throws Exception{
        var c=fixture();var s=scope(c);String hash=c.getAsJsonObject("preparation").get("preparationHash").getAsString();
        byte[] duplicate=("{\"format\":\"ReferenceGenerationPreparation\","+new String(raw(c),StandardCharsets.UTF_8).substring(1)).getBytes(StandardCharsets.UTF_8);
        for(byte[] bad:List.of(duplicate,new byte[]{(byte)255},new byte[ReferenceImageRestoreReceipt.RECORD_BYTES+1]))
            assertThrows(Exception.class,()->ReferenceImageRestoreReceipt.record(scopeWithRaw(s,hash,bad),hash,bad));
        assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.record(s,"a".repeat(64),raw(c)));
        for(String field:List.of("ownerId","generationSubmitted","callsReserved","sendingImplemented","canAuthorizePlacement","unknown")){
            var p=c.getAsJsonObject("preparation").deepCopy();
            switch(field){case "ownerId"->p.addProperty(field,UUID.randomUUID().toString());case "callsReserved"->p.addProperty(field,1);case "unknown"->p.addProperty(field,"execute");default->p.addProperty(field,true);}
            byte[] bytes=p.toString().getBytes(StandardCharsets.UTF_8);
            assertThrows(Exception.class,()->ReferenceImageRestoreReceipt.record(scopeWithRaw(s,hash,bytes),hash,bytes),field);
        }
    }
    @Test void missingChangedCrossSetAndTruncatedImageBytesNeverReplaceOriginals()throws Exception{
        var c=fixture();var saved=loaded(c);var s=scope(c);var p=saved.preparation();
        for(byte[] bad:List.of(new byte[]{1,2},ReferenceImageDraftTest.png(3,2)))
            assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.photo(s,p,0,bad));
        var missing=s.deepCopy();var missingFiles=missing.getAsJsonArray("files");
        for(int i=0;i<missingFiles.size();i++)if(missingFiles.get(i).getAsJsonObject().get("path").getAsString().endsWith("/image-0.png")){missingFiles.remove(i);break;}
        long remaining=0;for(var e:missingFiles)remaining+=e.getAsJsonObject().get("bytes").getAsLong();missing.addProperty("totalBytes",remaining);
        ReferencePreparationReceiptTest.rehash(missing,"snapshotHash");
        assertThrows(Exception.class,()->ReferenceImageRestoreReceipt.record(missing,p.get("preparationHash").getAsString(),raw(c)));
        var bad=p.deepCopy();bad.getAsJsonArray("references").get(0).getAsJsonObject().addProperty("width",2049);
        byte[] bytes=bad.toString().getBytes(StandardCharsets.UTF_8);
        assertThrows(Exception.class,()->ReferenceImageRestoreReceipt.record(scopeWithRaw(s,p.get("preparationHash").getAsString(),bytes),p.get("preparationHash").getAsString(),bytes));
    }
    @Test void changedEditorOwnerRevisionOrPendingTaskCannotBeOverwritten()throws Exception{
        var saved=loaded(fixture());
        for(String mutation:List.of("owner","revision","task")){
            var draft=new ReferenceImageDraft();String old=draft.ownerId();long revision=draft.revision();
            if(mutation.equals("owner"))draft.restore(saved.mode(),saved.photos(),revision);
            if(mutation.equals("revision"))draft.mode("reconstruct");
            String exactOwner=draft.ownerId();long exactRevision=draft.revision();var pictures=draft.photos();String mode=draft.mode();
            assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.apply(saved,draft,old,revision,!mutation.equals("task")));
            assertEquals(exactOwner,draft.ownerId());assertEquals(exactRevision,draft.revision());assertEquals(pictures,draft.photos());assertEquals(mode,draft.mode());
        }
        assertTrue(ReferenceImageRestoreReceipt.details(saved).contains("零模型调用"));
        assertTrue(ReferenceImageRestoreReceipt.details(saved).contains("全部不继承"));
    }
    @Test void imageRestoreCapabilitiesNeverInheritStorageOrSendAuthority()throws Exception{
        var c=ReferencePreparationReceiptTest.fixtures().getAsJsonObject("imageRestoreCapability");
        for(String field:List.of("readOnly","exactOriginalRecordBytes","newEditorOwnerRequired","generationAuthorityTransferred","additionalModelCalls","worldWrites","canAuthorizePlacement")){
            var bad=c.deepCopy();if(field.equals("additionalModelCalls")||field.equals("worldWrites"))bad.addProperty(field,1);else bad.addProperty(field,!bad.get(field).getAsBoolean());
            assertThrows(IllegalStateException.class,()->ReferenceImageRestoreReceipt.capabilities(bad),field);
        }
    }
}
