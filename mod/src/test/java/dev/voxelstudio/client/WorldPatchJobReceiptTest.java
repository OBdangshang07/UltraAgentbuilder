package dev.voxelstudio.client;
import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
final class WorldPatchJobReceiptTest {
    @Test void productionCapabilityFromActualNodeBuilderRequiresIndependentSendAndWorldConfirmation()throws Exception{
        var f=fixture();var capability=f.getAsJsonObject("sendingCapabilities");
        assertEquals(f.get("runtimeHash").getAsString(),WorldPatchJobReceipt.sendingCapabilitiesRuntime(capability));
        assertNull(WorldPatchJobReceipt.sendingCapabilitiesRuntime(f.getAsJsonObject("disabledSendingCapabilities")));
        for(var key:List.of("placementImplemented","serverBaselineVerified","canAuthorizePlacement","summaryConsentTransferable")){
            var forged=capability.deepCopy();forged.addProperty(key,true);assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.sendingCapabilitiesRuntime(forged));
        }
        for(var key:List.of("version","jobApiVersion","sendRequestVersion","jobStatusVersion","previewDownloadVersion","candidateDownloadVersion","maximumCalls","automaticRetries")){
            var forged=capability.deepCopy();forged.addProperty(key,9);assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.sendingCapabilitiesRuntime(forged));
        }
        for(var key:List.of("sendAuthorization","worldWriteAuthorization","sourceAuthority")){
            var forged=capability.deepCopy();forged.addProperty(key,"automatic");assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.sendingCapabilitiesRuntime(forged));
        }
        var extra=capability.deepCopy();extra.addProperty("allowWorldWrites",true);assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.sendingCapabilitiesRuntime(extra));
        assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.capabilitiesRuntime(capability));
    }
    @Test void legacyCapabilityKeepsStrictReadOnlyBoundaryAndCannotClaimProductionSend()throws Exception{
        var legacy=fixture().getAsJsonObject("sendingCapabilities").deepCopy();
        for(var key:List.of("sendingEnabled","jobApiVersion","sendRequestVersion","candidateDownloadVersion","sendAuthorization","worldWriteAuthorization"))legacy.remove(key);
        legacy.addProperty("version",1);legacy.addProperty("sendingImplemented",false);legacy.addProperty("experimentalSendingImplemented",true);legacy.addProperty("experimentalSendingEnabled",true);
        assertEquals(legacy.get("runtimeHash").getAsString(),WorldPatchJobReceipt.capabilitiesRuntime(legacy));
        assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.sendingCapabilitiesRuntime(legacy));
        legacy.addProperty("sendingImplemented",true);assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.capabilitiesRuntime(legacy));
    }
    @Test void retainedSendPinsComeFromOriginalReferenceAndCannotAlterCapture()throws Exception{var f=fixture();var original=ContextTaskReceiptTest.capture(f);var r=reference(f);var binding=WorldPatchJobReceipt.retentionBinding(original,r);assertEquals(original.id(),binding.contextId());assertEquals(original.contextRevision(),binding.contextRevision());assertEquals(r.get("runtimeHash").getAsString(),binding.runtimeHash());assertEquals(r.get("submissionHash").getAsString(),binding.submissionHash());assertFalse(binding.canAuthorizePlacement());r.addProperty("contextRevision",original.contextRevision()+1);assertThrows(IllegalStateException.class,()->WorldPatchJobReceipt.retentionBinding(original,r));}
    @Test void submissionKeepsIndependentlyCheckedOriginalReferenceAndDefensiveCopies()throws Exception{var f=fixture();var r=reference(f);var status=f.getAsJsonObject("status").deepCopy();var submission=new WorldPatchSubmission(r,status);r.addProperty("snapshotHash","f".repeat(64));status.addProperty("canAuthorizePlacement",true);assertFalse(submission.status().get("canAuthorizePlacement").getAsBoolean());assertNotEquals(r,submission.reference());var copy=submission.reference();copy.addProperty("canAuthorizePlacement",true);assertFalse(submission.reference().get("canAuthorizePlacement").getAsBoolean());}
    @Test void resultDetailsAreBoundedOriginalFactsNotCurrentWorldCertification()throws Exception{var f=fixture();var r=reference(f);var status=f.getAsJsonObject("status");String details=WorldPatchJobReceipt.details(r,status);assertTrue(details.contains("ServerWorld BEFORE 未验证"));assertTrue(details.contains("自动重试 0"));assertFalse(WorldPatchJobReceipt.polling(status));assertTrue(details.length()<4096);}
    private JsonObject fixture()throws Exception{return WorldPatchTaskReceiptTest.fixture();}
    private JsonObject reference(JsonObject f){return WorldPatchJobReceipt.reference(ContextTaskReceiptTest.capture(f),f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),f.get("runtimeHash").getAsString());}
    @Test void originalTaskStatusCreatesIndependentPreviewReferenceWithoutReadingDownloadPins()throws Exception{var f=fixture();var r=reference(f);assertSame(f.get("status"),WorldPatchJobReceipt.verify(r,f.getAsJsonObject("status")));var pin=WorldPatchJobReceipt.candidate(r,f.getAsJsonObject("status"));var bytes=Files.readAllBytes(Path.of("build/test-fixtures/world-patch-preview-download.json"));var preview=WorldPatchCandidateReceipt.parse(bytes,pin,()->false);assertFalse(preview.canAuthorizePlacement());assertEquals(1,preview.preview().totalWrites());}
    @Test void pinsRecipientAndSelfRehashedSendCannotSubstituteOriginalJobStatus()throws Exception{var f=fixture();var r=reference(f);for(var key:List.of("id","capsuleId","manifestHash","runtimeHash","submissionHash")){var v=f.getAsJsonObject("status").deepCopy();v.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verify(r,v));}var v=f.getAsJsonObject("status").deepCopy();v.getAsJsonObject("recipient").addProperty("model","other");assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verify(r,v));}
    @Test void currentWorldClaimsOrCandidatePinsOnRejectedStatusAreRefused()throws Exception{var f=fixture();var r=reference(f);for(var key:List.of("candidateCurrentFilesReverified","serverBaselineVerified","canAuthorizePlacement")){var v=f.getAsJsonObject("status").deepCopy();v.addProperty(key,true);assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verify(r,v));}for(var key:List.of("snapshotHash","selectionHash","manifestHash")){var v=f.getAsJsonObject("status").deepCopy();v.getAsJsonObject("responseCheck").addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verify(r,v));}var v=f.getAsJsonObject("status").deepCopy();v.addProperty("state","completed-rejected");assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verify(r,v));}
    @Test void referenceCannotForgeDifferentSelectionOrProtocolOrLargerSendBudget()throws Exception{var f=fixture();var r=reference(f);for(var key:List.of("protocolHash","selectionHash","submissionHash")){var v=r.deepCopy();v.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verifyReference(v));}var v=r.deepCopy();v.getAsJsonObject("send").addProperty("maximumCalls",2);v.addProperty("submissionHash",ContextReceipt.jsonHash(v.get("send")));assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verifyReference(v));}
}
