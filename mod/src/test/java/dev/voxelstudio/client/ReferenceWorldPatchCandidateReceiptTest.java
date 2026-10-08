package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.Modifier;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** Actual production joint HTTP/worker bytes from a FREE synthetic adapter,
 * not a Java-invented download or unverified pins copied from that download. */
final class ReferenceWorldPatchCandidateReceiptTest {
    private byte[] bytes(boolean candidate)throws Exception{return Files.readAllBytes(Path.of("build/test-fixtures/reference-world-patch-"+(candidate?"candidate":"preview")+"-download.json"));}
    private JsonObject value(boolean candidate)throws Exception{return JsonParser.parseString(new String(bytes(candidate),StandardCharsets.UTF_8)).getAsJsonObject();}
    private ReferenceWorldPatchCandidateReceipt.Reference reference()throws Exception{
        var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-world-patch-client-reference.json"))).getAsJsonObject();
        assertEquals(1,f.get("fixtureAdapterCalls").getAsInt());assertEquals(0,f.get("realModelCalls").getAsInt());assertEquals(0,f.get("worldWrites").getAsInt());
        var v=f.getAsJsonObject("reference");var selection=WorldPatchJobReceipt.selection(v.getAsJsonObject("selection"));
        var binding=new WorldPatchPreview.Binding(selection,v.get("contextRevision").getAsLong(),v.get("snapshotHash").getAsString(),v.get("selectionHash").getAsString(),v.get("patchHash").getAsString(),v.get("previewHash").getAsString());
        return new ReferenceWorldPatchCandidateReceipt.Reference(v.get("capsuleId").getAsString(),v.get("manifestHash").getAsString(),v.get("submissionHash").getAsString(),v.get("runtimeHash").getAsString(),
            v.get("responseHash").getAsString(),v.get("candidateHash").getAsString(),v.get("referenceSetHash").getAsString(),v.get("imageCapabilityHash").getAsString(),binding);
    }
    private byte[] encode(JsonObject v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private void rehash(JsonObject v){v.remove("downloadHash");v.addProperty("downloadHash",ContextReceipt.jsonHash(v));}
    private void reject(boolean candidate,Consumer<JsonObject> change)throws Exception{
        var v=value(candidate);change.accept(v);rehash(v);var expected=reference();
        if(candidate)assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parseCandidate(encode(v),expected,()->false));
        else assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parse(encode(v),expected,()->false));
    }
    @Test void exactJointPreviewRemainsAtOriginalNegativeWorldCoordinatesWithoutWriteAuthority()throws Exception{
        var expected=reference();var result=ReferenceWorldPatchCandidateReceipt.parse(bytes(false),expected,()->false);
        assertEquals(expected,result.reference());assertEquals(1,result.preview().totalWrites());
        var row=result.preview().at(new SelectionRegion.Point(0,-60,0));assertEquals("minecraft:stone",row.before());assertEquals("minecraft:glass",row.after());
        assertFalse(result.canAuthorizePlacement());assertFalse(result.currentWorldVerified());assertFalse(result.preview().movable());assertFalse(result.preview().canAuthorizePlacement());
    }
    @Test void immutableOriginalJointResponseCanReachCommonAuditDataButCannotGrantWorldAuthority()throws Exception{
        var expected=reference();var raw=bytes(true);var result=ReferenceWorldPatchCandidateReceipt.parseCandidate(raw,expected,()->false);Arrays.fill(raw,(byte)0);
        byte[] original=result.originalResponse(),saved=original.clone();Arrays.fill(original,(byte)0);
        assertArrayEquals(saved,result.originalResponse());assertEquals(expected,result.reference());assertEquals(expected.responseHash(),result.originalResponseHash());
        WorldPatchCheckedCandidate checked=result;assertEquals(expected.responseHash(),checked.originalResponseHash());assertFalse(checked.canAuthorizePlacement());
        assertEquals(expected.responseHash(),ContextReceipt.jsonHash(JsonParser.parseString(new String(saved,StandardCharsets.UTF_8))));
    }
    @Test void allIndependentSourceRuntimeResponsePixelAndCapabilityPinsRejectRehashing()throws Exception{
        for(boolean candidate:List.of(false,true))for(var key:List.of("capsuleId","manifestHash","submissionHash","runtimeHash","responseHash","candidateHash","referenceSetHash","imageCapabilityHash","snapshotHash","selectionHash","patchHash","previewHash"))
            reject(candidate,v->v.addProperty(key,"f".repeat(64)));
    }
    @Test void originalWorldDimensionSelectionAndContextRevisionCannotBeRebound()throws Exception{
        for(boolean candidate:List.of(false,true)){
            for(var key:List.of("worldId","dimension"))reject(candidate,v->v.getAsJsonObject("selection").getAsJsonObject("world").addProperty(key,"changed"));
            reject(candidate,v->v.addProperty("contextRevision",5));reject(candidate,v->v.getAsJsonObject("selection").addProperty("revision",99));
            reject(candidate,v->v.getAsJsonObject("selection").getAsJsonObject("edit").getAsJsonArray("max").set(0,new JsonPrimitive(3)));
        }
    }
    @Test void archiveDownloadCannotClaimCurrentServerPlacementOrAdditionalCalls()throws Exception{
        for(boolean candidate:List.of(false,true)){
            for(var key:List.of("archivedSourceOnly","originalResponseReverified","candidateFilesReverified"))reject(candidate,v->v.addProperty(key,false));
            for(var key:List.of("serverBaselineVerified","canAuthorizePlacement"))reject(candidate,v->v.addProperty(key,true));
            for(var key:List.of("additionalModelCalls","worldWrites"))reject(candidate,v->v.addProperty(key,1));
        }
    }
    @Test void originalProposalCannotBeReplacedEvenWithNewDownloadAndResponseHashes()throws Exception{
        reject(true,v->v.getAsJsonObject("proposal").getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("after","minecraft:dirt"));
        reject(true,v->{v.getAsJsonObject("proposal").getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("after","minecraft:dirt");v.addProperty("responseHash",ContextReceipt.jsonHash(v.get("proposal")));});
        reject(true,v->v.remove("proposal"));reject(true,v->v.addProperty("proposal","{}"));
    }
    @Test void nestedPreviewAndOuterDownloadAreBothChecked()throws Exception{
        reject(false,v->v.getAsJsonObject("preview").getAsJsonArray("palette").set(0,new JsonPrimitive("minecraft:dirt")));
        reject(true,v->{var p=v.getAsJsonObject("preview");p.addProperty("canAuthorizePlacement",true);p.remove("previewHash");p.addProperty("previewHash",ContextReceipt.jsonHash(p));});
        var v=value(true);v.addProperty("downloadHash","0".repeat(64));var expected=reference();assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parseCandidate(encode(v),expected,()->false));
    }
    @Test void jointTextPreviewAndFullCandidateProtocolsAreNotInterchangeable()throws Exception{
        var joint=reference();var legacy=new WorldPatchCandidateReceipt.Reference(joint.capsuleId(),joint.manifestHash(),joint.submissionHash(),joint.runtimeHash(),joint.responseHash(),joint.candidateHash(),joint.binding());
        assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(bytes(false),legacy,()->false));
        assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parseCandidate(bytes(true),legacy,()->false));
        var legacyBytes=Files.readAllBytes(Path.of("build/test-fixtures/world-patch-preview-download.json"));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parse(legacyBytes,joint,()->false));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parseCandidate(bytes(false),joint,()->false));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parse(bytes(true),joint,()->false));
        reject(false,v->v.addProperty("format","FrozenWorldPatchPreviewDownload"));reject(true,v->v.addProperty("format","FrozenWorldPatchCandidateDownload"));
    }
    @Test void exactPurposeFieldsVersionAndPrimitiveTypesAreRequired()throws Exception{
        for(boolean candidate:List.of(false,true)){
            reject(candidate,v->v.addProperty("purpose","world-patch-design"));reject(candidate,v->v.addProperty("version",2));
            reject(candidate,v->v.addProperty("version",1.5));reject(candidate,v->v.addProperty("worldWrites","0"));
            reject(candidate,v->v.addProperty("canAuthorizePlacement","false"));reject(candidate,v->v.addProperty("command","/fill"));
        }
    }
    @Test void invalidUtf8TruncationDuplicateFieldsCommentsAndDeepNestingPublishNothing()throws Exception{
        var expected=reference();String text=new String(bytes(true),StandardCharsets.UTF_8);
        for(var bad:List.of("{\"version\":99,"+text.substring(1),text+" {}","/* comment */"+text,text.substring(0,40),"[".repeat(40)+"0"+"]".repeat(40)))
            assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parseCandidate(bad.getBytes(StandardCharsets.UTF_8),expected,()->false));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parse(new byte[]{(byte)0xff},expected,()->false));
    }
    @Test void byteQuotaAndCancellationNeverBecomePartialDownloadsOrFallbackAuthority()throws Exception{
        var expected=reference();assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parse(new byte[ReferenceWorldPatchCandidateReceipt.MAX_BYTES+1],expected,()->false));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchCandidateReceipt.parseCandidate(new byte[ReferenceWorldPatchCandidateReceipt.MAX_CANDIDATE_BYTES+1],expected,()->false));
        assertThrows(CancellationException.class,()->ReferenceWorldPatchCandidateReceipt.parseCandidate(bytes(true),expected,()->true));
        try{Thread.currentThread().interrupt();assertThrows(CancellationException.class,()->ReferenceWorldPatchCandidateReceipt.parse(bytes(false),expected,()->false));}finally{Thread.interrupted();}
    }
    @Test void commonCandidatePathIsSealedAndBothDownloadConstructorsArePrivate(){
        assertTrue(WorldPatchCheckedCandidate.class.isSealed());assertEquals(Set.of(WorldPatchCandidateReceipt.AuditableDownload.class,ReferenceWorldPatchCandidateReceipt.AuditableDownload.class),Set.of(WorldPatchCheckedCandidate.class.getPermittedSubclasses()));
        for(var type:WorldPatchCheckedCandidate.class.getPermittedSubclasses())for(var constructor:type.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
    }
}
