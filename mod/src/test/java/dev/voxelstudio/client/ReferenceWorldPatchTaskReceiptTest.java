package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** Production Node joint source/HTTP fixtures, exclusively synthetic. These
 * tests must actually execute before claiming Java or player acceptance. */
final class ReferenceWorldPatchTaskReceiptTest {
    private static JsonObject fixture()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-world-patch-client-task.json"))).getAsJsonObject();}
    private static SelectionReadService.Capture capture(JsonObject f){return new SelectionReadService.Capture(f.get("contextId").getAsString(),WorldPatchJobReceipt.selection(f.getAsJsonObject("selection")),f.get("contextRevision").getAsLong(),f.get("payload").getAsString(),null,false);}
    private static JsonObject verify(JsonObject f,JsonObject p){return ReferenceWorldPatchTaskReceipt.verify(capture(f),f.getAsJsonObject("saved"),f.getAsJsonObject("intent"),f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),p);}
    private static void rehash(JsonObject v,String field){v.remove(field);v.addProperty(field,ContextReceipt.jsonHash(v));}
    private static void rehashAll(JsonObject p){var t=p.getAsJsonObject("task");t.addProperty("requestHash",ContextReceipt.jsonHash(t.get("request")));var d=t.getAsJsonObject("disclosure");d.add("requestHash",t.get("requestHash"));rehash(d,"disclosureHash");rehash(t,"taskHash");p.add("taskHash",t.get("taskHash"));rehash(p,"taskDisclosureHash");}
    private static void rejected(Consumer<JsonObject> change)throws Exception{var f=fixture();var p=f.getAsJsonObject("prepared").deepCopy();change.accept(p);rehashAll(p);assertThrows(RuntimeException.class,()->verify(f,p));}
    @Test void originalJointPreparationConfirmationAndFrozenReceiptMatchIndependentSources()throws Exception{
        var f=fixture();assertEquals(1,f.get("fixtureAdapterCalls").getAsInt());assertEquals(0,f.get("realModelCalls").getAsInt());assertEquals(0,f.get("worldWrites").getAsInt());
        var p=verify(f,f.getAsJsonObject("prepared"));assertEquals(f.get("prepared"),p);
        assertEquals(f.get("confirmation"),ReferenceWorldPatchTaskReceipt.confirmation(p));
        assertEquals(f.get("frozen"),ReferenceWorldPatchTaskReceipt.verifyFrozen(p,f.getAsJsonObject("confirmation"),f.getAsJsonObject("frozen")));
        assertEquals(f.getAsJsonObject("baseDisclosure").get("taskHash"),p.getAsJsonObject("task").getAsJsonObject("request").get("baseTaskHash"));
        for(var key:List.of("modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement"))assertFalse(p.get(key).getAsBoolean());
    }
    @Test void newJointIntentRetainsExactPromptButRejectsLegacyOrExpandedAuthority()throws Exception{
        var f=fixture();var i=f.getAsJsonObject("intent");assertEquals(i,ReferenceWorldPatchTaskReceipt.intent(i.get("model").getAsString(),i.get("effort").getAsString(),i.get("prompt").getAsString(),i.get("referenceOwnerId").getAsString(),i.get("referenceSetHash").getAsString()));
        for(var key:List.of("format","purpose","agent","model","effort","prompt","referenceOwnerId","referenceSetHash")){var changed=i.deepCopy();changed.addProperty(key,"changed");assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verify(capture(f),f.getAsJsonObject("saved"),changed,f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("prepared")));}
        var changed=i.deepCopy();changed.addProperty("maximumCalls",2);assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verify(capture(f),f.getAsJsonObject("saved"),changed,f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("prepared")));
    }
    @Test void rehashedPreparedDataCannotReplaceWorldPicturesRecipientRuntimeOrBaseTranscript()throws Exception{
        for(var key:List.of("referenceSetHash","referenceOwnerId","runtimeHash","imageCapabilityHash","baseTaskHash","patchProtocolHash","protocolHash","snapshotHash","selectionHash"))rejected(p->p.getAsJsonObject("task").getAsJsonObject("request").addProperty(key,"f".repeat(64)));
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("request").addProperty("contextRevision",10));
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonArray("references").remove(0));
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonObject("imageCapability").addProperty("supportsImages",false));
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonArray("excludedData").remove(0));
    }
    @Test void referenceTextCannotAlterJointRulesOrActualPromptBytesAfterRehash()throws Exception{
        rejected(p->{var t=p.getAsJsonObject("task");var d=t.getAsJsonObject("disclosure");String prompt=d.get("modelPrompt").getAsString().replace("not a new movable building","a new movable building");d.addProperty("modelPrompt",prompt);d.addProperty("modelPromptUtf8Bytes",prompt.getBytes(StandardCharsets.UTF_8).length);String h=ContextReceipt.sha256(prompt.getBytes(StandardCharsets.UTF_8));d.addProperty("promptSha256",h);t.getAsJsonObject("request").addProperty("promptSha256",h);});
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").addProperty("modelPromptUtf8Bytes",1));
    }
    @Test void preparationCannotClaimCallsCapabilityCertificationConsentTransferOrCurrentWorldRights()throws Exception{
        for(var key:List.of("summaryConsentTransferable","referenceConsentTransferable","modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement"))rejected(p->p.addProperty(key,true));
        for(var key:List.of("referenceConsentTransferable","providerCapabilityIndependentlyVerified"))rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").addProperty(key,true));
        rejected(p->p.addProperty("command","setblock"));
    }
    @Test void strictByteParserRejectsMalformedUtf8DuplicateFieldsQuotaAndCancellation()throws Exception{
        var f=fixture();var capture=capture(f);var saved=f.getAsJsonObject("saved");var intent=f.getAsJsonObject("intent");var manifest=f.getAsJsonObject("referenceManifest");var capability=f.getAsJsonObject("capability");var p=f.getAsJsonObject("prepared");
        var bytes=p.toString().getBytes(StandardCharsets.UTF_8);assertEquals(p,ReferenceWorldPatchTaskReceipt.parse(bytes,capture,saved,intent,manifest,capability,()->false));
        for(var bad:List.of(new byte[0],new byte[]{(byte)255},new byte[ReferenceWorldPatchTaskReceipt.MAX_BYTES+1],("{\"version\":1,"+p.toString().substring(1)).getBytes(StandardCharsets.UTF_8)))assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.parse(bad,capture,saved,intent,manifest,capability,()->false));
        assertThrows(CancellationException.class,()->ReferenceWorldPatchTaskReceipt.parse(bytes,capture,saved,intent,manifest,capability,()->true));
    }
    @Test void freezeRequiresIndependentJointConsentAndRejectsEveryChangedSourcePin()throws Exception{
        var f=fixture();var p=verify(f,f.getAsJsonObject("prepared"));var c=f.getAsJsonObject("confirmation");var receipt=f.getAsJsonObject("frozen");
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verifyFrozen(p,WorldPatchTaskReceipt.confirmation(f.getAsJsonObject("baseDisclosure")),receipt));
        for(var key:List.of("capsuleId","taskHash","taskDisclosureHash","snapshotHash","selectionHash","summaryHash","recordHash","payloadSha256","requestHash","promptSha256","confirmationHash","reviewHash","referenceOwnerId","referenceSetHash","runtimeHash","imageCapabilityHash")){var v=receipt.deepCopy();v.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verifyFrozen(p,c,v),key);}
        // The public receipt omits the private inventory/owner, so its opaque
        // manifest digest is initially format-checked, not self-authenticated.
        // Subsequent audit/downloads must compare the independently retained pin.
        var malformed=receipt.deepCopy();malformed.addProperty("manifestHash","not-a-digest");assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verifyFrozen(p,c,malformed));
        for(var key:List.of("maximumCalls","imageCount","recordExpiresAt","frozenAt","bytes")){var v=receipt.deepCopy();v.addProperty(key,0);assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verifyFrozen(p,c,v),key);}
    }
    @Test void jointPreparationAndFreezeNeverBecomeLegacyTextProtocolEvidence()throws Exception{
        var f=fixture();var p=f.getAsJsonObject("prepared");var i=f.getAsJsonObject("intent");var baseIntent=WorldPatchTaskReceipt.intent("codex",i.get("model").getAsString(),i.get("effort").getAsString(),i.get("prompt").getAsString());
        assertThrows(RuntimeException.class,()->WorldPatchTaskReceipt.verify(capture(f),f.getAsJsonObject("saved"),baseIntent,p));
        assertThrows(RuntimeException.class,()->WorldPatchTaskReceipt.verifyFrozen(f.getAsJsonObject("baseDisclosure"),WorldPatchTaskReceipt.confirmation(f.getAsJsonObject("baseDisclosure")),f.getAsJsonObject("frozen")));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.verify(capture(f),f.getAsJsonObject("saved"),i,f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("baseDisclosure")));
    }
}
