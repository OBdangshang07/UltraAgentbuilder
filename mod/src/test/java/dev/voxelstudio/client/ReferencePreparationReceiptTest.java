package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ReferencePreparationReceiptTest {
    static JsonObject fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-player/cases.json"))).getAsJsonObject();}
    static ReferenceImageDraft.Snapshot snapshot(JsonObject c)throws Exception {
        var upload=c.getAsJsonObject("upload");var photos=new ArrayList<ReferenceImageDraft.Photo>();int index=0;
        for(var e:upload.getAsJsonArray("references")){var r=e.getAsJsonObject();var source=new ReferenceImageDraft.Source(Base64.getDecoder().decode(r.get("png").getAsString()));photos.add(new ReferenceImageDraft.Photo("fixture-"+(index++),source,null,0,source.full,r.getAsJsonObject("annotation")));}
        return new ReferenceImageDraft.Snapshot(c.getAsJsonObject("generation").get("key").getAsString(),0,upload.get("mode").getAsString(),photos);
    }
    @Test void exactProductionWorkerPreparationsAcrossAllTiersAndStagedBudgetsVerifyInJava()throws Exception {
        var root=fixtures();assertEquals(0,root.get("modelCalls").getAsInt());assertEquals(0,root.get("worldWrites").getAsInt());assertEquals(10,root.getAsJsonArray("cases").size());
        for(var e:root.getAsJsonArray("cases")){
            var c=e.getAsJsonObject();var p=c.getAsJsonObject("preparation");var snapshot=snapshot(c);
            assertEquals(c.get("referencePolicy"),ReferencePreparationReceipt.expectedPolicy(c.getAsJsonObject("generation"),c.getAsJsonObject("ordinaryPolicy")));
            assertEquals(p,ReferencePreparationReceipt.verify(snapshot,c.getAsJsonObject("generation"),c.getAsJsonObject("ordinaryPolicy"),p));
            assertEquals(c.get("receipt"),ReferencePreparationReceipt.verifyFreeConfirmation(p,c.getAsJsonObject("receipt")));
            assertEquals(c.get("submission"),ReferencePreparationReceipt.send(p));assertEquals(c.get("submissionHash").getAsString(),ContextReceipt.jsonHash(ReferencePreparationReceipt.send(p)));
            var refs=c.getAsJsonObject("upload").getAsJsonArray("references");for(int i=0;i<refs.size();i++)assertNotNull(ReferencePreparationReceipt.pixels(snapshot.photos().get(i),p.getAsJsonArray("references").get(i).getAsJsonObject(),Base64.getDecoder().decode(refs.get(i).getAsJsonObject().get("png").getAsString())));
            var detail=ReferencePreparationReceipt.details(p);assertTrue(detail.contains("尚未调用模型"));assertTrue(detail.contains("共享调用上限"));assertTrue(detail.contains("独立 SEND"));assertTrue(detail.contains("不上传"));
        }
    }
    static void rehash(JsonObject p,String field){var value=p.deepCopy();value.remove(field);p.addProperty(field,ContextReceipt.jsonHash(value));}
    @Test void rehashedChangedBudgetModelCaptionOrReorderedImagesCannotReplaceTheConfirmedRequest()throws Exception {
        var c=fixtures().getAsJsonArray("cases").get(0).getAsJsonObject();var snapshot=snapshot(c);var g=c.getAsJsonObject("generation");var policy=c.getAsJsonObject("ordinaryPolicy");
        for(String mutation:List.of("budget","model","caption","order","owner","authority")){
            var p=c.getAsJsonObject("preparation").deepCopy();
            switch(mutation){
                case "budget"->p.getAsJsonObject("policy").getAsJsonObject("assembly").addProperty("maximumCalls",26);
                case "model"->p.addProperty("model","another-model");
                case "caption"->{var r=p.getAsJsonArray("references").get(0).getAsJsonObject();r.getAsJsonObject("annotation").addProperty("caption","changed");rehash(r,"id");}
                case "order"->{var r=p.getAsJsonArray("references");var first=r.get(0);r.set(0,r.get(1));r.set(1,first);}
                case "owner"->p.addProperty("ownerId",UUID.randomUUID().toString());
                case "authority"->p.addProperty("generationSubmitted",true);
            }
            rehash(p,"preparationHash");assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.verify(snapshot,g,policy,p),mutation);
        }
    }
    @Test void actualPixelsNotJustRehashableImageClaimsAreCompared()throws Exception {
        var c=fixtures().getAsJsonArray("cases").get(0).getAsJsonObject();var photo=snapshot(c).photos().get(0);var record=c.getAsJsonObject("preparation").getAsJsonArray("references").get(0).getAsJsonObject().deepCopy();
        byte[] changed=ReferenceImageDraftTest.png(3,2);record.addProperty("sha256",ContextReceipt.sha256(changed));record.addProperty("bytes",changed.length);rehash(record,"id");
        assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.pixels(photo,record,changed));
        assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.pixels(photo,record,new byte[]{1,2,3}));
    }
    @Test void freeConfirmationAndProcessCapabilityAreNotInterchangeableWithSend()throws Exception {
        var root=fixtures();assertTrue(ReferencePreparationReceipt.sendingEnabled(root.getAsJsonObject("enabledCapability")));assertFalse(ReferencePreparationReceipt.sendingEnabled(root.getAsJsonObject("disabledCapability")));
        var c=root.getAsJsonArray("cases").get(0).getAsJsonObject();var p=c.getAsJsonObject("preparation");assertNotEquals(ReferencePreparationReceipt.freeConfirmation(p),ReferencePreparationReceipt.send(p).get("sendConfirmation"));
        var wrong=c.getAsJsonObject("receipt").deepCopy();wrong.addProperty("generationSubmitted",true);rehash(wrong,"receiptHash");assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.verifyFreeConfirmation(p,wrong));
        var capability=root.getAsJsonObject("enabledCapability").deepCopy();capability.addProperty("canAuthorizePlacement",true);assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.sendingEnabled(capability));
    }
    @Test void originalJobIdentityAndBudgetRemainBoundOnRecovery()throws Exception {
        var c=fixtures().getAsJsonArray("cases").get(0).getAsJsonObject();var p=c.getAsJsonObject("preparation");var identity=new JsonObject();identity.add("key",p.get("ownerId"));identity.add("model",p.get("model"));identity.add("referencePreparationHash",p.get("preparationHash"));identity.addProperty("referencePolicyHash",ContextReceipt.jsonHash(p.get("policy")));
        var job=new JsonObject();job.addProperty("id",UUID.randomUUID().toString());job.add("key",p.get("ownerId"));job.addProperty("agent","codex");job.add("model",p.get("model"));job.add("preflight",p.get("policy").deepCopy());var r=new JsonObject();r.addProperty("version",1);r.add("preparationHash",p.get("preparationHash"));var input=new JsonObject();input.addProperty("format","JobReferenceInput");input.addProperty("version",1);input.add("ownerId",p.get("ownerId"));input.addProperty("bindingHash","a".repeat(64));r.add("input",input);job.add("referenceGeneration",r);
        assertDoesNotThrow(()->ReferencePreparationReceipt.verifyOriginalJob(identity,job));identity.add("jobId",job.get("id"));assertDoesNotThrow(()->ReferencePreparationReceipt.verifyOriginalJob(identity,job));
        var another=job.deepCopy();another.addProperty("id",UUID.randomUUID().toString());assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.verifyOriginalJob(identity,another));
        var cap=job.deepCopy();cap.getAsJsonObject("preflight").getAsJsonObject("assembly").addProperty("maximumCalls",26);assertThrows(IllegalStateException.class,()->ReferencePreparationReceipt.verifyOriginalJob(identity,cap));
    }
}
