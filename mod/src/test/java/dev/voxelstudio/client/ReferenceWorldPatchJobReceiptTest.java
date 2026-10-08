package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CancellationException;
import static org.junit.jupiter.api.Assertions.*;

/** Exact production HTTP/source bytes from free synthetic upstream transport.
 * This does not test a real model, player UI, world writes or Ultra design. */
final class ReferenceWorldPatchJobReceiptTest {
    private JsonObject fixture()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-world-patch-client-task.json"))).getAsJsonObject();}
    private SelectionReadService.Capture capture(JsonObject f){return new SelectionReadService.Capture(f.get("contextId").getAsString(),WorldPatchJobReceipt.selection(f.getAsJsonObject("selection")),f.get("contextRevision").getAsLong(),f.get("payload").getAsString(),null,false);}
    private JsonObject reference(JsonObject f){
        var capture=capture(f);var p=ReferenceWorldPatchTaskReceipt.verify(capture,f.getAsJsonObject("saved"),f.getAsJsonObject("intent"),f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("prepared"));
        return ReferenceWorldPatchJobReceipt.reference(capture,p,f.getAsJsonObject("frozen"),ReferenceWorldPatchJobReceipt.capabilitiesRuntime(f.getAsJsonObject("capabilities")));
    }
    private JsonObject state(JsonObject f,String state,long calls){
        var s=f.getAsJsonObject("status").deepCopy();s.addProperty("state",state);s.addProperty("callsReserved",calls);
        s.add("modelSent",calls==0?new JsonPrimitive(false):new JsonPrimitive("possibly-or-confirmed"));
        s.add("responseCheck",JsonNull.INSTANCE);s.add("candidateHash",JsonNull.INSTANCE);s.addProperty("candidatePublished",false);s.addProperty("canObserveOriginal",false);return s;
    }
    @Test void originalVerifiedFreezeAndLiveCapabilitiesProduceExactIndependentJointSend()throws Exception{
        var f=fixture();var r=reference(f);assertEquals(f.get("send"),r.get("send"));assertFalse(r.get("canAuthorizePlacement").getAsBoolean());
        assertEquals(ContextReceipt.jsonHash(f.get("send")),r.get("submissionHash").getAsString());
        assertEquals(f.getAsJsonObject("referenceManifest").get("setHash"),r.get("referenceSetHash"));
        assertEquals(ReferenceWorldPatchTaskReceipt.protocolHash(),r.get("protocolHash").getAsString());
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.reference(capture(f),f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),"f".repeat(64)));
    }
    @Test void statusSelectsNoDownloadPinsAndExactJointCandidateDownloadsVerify()throws Exception{
        var f=fixture();var r=reference(f);var s=f.getAsJsonObject("status");assertSame(s,ReferenceWorldPatchJobReceipt.verify(r,s));
        var pin=ReferenceWorldPatchJobReceipt.candidate(r,s);var candidate=ReferenceWorldPatchCandidateReceipt.parseCandidate(Files.readAllBytes(Path.of("build/test-fixtures/reference-world-patch-candidate-download.json")),pin,()->false);
        assertFalse(candidate.canAuthorizePlacement());assertEquals(r.get("referenceSetHash").getAsString(),candidate.reference().referenceSetHash());assertFalse(ReferenceWorldPatchJobReceipt.polling(s));
    }
    @Test void sourceRecipientRuntimeAndSubmissionCannotBeReboundByStatus()throws Exception{
        var f=fixture();var r=reference(f);for(var k:List.of("id","capsuleId","manifestHash","submissionHash","runtimeHash")){
            var s=f.getAsJsonObject("status").deepCopy();s.addProperty(k,"f".repeat(64));assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s),k);
        }
        var s=f.getAsJsonObject("status").deepCopy();s.getAsJsonObject("recipient").addProperty("model","different");assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s));
        for(var k:List.of("snapshotHash","selectionHash","manifestHash","capsuleId")){var changed=f.getAsJsonObject("status").deepCopy();changed.getAsJsonObject("responseCheck").addProperty(k,"f".repeat(64));assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,changed),k);}
    }
    @Test void pictureRuntimeAndBaselinePinsCannotDifferBetweenReferenceAndRehashedSend()throws Exception{
        var f=fixture();var r=reference(f);for(var k:List.of("capsuleId","manifestHash","snapshotHash","selectionHash","referenceSetHash","runtimeHash","imageCapabilityHash")){
            var changed=r.deepCopy();changed.getAsJsonObject("send").addProperty(k,"f".repeat(64));changed.addProperty("submissionHash",ContextReceipt.jsonHash(changed.get("send")));assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verifyReference(changed),k);
        }
        for(var k:List.of("protocolHash","patchProtocolHash","selectionHash","submissionHash")){var changed=r.deepCopy();changed.addProperty(k,"f".repeat(64));assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verifyReference(changed),k);}
        var changed=r.deepCopy();changed.getAsJsonObject("send").addProperty("maximumCalls",2);changed.addProperty("submissionHash",ContextReceipt.jsonHash(changed.get("send")));assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verifyReference(changed));
    }
    @Test void statusLifecycleDoesNotInventReservationOrRefundUnknownCalls()throws Exception{
        var f=fixture();var r=reference(f);
        for(var name:List.of("reserved-not-dispatched","running"))assertDoesNotThrow(()->ReferenceWorldPatchJobReceipt.verify(r,state(f,name,0)));
        for(var name:List.of("running","checking","response-retained","unknown","failed","completed-rejected"))assertDoesNotThrow(()->ReferenceWorldPatchJobReceipt.verify(r,state(f,name,1)));
        for(var name:List.of("checking","response-retained","unknown","failed","completed-rejected"))assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,state(f,name,0)));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,state(f,"reserved-not-dispatched",1)));
        var s=state(f,"unknown",1);s.addProperty("modelSent",false);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s));
        s.addProperty("modelSent","possibly-or-confirmed");s.addProperty("canObserveOriginal",true);assertDoesNotThrow(()->ReferenceWorldPatchJobReceipt.verify(r,s));
        s.addProperty("state","failed");assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.candidate(r,state(f,"response-retained",1)));
    }
    @Test void localStopIsNotProviderTerminalProofOrResendAuthority()throws Exception{
        var f=fixture();var r=reference(f);var s=state(f,"unknown",1);var stop=new JsonObject();stop.addProperty("phase","provider-dispatch");stop.addProperty("reason","original-outcome-retained-no-resubmission");stop.addProperty("isProviderTerminalReceipt",false);s.add("localStop",stop);
        assertDoesNotThrow(()->ReferenceWorldPatchJobReceipt.verify(r,s));stop.addProperty("isProviderTerminalReceipt",true);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s));
        stop.addProperty("isProviderTerminalReceipt",false);stop.addProperty("reason","retry-now");assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s));
    }
    @Test void capabilitiesRequireImageAgentIndependentJointConsentAndNoWorldClaims()throws Exception{
        var f=fixture();var v=f.getAsJsonObject("capabilities");assertEquals(f.getAsJsonObject("frozen").get("runtimeHash").getAsString(),ReferenceWorldPatchJobReceipt.capabilitiesRuntime(v));
        var disabled=v.deepCopy();disabled.addProperty("preparationEnabled",false);disabled.addProperty("sendingEnabled",false);disabled.add("runtimeHash",JsonNull.INSTANCE);assertNull(ReferenceWorldPatchJobReceipt.capabilitiesRuntime(disabled));
        for(var k:List.of("legacyConsentTransferable","playerUiImplemented","placementImplemented","serverBaselineVerified","canAuthorizePlacement")){var bad=v.deepCopy();bad.addProperty(k,true);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.capabilitiesRuntime(bad),k);}
        for(var k:List.of("version","maximumCalls","automaticRetries","previewDownloadVersion")){var bad=v.deepCopy();bad.addProperty(k,9);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.capabilitiesRuntime(bad),k);}
        var missingRuntime=v.deepCopy();missingRuntime.add("runtimeHash",JsonNull.INSTANCE);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.capabilitiesRuntime(missingRuntime));
        var missingPreparation=v.deepCopy();missingPreparation.addProperty("preparationEnabled",false);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.capabilitiesRuntime(missingPreparation));
    }
    @Test void statusCannotClaimCurrentWorldOrAdditionalCallsAndRejectsWrongPrimitives()throws Exception{
        var f=fixture();var r=reference(f);for(var k:List.of("candidateCurrentFilesReverified","serverBaselineVerified","canAuthorizePlacement")){var s=f.getAsJsonObject("status").deepCopy();s.addProperty(k,true);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s),k);}
        for(var k:List.of("version","maximumCalls","automaticRetries","callsReserved","worldWrites")){var s=f.getAsJsonObject("status").deepCopy();s.addProperty(k,9);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,s),k);}
        var wrongPrimitive=f.getAsJsonObject("status").deepCopy();wrongPrimitive.addProperty("callsReserved","1");assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,wrongPrimitive));
        for(var k:List.of("serverBaselineVerified","canAuthorizePlacement")){var bad=f.getAsJsonObject("status").deepCopy();bad.getAsJsonObject("responseCheck").addProperty(k,true);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,bad));}
        var rejected=f.getAsJsonObject("status").deepCopy();rejected.addProperty("state","completed-rejected");assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(r,rejected));
    }
    @Test void retainedCaptureDoesNotAdoptDifferentWorldOrRevisionAndCannotGrantPlacement()throws Exception{
        var f=fixture();var r=reference(f);var capture=capture(f);var binding=ReferenceWorldPatchJobReceipt.retentionBinding(capture,r);assertFalse(binding.canAuthorizePlacement());assertEquals(ReferenceWorldPatchTaskReceipt.protocolHash(),binding.protocolHash());assertEquals(capture.id(),binding.contextId());
        r.addProperty("contextRevision",capture.contextRevision()+1);assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.retentionBinding(capture,r));
    }
    @Test void malformedStatusUtf8DuplicatesQuotaAndCancellationFailClosed()throws Exception{
        var f=fixture();var r=reference(f);String text=f.get("status").toString();byte[] raw=text.getBytes(StandardCharsets.UTF_8);
        assertEquals(f.get("status"),ReferenceWorldPatchJobReceipt.parseStatus(raw,r,()->false));
        for(var bad:List.of(new byte[0],new byte[]{(byte)255},new byte[ReferenceWorldPatchJobReceipt.MAX_STATUS_BYTES+1],("{\"version\":1,"+text.substring(1)).getBytes(StandardCharsets.UTF_8)))assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.parseStatus(bad,r,()->false));
        assertThrows(CancellationException.class,()->ReferenceWorldPatchJobReceipt.parseStatus(raw,r,()->true));
    }
    @Test void defensiveJointSubmissionAndLegacyFormatsNeverCrossProtocols()throws Exception{
        var f=fixture();var r=reference(f);var s=f.getAsJsonObject("status").deepCopy();var submission=new ReferenceWorldPatchSubmission(r,s);r.addProperty("canAuthorizePlacement",true);s.addProperty("canAuthorizePlacement",true);assertFalse(submission.reference().get("canAuthorizePlacement").getAsBoolean());assertFalse(submission.status().get("canAuthorizePlacement").getAsBoolean());
        var copy=submission.reference();copy.addProperty("referenceSetHash","f".repeat(64));assertNotEquals(copy,submission.reference());
        assertThrows(RuntimeException.class,()->WorldPatchJobReceipt.verifyReference(submission.reference()));
        var legacy=f.getAsJsonObject("status").deepCopy();legacy.addProperty("format","FrozenWorldPatchJobStatus");assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.verify(submission.reference(),legacy));
    }
}
