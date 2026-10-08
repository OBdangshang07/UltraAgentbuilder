package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Production Node whole-set fixtures, synthetic geometry and native uploads.
 * No game, real image understanding, server attestation or world write. */
class ReferenceWorldAssemblyCandidateReceiptTest {
    static List<JsonObject> fixtures()throws Exception{try(var reader=Files.newBufferedReader(Path.of("build/test-fixtures/reference-world-assembly-candidate-headers.json"))){return JsonParser.parseReader(reader).getAsJsonArray().asList().stream().map(JsonElement::getAsJsonObject).toList();}}
    static JsonObject partFixture(JsonObject f,int index)throws Exception{
        var pin=f.getAsJsonArray("partFiles").get(index).getAsJsonObject();String expected="reference-world-assembly-candidate-"+f.get("tier").getAsString()+"-"+index+".json";
        assertEquals(expected,pin.get("path").getAsString());byte[] bytes=Files.readAllBytes(Path.of("build/test-fixtures").resolve(expected));
        assertEquals(pin.get("bytes").getAsLong(),bytes.length);assertEquals(pin.get("sha256").getAsString(),ContextReceipt.sha256(bytes));
        try(var reader=new java.io.InputStreamReader(new java.io.ByteArrayInputStream(bytes),java.nio.charset.StandardCharsets.UTF_8)){return JsonParser.parseReader(reader).getAsJsonObject();}
    }
    static ReferenceWorldAssemblyCandidateReceipt.Metadata metadata(JsonObject f){return ReferenceWorldAssemblyCandidateReceipt.metadata(ReferenceWorldAssemblyReceiptTest.reference(f),f.getAsJsonObject("status"),f.getAsJsonObject("metadata"),()->false);}
    static List<ReferenceWorldAssemblyCandidateReceipt.Part> parts(JsonObject f,ReferenceWorldAssemblyCandidateReceipt.Metadata m)throws Exception{assertEquals(m.partCount(),f.getAsJsonArray("partFiles").size());var result=new ArrayList<ReferenceWorldAssemblyCandidateReceipt.Part>();for(int i=0;i<m.partCount();i++)result.add(ReferenceWorldAssemblyCandidateReceipt.part(m,i,partFixture(f,i),()->false));return result;}
    @Test void streamedCanonicalHashRetainsOriginalSortedKeysAndExactUnicodeBytes(){
        var value=new JsonObject();value.addProperty("z","控制\n\t\"\\\u2028\u2029\ud800\udc00\ud800\ud83d\ude42");value.add("a",JsonParser.parseString("[null,true,false,1,-2,0.5,{\"z\":0,\"a\":1}]"));
        for(var sample:List.of(value,JsonNull.INSTANCE,new JsonPrimitive("\u2028\ud800\ud83d\ude42".repeat(1024)),JsonParser.parseString("{\"b\":{},\"a\":[],\"c\":1.0}")))assertEquals(ContextReceipt.sha256(ContextReceipt.canonicalJson(sample).getBytes(java.nio.charset.StandardCharsets.UTF_8)),ContextReceipt.jsonHash(sample));
    }
    @Test void streamedTransportQuotaCountsOriginalUtf8NotUtf16Characters(){
        var value=new JsonObject();value.addProperty("text","中文\n\"\\\u2028\ud83d\ude42".repeat(4096));value.add("nested",JsonParser.parseString("[null,true,false,{\"b\":1,\"a\":2}]"));
        long expected=value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        assertTrue(expected>value.toString().length());assertEquals(expected,ReferenceWorldAssemblyCandidateReceipt.transmittedBytes(value));
    }
    @Test void actualSharedLiteAnd224MetreUltraAreOneCompleteOriginalAbsoluteSet()throws Exception{
        for(var f:fixtures()){var m=metadata(f);var parts=parts(f,m);var whole=ReferenceWorldAssemblyCandidateReceipt.whole(m,parts,()->false);var capture=ReferenceWorldAssemblyReceiptTest.capture(f);
            assertEquals(f.getAsJsonObject("metadata").getAsJsonObject("candidate").get("operationCount").getAsInt(),whole.totalWrites());assertTrue(whole.completeSetVerified());assertFalse(whole.movable());assertFalse(whole.canAuthorizePlacement());assertFalse(whole.currentWorldVerified());
            assertFalse(WorldPatchCheckedCandidate.class.isInstance(whole));assertFalse(WorldPatchCheckedCandidate.class.isInstance(parts.get(0)));assertFalse(m.canAuthorizePlacement());
            for(var p:parts){assertFalse(p.partIsApplyScope());assertFalse(p.canAuthorizePlacement());var proposal=JsonParser.parseString(new String(p.originalProposal(),java.nio.charset.StandardCharsets.UTF_8));assertEquals(p.patch().get("proposal"),proposal);
                for(var section:p.preview().sections())for(var row:section.rows()){assertEquals(row,whole.at(row.position()));assertTrue(capture.selection().edit().contains(row.position()));}}
            if(f.get("tier").getAsString().equals("ultra")){assertTrue(parts.size()>1);assertEquals(224,m.reference().getAsJsonObject("prepared").getAsJsonObject("maximumBounds").get("height").getAsInt());}
        }
    }
    @Test void metadataCannotRehashItsWayToAnotherOriginalAssetScopePixelsOrBudget()throws Exception{
        var f=fixtures().get(0);var r=ReferenceWorldAssemblyReceiptTest.reference(f);for(var key:List.of("assetHash","cellsHash","snapshotHash","selectionHash","referenceSetHash","runtimeHash","sourceHash","origin","reservedCalls","partCount","movable","partialPublicationAllowed","canAuthorizePlacement")){
            var e=f.getAsJsonObject("metadata").deepCopy();var c=e.getAsJsonObject("candidate");if(key.equals("origin"))c.add(key,JsonParser.parseString("[0,0,0]"));else if(key.equals("reservedCalls"))c.addProperty(key,1);else if(key.equals("partCount"))c.addProperty(key,2);else if(key.equals("movable")||key.equals("partialPublicationAllowed")||key.equals("canAuthorizePlacement"))c.addProperty(key,true);else c.addProperty(key,"f".repeat(64));
            c.remove("candidateHash");c.addProperty("candidateHash",ContextReceipt.jsonHash(c));assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.metadata(r,f.getAsJsonObject("status"),e,()->false),key);
        }
        var running=f.getAsJsonObject("status").deepCopy();running.addProperty("state","running");running.add("candidate",JsonNull.INSTANCE);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.metadata(r,running,f.getAsJsonObject("metadata"),()->false));
    }
    @Test void partSwapsAuthorityUnknownKeysAndWrongIndexCannotReachWhole()throws Exception{
        var f=fixtures().get(1);var m=metadata(f);for(var key:List.of("candidateHash","preparationHash","index","partIsApplyScope","serverBaselineVerified","additionalModelCalls","worldWrites","unexpected")){
            var p=partFixture(f,0);switch(key){case "index","additionalModelCalls","worldWrites"->p.addProperty(key,1);case "partIsApplyScope","serverBaselineVerified"->p.addProperty(key,true);default->p.addProperty(key,"f".repeat(64));}
            assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.part(m,0,p,()->false),key);
        }
        var swapped=partFixture(f,0);swapped.add("patch",partFixture(f,1).get("patch"));assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.part(m,0,swapped,()->false));
        var changed=partFixture(f,0);changed.getAsJsonObject("preview").addProperty("movable",true);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.part(m,0,changed,()->false));
    }
    @Test void partialRepeatedReorderedAndCrossOwnerPartsAreRejectedWithoutPartialAdoption()throws Exception{
        var f=fixtures().get(1);var m=metadata(f);var original=parts(f,m);assertTrue(original.size()>1);
        assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.whole(m,original.subList(0,original.size()-1),()->false));
        var duplicated=new ArrayList<>(original);duplicated.set(1,duplicated.get(0));assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.whole(m,duplicated,()->false));
        var reordered=new ArrayList<>(original);Collections.reverse(reordered);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.whole(m,reordered,()->false));
        var other=metadata(f);assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyCandidateReceipt.whole(other,original,()->false));assertEquals(original.size(),ReferenceWorldAssemblyCandidateReceipt.whole(m,original,()->false).parts().size());
    }
    @Test void cancellationAtEveryBoundaryDoesNotProduceAnEligibleWhole()throws Exception{
        var f=fixtures().get(0);var m=metadata(f);var p=parts(f,m);
        assertThrows(java.util.concurrent.CancellationException.class,()->ReferenceWorldAssemblyCandidateReceipt.metadata(ReferenceWorldAssemblyReceiptTest.reference(f),f.getAsJsonObject("status"),f.getAsJsonObject("metadata"),()->true));
        var first=partFixture(f,0);assertThrows(java.util.concurrent.CancellationException.class,()->ReferenceWorldAssemblyCandidateReceipt.part(m,0,first,()->true));assertThrows(java.util.concurrent.CancellationException.class,()->ReferenceWorldAssemblyCandidateReceipt.whole(m,p,()->true));
    }
    @Test void publicViewsCannotMutatePinnedPartsOrBecomeSinglePatchAuthority()throws Exception{
        var f=fixtures().get(0);var m=metadata(f);var p=parts(f,m);var whole=ReferenceWorldAssemblyCandidateReceipt.whole(m,p,()->false);String hash=m.candidateHash();
        m.reference().addProperty("canAuthorizePlacement",true);m.candidate().addProperty("candidateHash","f".repeat(64));m.patchSet().addProperty("canAuthorizePlacement",true);m.status().addProperty("state","running");p.get(0).patch().addProperty("canAuthorizePlacement",true);var bytes=p.get(0).originalProposal();bytes[0]=0;
        assertEquals(hash,whole.metadata().candidateHash());assertFalse(whole.metadata().patchSet().get("canAuthorizePlacement").getAsBoolean());assertFalse(whole.parts().get(0).patch().get("canAuthorizePlacement").getAsBoolean());assertEquals((byte)'{',whole.parts().get(0).originalProposal()[0]);assertThrows(UnsupportedOperationException.class,()->whole.parts().clear());
    }
}
