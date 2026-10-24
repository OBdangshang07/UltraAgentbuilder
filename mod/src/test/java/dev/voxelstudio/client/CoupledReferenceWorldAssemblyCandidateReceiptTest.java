package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Production registered Node full tasks and exact raw-file envelopes.
 * Providers, pictures and native uploads SYNTHETIC; no real game or model. */
class CoupledReferenceWorldAssemblyCandidateReceiptTest {
    static List<JsonObject> fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/coupled-reference-world-assembly-candidate-headers.json"))).getAsJsonArray().asList().stream().map(JsonElement::getAsJsonObject).toList();}
    static JsonObject partFixture(JsonObject f,int index)throws Exception{
        var pin=f.getAsJsonArray("partFiles").get(index).getAsJsonObject();String name="coupled-reference-world-assembly-candidate-"+f.get("tier").getAsString()+"-"+index+".json";
        assertEquals(name,pin.get("path").getAsString());byte[] bytes=Files.readAllBytes(Path.of("build/test-fixtures").resolve(name));assertEquals(pin.get("bytes").getAsInt(),bytes.length);assertEquals(pin.get("sha256").getAsString(),ContextReceipt.sha256(bytes));return WorldPatchCandidateReceipt.strictJson(new String(bytes,StandardCharsets.UTF_8),()->false).getAsJsonObject();
    }
    static JsonObject reference(JsonObject f){return CoupledReferenceWorldAssemblyReceiptTest.reference(f);}
    static CoupledReferenceWorldAssemblyCandidateReceipt.Metadata metadata(JsonObject f){return CoupledReferenceWorldAssemblyCandidateReceipt.metadata(reference(f),f.getAsJsonObject("status"),f.getAsJsonObject("metadata"),()->false);}
    static byte[] cells(JsonObject f,CoupledReferenceWorldAssemblyCandidateReceipt.Metadata m){return CoupledReferenceWorldAssemblyCandidateReceipt.cells(m,f.getAsJsonObject("cells"),()->false);}
    static List<CoupledReferenceWorldAssemblyCandidateReceipt.Part> parts(JsonObject f,CoupledReferenceWorldAssemblyCandidateReceipt.Metadata m)throws Exception{
        var result=new ArrayList<CoupledReferenceWorldAssemblyCandidateReceipt.Part>();for(int i=0;i<m.partCount();i++)result.add(CoupledReferenceWorldAssemblyCandidateReceipt.part(m,i,partFixture(f,i),()->false));return result;
    }
    @Test void actualRegisteredLiteAndUltraCarryTheSameRawNativePlanAllPartsAndPair()throws Exception{
        for(var f:fixtures()){
            var m=metadata(f);var bytes=cells(f,m);var parts=parts(f,m);var whole=CoupledReferenceWorldAssemblyCandidateReceipt.whole(m,bytes,parts,()->false);
            assertFalse(whole.canAuthorizePlacement());assertFalse(whole.currentWorldVerified());assertTrue(whole.completeSetTransport());assertFalse(WorldPatchCheckedCandidate.class.isInstance(whole));
            var checked=CoupledAssemblyCheckedCandidate.prepare(whole,()->false);var input=checked.input();assertEquals(input.binding().totalWrites(),checked.preview().totalWrites());assertFalse(checked.canAuthorizePlacement());
            var metadataFiles=f.getAsJsonObject("metadata").getAsJsonArray("files");assertArrayEquals(metadataFiles.get(0).getAsJsonObject().get("data").getAsString().getBytes(StandardCharsets.UTF_8),input.nativeManifest());assertArrayEquals(bytes,input.nativeCells());assertArrayEquals(metadataFiles.get(1).getAsJsonObject().get("data").getAsString().getBytes(StandardCharsets.UTF_8),input.plan());
            for(int i=0;i<parts.size();i++){var files=partFixture(f,i).getAsJsonArray("files");assertArrayEquals(files.get(0).getAsJsonObject().get("data").getAsString().getBytes(StandardCharsets.UTF_8),input.parts().get(i).bytes());assertArrayEquals(files.get(1).getAsJsonObject().get("data").getAsString().getBytes(StandardCharsets.UTF_8),input.parts().get(i).previewBytes());assertFalse(parts.get(i).partIsApplyScope());}
            int lower=0,upper=0;for(var section:checked.preview().sections())for(var row:section.rows())if(row.after().contains("_door[")){if(row.after().contains("half=lower"))lower++;if(row.after().contains("half=upper"))upper++;}
            assertEquals(1,lower);assertEquals(1,upper);
            if(f.get("tier").getAsString().equals("ultra")){
                assertEquals(54406,input.binding().totalWrites());assertEquals(7,input.parts().size());var manifest=JsonParser.parseString(new String(input.nativeManifest(),StandardCharsets.UTF_8)).getAsJsonObject();var d=manifest.getAsJsonObject("dimensions");int width=d.get("width").getAsInt(),plane=width*d.get("length").getAsInt(),min=Integer.MAX_VALUE,max=-1;
                for(int i=0;i<bytes.length/2;i++){int cell=(bytes[i*2]&255)|((bytes[i*2+1]&255)<<8);if(cell>=2){min=Math.min(min,i/plane);max=Math.max(max,i/plane);}}assertEquals(224,max-min+1);
            }
        }
    }
    @Test void rawFilesCannotBeReencodedSwappedTruncatedOrRenamed()throws Exception{
        var f=fixtures().get(0);var r=reference(f);for(var key:List.of("encoding","path","sha256","bytes","data","unknown")){
            var e=f.getAsJsonObject("metadata").deepCopy();var file=e.getAsJsonArray("files").get(0).getAsJsonObject();switch(key){case "bytes"->file.addProperty(key,1);case "data"->file.addProperty(key,file.get(key).getAsString()+" ");case "encoding"->file.addProperty(key,"base64");default->file.addProperty(key,"changed");}
            assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.metadata(r,f.getAsJsonObject("status"),e,()->false),key);
        }
        var reversed=f.getAsJsonObject("metadata").deepCopy();var files=reversed.getAsJsonArray("files");var first=files.get(0);files.set(0,files.get(1));files.set(1,first);assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.metadata(r,f.getAsJsonObject("status"),reversed,()->false));
        var malformed=f.getAsJsonObject("metadata").deepCopy();malformed.getAsJsonArray("files").get(0).getAsJsonObject().addProperty("data","\ud800");assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.metadata(r,f.getAsJsonObject("status"),malformed,()->false));
    }
    @Test void cellsMustBeCanonicalExactBase64AndCannotCrossAnotherOriginalTask()throws Exception{
        var f=fixtures().get(0);var m=metadata(f);
        for(var variant:List.of("padding","bytes","identity","data")){
            var e=f.getAsJsonObject("cells").deepCopy();var file=e.getAsJsonObject("file");switch(variant){case "padding"->file.addProperty("data",file.get("data").getAsString().replace("=",""));case "bytes"->file.addProperty("bytes",2);case "identity"->e.addProperty("candidateHash","f".repeat(64));default->file.addProperty("data","AAAA");}
            assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.cells(m,e,()->false),variant);
        }
    }
    @Test void completeAssemblyRejectsMissingReorderedRepeatedOrEqualButUnownedParts()throws Exception{
        var f=fixtures().get(1);var m=metadata(f);var bytes=cells(f,m);var parts=parts(f,m);assertTrue(parts.size()>1);
        assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.whole(m,bytes,parts.subList(0,parts.size()-1),()->false));
        var swapped=new ArrayList<>(parts);Collections.swap(swapped,0,1);assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.whole(m,bytes,swapped,()->false));
        var repeated=new ArrayList<>(parts);repeated.set(1,parts.get(0));assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.whole(m,bytes,repeated,()->false));
        var other=metadata(f);assertEquals(m.candidateHash(),other.candidateHash());assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.whole(other,bytes,parts,()->false));
        bytes[0]^=1;assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.whole(m,bytes,parts,()->false));
    }
    @Test void metadataMustPinOriginalTaskScopeBudgetPolicyAndRegisteredProofs()throws Exception{
        var f=fixtures().get(0);for(var key:List.of("requestHash","runtimeHash","referenceSetHash","couplingPolicyHash","partCount","operationCount","pairCount","movable","originalRegistryVerified","canAuthorizePlacement","proofFiles")){
            var e=f.getAsJsonObject("metadata").deepCopy();var c=e.getAsJsonObject("candidate");switch(key){case "partCount","operationCount","pairCount"->c.addProperty(key,999);case "movable","originalRegistryVerified","canAuthorizePlacement"->c.addProperty(key,true);case "proofFiles"->c.getAsJsonArray(key).asList().removeIf(value->value.getAsJsonObject().get("path").getAsString().equals("original-execution-start.json"));default->c.addProperty(key,"f".repeat(64));}
            c.remove("candidateHash");c.addProperty("candidateHash",ContextReceipt.jsonHash(c));e.add("candidateHash",c.get("candidateHash"));var status=f.getAsJsonObject("status").deepCopy();status.getAsJsonObject("candidate").add("candidateHash",c.get("candidateHash"));
            assertThrows(RuntimeException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.metadata(reference(f),status,e,()->false),key);
        }
        assertThrows(RuntimeException.class,()->ReferenceWorldAssemblyReceipt.verifyReference(reference(f)));
    }
    @Test void cancellationAndExactAggregateWireBudgetNeverReturnAPartialWhole()throws Exception{
        var f=fixtures().get(0);assertThrows(java.util.concurrent.CancellationException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.metadata(reference(f),f.getAsJsonObject("status"),f.getAsJsonObject("metadata"),()->true));
        var m=metadata(f);assertThrows(java.util.concurrent.CancellationException.class,()->CoupledReferenceWorldAssemblyCandidateReceipt.part(m,0,partFixture(f,0),()->true));
        var budget=new CoupledReferenceWorldAssemblyCandidateReceipt.Budget();budget.add(Math.toIntExact(CoupledReferenceWorldAssemblyCandidateReceipt.DOWNLOAD_BYTES));assertThrows(RuntimeException.class,()->budget.add(1));assertThrows(RuntimeException.class,()->new CoupledReferenceWorldAssemblyCandidateReceipt.Budget().add(0));
    }
}
