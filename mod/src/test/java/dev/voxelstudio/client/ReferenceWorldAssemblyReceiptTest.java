package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Node-generated four-tier data. This does not prove game pixels, quality,
 * real model understanding or current-server/world transaction acceptance. */
class ReferenceWorldAssemblyReceiptTest {
    @TempDir Path root;
    static List<JsonObject> fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-world-assembly-client.json"))).getAsJsonArray().asList().stream().map(JsonElement::getAsJsonObject).toList();}
    static SelectionReadService.Capture capture(JsonObject f){return new SelectionReadService.Capture(f.get("contextId").getAsString(),WorldPatchJobReceipt.selection(f.getAsJsonObject("selection")),f.get("contextRevision").getAsLong(),f.get("payload").getAsString(),null,false);}
    static JsonObject reference(JsonObject f){return ReferenceWorldAssemblyReceipt.reference(capture(f),f.getAsJsonObject("saved"),f.getAsJsonObject("generation"),f.getAsJsonObject("manifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("prepared"));}
    static ReferenceWorldAssemblyPlan plan(JsonObject f){return new ReferenceWorldAssemblyPlan(reference(f),f.getAsJsonObject("manifest"),f.getAsJsonObject("capability"));}
    static JsonObject running(JsonObject f){
        var p=f.getAsJsonObject("prepared");var s=new JsonObject();s.addProperty("format","ReferenceWorldAssemblyRunnerStatus");s.addProperty("version",2);s.addProperty("purpose","reference-world-assembly");s.add("id",p.get("jobId"));s.addProperty("state","running");s.addProperty("stageEventsObserved",0);s.add("reservedCalls",JsonNull.INSTANCE);
        for(var k:List.of("maximumCalls","tier","preparationHash"))s.add(k,p.get(k));s.addProperty("requestHash",ContextReceipt.jsonHash(f.get("request")));s.add("candidate",JsonNull.INSTANCE);s.add("nativeEvidence",JsonNull.INSTANCE);s.addProperty("originalLiveExecutionOnly",true);s.addProperty("automaticRetries",0);
        for(var k:List.of("providerReceiptsIndependentlyAudited","serverBaselineVerified","allowsNewModelCall","canAuthorizePlacement"))s.addProperty(k,false);s.addProperty("worldWrites",0);return s;
    }
    @Test void allFourProductionPreparationsBindFullSendOriginalPixelsAndUnshrunkBounds()throws Exception{
        var values=fixtures();assertEquals(List.of("lite","pro","max","ultra"),values.stream().map(f->f.get("tier").getAsString()).toList());
        for(var f:values){var r=reference(f);var plan=plan(f);assertEquals(f.get("request"),r.get("request"));assertEquals(f.get("prepared"),plan.prepared());assertEquals(f.get("retained"),ReferenceWorldAssemblyReceipt.status(r,f.getAsJsonObject("retained")));assertEquals(running(f),ReferenceWorldAssemblyReceipt.status(r,running(f)));
            assertEquals(ReferenceWorldAssemblyReceipt.maximum(f.get("tier").getAsString()),plan.prepared().get("maximumCalls").getAsInt());assertTrue(plan.details().contains("不授权世界写入"));assertFalse(ReferenceWorldAssemblyReceipt.retentionBinding(capture(f),r).canAuthorizePlacement());
            if(f.get("tier").getAsString().equals("ultra"))assertEquals(224,plan.prepared().getAsJsonObject("maximumBounds").get("height").getAsInt());
        }
    }
    @Test void fullGenerationDoesNotInheritLegacyPromptOrEffortRestrictions()throws Exception{
        var original=fixtures().get(0).getAsJsonObject("generation");
        for(var effort:List.of("none","minimal","low","medium","high","xhigh","max","ultra")){
            var g=original.deepCopy();g.addProperty("effort",effort);g.addProperty("prompt","x".repeat(16000));assertDoesNotThrow(()->ReferenceWorldAssemblyReceipt.generation(g));
            var c=new JsonObject();c.add("id",g.get("model"));c.addProperty("supportsImages",true);var efforts=new JsonArray();efforts.add(effort);c.add("efforts",efforts);assertDoesNotThrow(()->ReferenceWorldAssemblyReceipt.capability(c,g));
        }
        for(var prompt:List.of("x".repeat(16001),"", "\u00a0\ufeff\u3000")){var g=original.deepCopy();g.addProperty("prompt",prompt);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.generation(g));}
        for(var effort:List.of("default","unsupported")){var g=original.deepCopy();g.addProperty("effort",effort);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.generation(g));}
        var invalid=original.deepCopy();invalid.addProperty("model","legacy/slash-alias");assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.generation(invalid));
    }
    @Test void changedPixelsAnnotationRecipientScopeRuntimeOrBudgetEvenRehashedCannotBind()throws Exception{
        var f=fixtures().get(0);for(var key:List.of("snapshotHash","recordHash","payloadSha256","referenceSetHash","origin","maximumBounds","imageAnnotations","selected","maximumCalls","generationHash","v1ConsentTransferable")){
            var p=f.getAsJsonObject("prepared").deepCopy();switch(key){case "origin"->p.add(key,JsonParser.parseString("[0,0,0]"));case "maximumBounds"->p.getAsJsonObject(key).addProperty("height",1);case "imageAnnotations"->p.getAsJsonArray(key).get(0).getAsJsonObject().getAsJsonObject("annotation").addProperty("caption","swapped");case "selected"->p.getAsJsonObject(key).addProperty("model","different");case "maximumCalls"->p.addProperty(key,26);case "v1ConsentTransferable"->p.addProperty(key,true);default->p.addProperty(key,"f".repeat(64));}
            p.remove("preparationHash");p.addProperty("preparationHash",ContextReceipt.jsonHash(p));assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.verifyPreparation(capture(f),f.getAsJsonObject("saved"),f.getAsJsonObject("generation"),f.getAsJsonObject("manifest"),f.getAsJsonObject("capability"),p),key);
        }
    }
    @Test void planIsDefensiveAndLegacyReferenceConsentCannotEnterFullLane()throws Exception{
        var f=fixtures().get(0);var plan=plan(f);var original=plan.reference();plan.reference().addProperty("canAuthorizePlacement",true);plan.manifest().addProperty("mode","inspire");plan.capability().addProperty("supportsImages",false);assertEquals(original,plan.reference());
        var full=new ReferenceWorldAssemblyReferences(root);assertTrue(full.claim(original));var legacy=ReferenceWorldPatchReferencesTest.reference(ReferenceWorldPatchReferencesTest.fixture());
        assertThrows(RuntimeException.class,()->full.claim(legacy));assertThrows(RuntimeException.class,()->new ReferenceWorldPatchReferences(root).claim(original));assertEquals(List.of(),new ReferenceWorldPatchReferences(root).list());
    }
    @Test void restartKeepsClaimAndUnknownHistoryNeverResumeOrRender()throws Exception{
        var f=fixtures().get(0);var r=reference(f);var store=new ReferenceWorldAssemblyReferences(root);assertTrue(store.claim(r));assertFalse(new ReferenceWorldAssemblyReferences(root).claim(r));assertEquals(List.of(r),store.list());
        var h=f.getAsJsonObject("retained").deepCopy();h.addProperty("state","unknown-needs-original-inspection");h.addProperty("reservedCalls",1);h.addProperty("pendingCalls",1);h.addProperty("originalDispatchRetained",true);assertEquals(h,ReferenceWorldAssemblyReceipt.status(r,h));assertNull(NativeEvidenceTarget.assembly(r.get("id").getAsString(),r.get("requestHash").getAsString(),h));
        h.addProperty("canResume",true);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.status(r,h));
    }
    @Test void corruptedOrPendingFullClaimsArePreservedAndNeverRecreated()throws Exception{
        var f=fixtures().get(0);var r=reference(f);var store=new ReferenceWorldAssemblyReferences(root);store.claim(r);var file=root.resolve("reference-world-assembly-references/"+r.get("preparationHash").getAsString()+".json");String original=Files.readString(file);
        for(var bytes:List.of(new byte[]{(byte)255},new byte[65537],("{\"version\":1,"+original.substring(1)).getBytes(java.nio.charset.StandardCharsets.UTF_8))){Files.write(file,bytes);assertThrows(IOException.class,store::list);assertThrows(IOException.class,()->store.claim(r));assertArrayEquals(bytes,Files.readAllBytes(file));}
        Files.writeString(file,original);var pending=file.resolveSibling(".pending-"+r.get("preparationHash").getAsString()+".json");Files.move(file,pending);assertEquals(List.of(),store.list());assertThrows(IOException.class,()->store.claim(r));assertEquals(original,Files.readString(pending));
    }
    @Test void statusSwapsAndIndividualPartAuthorityAreRejected()throws Exception{
        var f=fixtures().get(0);var r=reference(f);for(var key:List.of("id","requestHash","preparationHash","maximumCalls","tier","serverBaselineVerified","canAuthorizePlacement","allowsNewModelCall")){
            var s=running(f);if(key.equals("maximumCalls"))s.addProperty(key,26);else if(key.equals("tier"))s.addProperty(key,"ultra");else if(key.endsWith("Verified")||key.startsWith("can")||key.startsWith("allows"))s.addProperty(key,true);else s.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.status(r,s),key);
        }
        var s=running(f);s.addProperty("state","preview-ready");s.addProperty("reservedCalls",8);s.add("candidate",JsonParser.parseString("{\"candidateHash\":\""+"a".repeat(64)+"\",\"patchSetHash\":\""+"b".repeat(64)+"\",\"partCount\":2,\"operationCount\":9000,\"canAuthorizePlacement\":false,\"partIsApplyScope\":false}"));assertEquals(s,ReferenceWorldAssemblyReceipt.status(r,s));s.getAsJsonObject("candidate").addProperty("partIsApplyScope",true);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.status(r,s));
    }
    @Test void expiredPreparationCannotStartButOriginalHistoryRemainsReadable()throws Exception{
        var f=fixtures().get(0);var p=f.getAsJsonObject("prepared").deepCopy();p.addProperty("recordExpiresAt",1);p.remove("preparationHash");p.addProperty("preparationHash",ContextReceipt.jsonHash(p));assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.verifyPreparation(capture(f),f.getAsJsonObject("saved"),f.getAsJsonObject("generation"),f.getAsJsonObject("manifest"),f.getAsJsonObject("capability"),p));
        // Normal history never applies startup expiry to an existing reference.
        var r=reference(f);r.getAsJsonObject("prepared").addProperty("recordExpiresAt",1);var prepared=r.getAsJsonObject("prepared");prepared.remove("preparationHash");prepared.addProperty("preparationHash",ContextReceipt.jsonHash(prepared));r.add("preparationHash",prepared.get("preparationHash"));r.getAsJsonObject("request").getAsJsonObject("send").add("preparationHash",prepared.get("preparationHash"));r.addProperty("requestHash",ContextReceipt.jsonHash(r.get("request")));
        var h=f.getAsJsonObject("retained").deepCopy();h.add("preparationHash",r.get("preparationHash"));h.add("requestHash",r.get("requestHash"));assertEquals(h,ReferenceWorldAssemblyReceipt.status(r,h));
    }
}
