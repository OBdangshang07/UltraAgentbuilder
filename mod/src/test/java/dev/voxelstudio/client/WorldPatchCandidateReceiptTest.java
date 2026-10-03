package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** Real FREE production Node worker download, not a fabricated Java receipt. */
final class WorldPatchCandidateReceiptTest {
    private byte[] bytes()throws Exception{return Files.readAllBytes(Path.of("build/test-fixtures/world-patch-preview-download.json"));}
    private JsonObject value()throws Exception{return JsonParser.parseString(new String(bytes(),StandardCharsets.UTF_8)).getAsJsonObject();}
    private SelectionRegion region(JsonObject v){var a=v.getAsJsonArray("min");var b=v.getAsJsonArray("max");return new SelectionRegion(new SelectionRegion.Point(a.get(0).getAsInt(),a.get(1).getAsInt(),a.get(2).getAsInt()),new SelectionRegion.Point(b.get(0).getAsInt(),b.get(1).getAsInt(),b.get(2).getAsInt()));}
    private WorldPatchCandidateReceipt.Reference reference()throws Exception{
        var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/world-patch-preview-reference.json"))).getAsJsonObject();
        assertEquals(1,f.get("fixtureAdapterCalls").getAsInt());assertEquals(0,f.get("realModelCalls").getAsInt());assertEquals(0,f.get("worldWrites").getAsInt());
        var v=f.getAsJsonObject("reference");var s=v.getAsJsonObject("selection");var w=s.getAsJsonObject("world");
        var protectedRegions=new ArrayList<SelectionRegion>();for(var item:s.getAsJsonArray("protected"))protectedRegions.add(region(item.getAsJsonObject()));
        var selection=new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),protectedRegions);
        var binding=new WorldPatchPreview.Binding(selection,v.get("contextRevision").getAsLong(),v.get("snapshotHash").getAsString(),v.get("selectionHash").getAsString(),v.get("patchHash").getAsString(),v.get("previewHash").getAsString());
        return new WorldPatchCandidateReceipt.Reference(v.get("capsuleId").getAsString(),v.get("manifestHash").getAsString(),v.get("submissionHash").getAsString(),v.get("runtimeHash").getAsString(),v.get("responseHash").getAsString(),v.get("candidateHash").getAsString(),binding);
    }
    private byte[] encode(JsonObject v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private void rehash(JsonObject v){v.remove("downloadHash");v.addProperty("downloadHash",ContextReceipt.jsonHash(v));}
    private void reject(Consumer<JsonObject> change,boolean rehash)throws Exception{var v=value();change.accept(v);if(rehash)rehash(v);var ref=reference();assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(encode(v),ref,()->false));}
    @Test void readsProductionCandidateAtOriginalWorldPositionWithoutPlacementAuthority()throws Exception{
        var ref=reference();var result=WorldPatchCandidateReceipt.parse(bytes(),ref,()->false);assertEquals(ref,result.reference());assertEquals(1,result.preview().totalWrites());
        var row=result.preview().at(new SelectionRegion.Point(0,0,0));assertEquals("minecraft:stone",row.before());assertEquals("minecraft:glass",row.after());
        assertFalse(result.canAuthorizePlacement());assertFalse(result.currentWorldVerified());assertFalse(result.preview().movable());assertFalse(result.preview().canAuthorizePlacement());
    }
    @Test void allIndependentPinsCannotBeChangedEvenWithRehashedDownload()throws Exception{for(var key:List.of("capsuleId","manifestHash","submissionHash","runtimeHash","responseHash","candidateHash","snapshotHash","selectionHash","patchHash","previewHash"))reject(v->v.addProperty(key,"f".repeat(64)),true);}
    @Test void cannotRebaseWorldDimensionSelectionOrContextRevision()throws Exception{
        for(var key:List.of("worldId","dimension"))reject(v->v.getAsJsonObject("selection").getAsJsonObject("world").addProperty(key,"changed"),true);
        reject(v->v.addProperty("contextRevision",10),true);reject(v->v.getAsJsonObject("selection").addProperty("revision",4),true);
        reject(v->{var max=v.getAsJsonObject("selection").getAsJsonObject("edit").getAsJsonArray("max");max.set(0,new JsonPrimitive(max.get(0).getAsInt()+1));},true);
    }
    @Test void archivedReceiptCannotClaimFreshWorldOrWritePermission()throws Exception{
        for(var key:List.of("archivedSourceOnly","originalResponseReverified","candidateFilesReverified"))reject(v->v.addProperty(key,false),true);
        for(var key:List.of("serverBaselineVerified","canAuthorizePlacement"))reject(v->v.addProperty(key,true),true);
        for(var key:List.of("additionalModelCalls","worldWrites"))reject(v->v.addProperty(key,1),true);
    }
    @Test void downloadAndNestedPreviewHashesAreBothVerified()throws Exception{
        reject(v->v.addProperty("downloadHash","0".repeat(64)),false);
        reject(v->v.getAsJsonObject("preview").getAsJsonArray("palette").set(0,new JsonPrimitive("minecraft:dirt")),false);
        reject(v->v.getAsJsonObject("preview").getAsJsonArray("palette").set(0,new JsonPrimitive("minecraft:dirt")),true);
        reject(v->{var p=v.getAsJsonObject("preview");p.addProperty("canAuthorizePlacement",true);p.remove("previewHash");p.addProperty("previewHash",ContextReceipt.jsonHash(p));},true);
    }
    @Test void exactFieldsTypesAndVersionAreRequired()throws Exception{
        reject(v->v.addProperty("command","/fill"),true);reject(v->v.remove("preview"),true);reject(v->v.addProperty("version",2),true);
        reject(v->v.addProperty("version",1.5),true);reject(v->v.addProperty("worldWrites","0"),true);reject(v->v.addProperty("canAuthorizePlacement","false"),true);
    }
    @Test void malformedUtf8OversizeCancellationAndTruncationProduceNoPartialPreview()throws Exception{
        var ref=reference();assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(new byte[]{(byte)0xc3,(byte)0x28},ref,()->false));
        assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(new byte[WorldPatchCandidateReceipt.MAX_BYTES+1],ref,()->false));
        assertThrows(CancellationException.class,()->WorldPatchCandidateReceipt.parse(bytes(),ref,()->true));
        assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(Arrays.copyOf(bytes(),20),ref,()->false));
        try{Thread.currentThread().interrupt();assertThrows(CancellationException.class,()->WorldPatchCandidateReceipt.parse(bytes(),ref,()->false));}finally{Thread.interrupted();}
    }
    @Test void duplicateKeysCommentsTrailingDataAndDeepNestingAreRejected()throws Exception{
        var ref=reference();String text=new String(bytes(),StandardCharsets.UTF_8);
        for(var invalid:List.of("{\"version\":99,"+text.substring(1),text+" {}","/* comment */"+text,"[".repeat(40)+"0"+"]".repeat(40)))
            assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(invalid.getBytes(StandardCharsets.UTF_8),ref,()->false));
    }
    private byte[] candidateBytes()throws Exception{return Files.readAllBytes(Path.of("build/test-fixtures/world-patch-candidate-download.json"));}
    private JsonObject candidateValue()throws Exception{return JsonParser.parseString(new String(candidateBytes(),StandardCharsets.UTF_8)).getAsJsonObject();}
    private void rejectCandidate(Consumer<JsonObject> change)throws Exception{var v=candidateValue();change.accept(v);rehash(v);var ref=reference();assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parseCandidate(encode(v),ref,()->false));}
    @Test void originalProposalAndPreviewAreIndependentlyBoundAndResponseStorageIsImmutable()throws Exception{
        var raw=candidateBytes();var result=WorldPatchCandidateReceipt.parseCandidate(raw,reference(),()->false);Arrays.fill(raw,(byte)0);
        var original=result.originalResponse();var expected=original.clone();Arrays.fill(original,(byte)0);
        assertArrayEquals(expected,result.originalResponse());assertEquals(reference(),result.reference());assertEquals(1,result.preview().totalWrites());assertFalse(result.canAuthorizePlacement());
        assertEquals(reference().responseHash(),ContextReceipt.jsonHash(JsonParser.parseString(new String(result.originalResponse(),StandardCharsets.UTF_8))));
    }
    @Test void changedProposalCannotBeAdoptedEvenIfDownloadAndResponseHashesAreRecomputed()throws Exception{
        rejectCandidate(v->v.getAsJsonObject("proposal").getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("after","minecraft:dirt"));
        rejectCandidate(v->{v.getAsJsonObject("proposal").getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("after","minecraft:dirt");v.addProperty("responseHash",ContextReceipt.jsonHash(v.get("proposal")));});
    }
    @Test void candidateAllPinsAndAuthorityFlagsMustMatchOriginalReference()throws Exception{
        for(var key:List.of("capsuleId","manifestHash","submissionHash","runtimeHash","responseHash","candidateHash","snapshotHash","selectionHash","patchHash","previewHash"))rejectCandidate(v->v.addProperty(key,"f".repeat(64)));
        for(var key:List.of("serverBaselineVerified","canAuthorizePlacement"))rejectCandidate(v->v.addProperty(key,true));
        rejectCandidate(v->v.getAsJsonObject("preview").addProperty("canAuthorizePlacement",true));
        rejectCandidate(v->v.getAsJsonObject("selection").getAsJsonObject("world").addProperty("worldId","another"));
    }
    @Test void previewOnlyAndFullCandidateProtocolsAreNotInterchangeable()throws Exception{
        var ref=reference();assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parseCandidate(bytes(),ref,()->false));
        assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parse(candidateBytes(),ref,()->false));
        rejectCandidate(v->v.remove("proposal"));rejectCandidate(v->v.addProperty("format","FrozenWorldPatchPreviewDownload"));rejectCandidate(v->v.addProperty("proposal","{}"));
    }
    @Test void candidateInvalidEncodingDuplicateNestedKeysAndTruncationNeverPublish()throws Exception{
        var ref=reference();var text=new String(candidateBytes(),StandardCharsets.UTF_8);
        for(var bad:List.of(text.replace("\"op\":\"set\"","\"op\":\"keep\",\"op\":\"set\""),text+" {}",text.substring(0,40),"[".repeat(40)+"0"+"]".repeat(40)))
            assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parseCandidate(bad.getBytes(StandardCharsets.UTF_8),ref,()->false));
        assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parseCandidate(new byte[]{(byte)0xff},ref,()->false));
        assertThrows(CancellationException.class,()->WorldPatchCandidateReceipt.parseCandidate(candidateBytes(),ref,()->true));
    }
    @Test void proposalByteQuotaIsSeparateFromDownloadAndTokenLimits()throws Exception{
        rejectCandidate(v->v.addProperty("proposal","x".repeat(WorldPatchCandidateReceipt.MAX_RESPONSE_BYTES+1)));
        var ref=reference();assertThrows(RuntimeException.class,()->WorldPatchCandidateReceipt.parseCandidate(new byte[WorldPatchCandidateReceipt.MAX_CANDIDATE_BYTES+1],ref,()->false));
    }
}
