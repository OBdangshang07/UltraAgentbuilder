package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Complete packet -> independent native reconstruction. No model, real
 * world, journal, confirmation or native write is used by these tests. */
final class CoupledAssemblyInputTest {
    static JsonObject fixtures;
    @BeforeAll static void load()throws Exception{fixtures=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-coupled-transport.json"))).getAsJsonObject();}
    private JsonObject fixture(String name){for(var row:fixtures.getAsJsonArray("cases"))if(row.getAsJsonObject().get("name").getAsString().equals(name))return row.getAsJsonObject().deepCopy();throw new AssertionError(name);}
    private SelectionRegion region(JsonObject v){return new SelectionRegion(WorldPatchJson.point(v.get("min")),WorldPatchJson.point(v.get("max")));}
    private SelectionBaseline baseline(JsonObject f){
        var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var ps=new ArrayList<SelectionRegion>();for(var p:s.getAsJsonArray("protected"))ps.add(region(p.getAsJsonObject()));
        return SelectionBaseline.fromSealedCapture(new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),ps),f.getAsJsonObject("capture"));
    }
    private byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private CoupledAssemblyBinding binding(JsonObject f){return CoupledAssemblyBinding.parse(f.getAsJsonObject("binding"));}
    private CoupledAssemblyInput input(JsonObject f){
        var b=binding(f);var parts=new ArrayList<CoupledAssemblyInput.Part>();
        for(int i=0;i<f.getAsJsonArray("parts").size();i++)parts.add(new CoupledAssemblyInput.Part(b,i,bytes(f.getAsJsonArray("parts").get(i)),bytes(f.getAsJsonArray("previews").get(i))));
        return new CoupledAssemblyInput(b,bytes(f.get("manifest")),Base64.getDecoder().decode(f.get("cellsBase64").getAsString()),bytes(f.get("plan")),parts);
    }
    private void rehash(JsonObject value,String key){value.remove(key);value.addProperty(key,SelectionBaseline.hash(value));}
    /** Deliberately forge consistent untrusted transport hashes, never source
     * or server facts. Whole native reconstruction still has to reject it. */
    private void updateFirstTransportHashes(JsonObject f){
        var part=f.getAsJsonArray("parts").get(0).getAsJsonObject();rehash(part,"partHash");String hash=part.get("partHash").getAsString();var b=f.getAsJsonObject("binding");b.getAsJsonArray("partHashes").set(0,new JsonPrimitive(hash));
        var set=f.getAsJsonObject("patchSet");set.getAsJsonArray("partHashes").set(0,new JsonPrimitive(hash));rehash(set,"patchSetHash");b.add("patchSetHash",set.get("patchSetHash"));
        var preview=f.getAsJsonArray("previews").get(0).getAsJsonObject();preview.addProperty("patchHash",hash);rehash(preview,"previewHash");b.getAsJsonArray("previewHashes").set(0,preview.get("previewHash"));
    }
    @Test void everyCompletePacketRetainsExactNodeIdentityAndRebuildsAllNativeFacts(){
        assertEquals(0,fixtures.get("realModelCalls").getAsInt());assertEquals(0,fixtures.get("worldWrites").getAsInt());assertEquals(12,fixtures.getAsJsonArray("cases").size());
        for(var row:fixtures.getAsJsonArray("cases")){
            var f=row.getAsJsonObject();var b=binding(f);assertEquals(f.get("binding"),b.json(),f.get("name").getAsString());var i=input(f);var c=AssemblyCoupledCompiler.read(baseline(f),i,()->false);
            assertEquals(f.get("plan"),c.plan());assertEquals(b.totalWrites(),c.writes().size());assertFalse(i.canAuthorizePlacement());assertFalse(b.canAuthorizePlacement());assertFalse(b.canAuthorizeModelSend());assertFalse(b.movable());assertFalse(c.canAuthorizePlacement());
        }
    }
    @Test void missingDuplicateReorderedPartsAndMissingNativeInputDoNotCreateCompletePackets(){
        var f=fixture("door-crosses-8192");var i=input(f);assertEquals(2,i.parts().size());
        for(var parts:List.of(i.parts().subList(0,1),List.of(i.parts().get(0),i.parts().get(0)),List.of(i.parts().get(1),i.parts().get(0))))
            assertThrows(IllegalArgumentException.class,()->new CoupledAssemblyInput(i.binding(),i.nativeManifest(),i.nativeCells(),i.plan(),parts));
        assertThrows(IllegalArgumentException.class,()->new CoupledAssemblyInput(i.binding(),new byte[0],i.nativeCells(),i.plan(),i.parts()));
        assertThrows(IllegalArgumentException.class,()->new CoupledAssemblyInput(i.binding(),i.nativeManifest(),new byte[1],i.plan(),i.parts()));
    }
    @Test void rehashedUnsafeWritesOrBeforeGuardsCannotReplaceTheOriginalNativeReconstruction(){
        for(boolean target:List.of(false,true)){
            var f=fixture("complete-new-door");var p=f.getAsJsonArray("parts").get(0).getAsJsonObject();
            if(target){p.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:glass");var palette=f.getAsJsonArray("previews").get(0).getAsJsonObject().getAsJsonArray("palette");for(int n=0;n<palette.size();n++)if(palette.get(n).getAsString().equals("minecraft:stone"))palette.set(n,new JsonPrimitive("minecraft:glass"));}
            else p.getAsJsonArray("guards").get(0).getAsJsonObject().addProperty("before","minecraft:glass");
            updateFirstTransportHashes(f);var forged=input(f);assertFalse(forged.canAuthorizePlacement());assertThrows(IllegalArgumentException.class,()->AssemblyCoupledCompiler.read(baseline(f),forged,()->false));
        }
    }
    @Test void alteredNativeBytesOrSelfRehashedPlanCannotBeAdoptedUsingMatchingReports(){
        var f=fixture("complete-new-door");var i=input(f);byte[] cells=i.nativeCells();cells[0]^=1;
        var altered=new CoupledAssemblyInput(i.binding(),i.nativeManifest(),cells,i.plan(),i.parts());assertThrows(IllegalArgumentException.class,()->AssemblyCoupledCompiler.read(baseline(f),altered,()->false));
        var plan=f.getAsJsonObject("plan").deepCopy();plan.getAsJsonArray("pairs").get(0).getAsJsonObject().getAsJsonArray("operationIndices").set(0,new JsonPrimitive(0));rehash(plan,"planHash");
        var p=new CoupledAssemblyInput(i.binding(),i.nativeManifest(),i.nativeCells(),bytes(plan),i.parts());assertThrows(IllegalArgumentException.class,()->AssemblyCoupledCompiler.read(baseline(f),p,()->false));
    }
    @Test void sourceHashAndPolicyMustMatchTheNativeSourceAndFixedCompilerPolicy(){
        var f=fixture("complete-new-door");f.getAsJsonObject("binding").addProperty("sourceHash","0".repeat(64));var wrongSource=input(f);assertThrows(IllegalArgumentException.class,()->AssemblyCoupledCompiler.read(baseline(f),wrongSource,()->false));
        var other=fixture("complete-new-door");var b=other.getAsJsonObject("binding");b.addProperty("couplingPolicyHash","0".repeat(64));
        for(int n=0;n<other.getAsJsonArray("previews").size();n++){var p=other.getAsJsonArray("previews").get(n).getAsJsonObject();p.addProperty("couplingPolicyHash","0".repeat(64));rehash(p,"previewHash");b.getAsJsonArray("previewHashes").set(n,p.get("previewHash"));}
        var wrongPolicy=input(other);assertThrows(IllegalArgumentException.class,()->AssemblyCoupledCompiler.read(baseline(other),wrongPolicy,()->false));
    }
    @Test void packetOwnsEveryNativePartAndPlanByteRatherThanCallerMutableReferences(){
        var f=fixture("complete-new-door");var b=binding(f);byte[] part=bytes(f.getAsJsonArray("parts").get(0)),preview=bytes(f.getAsJsonArray("previews").get(0)),manifest=bytes(f.get("manifest")),cells=Base64.getDecoder().decode(f.get("cellsBase64").getAsString()),plan=bytes(f.get("plan"));
        var p=new CoupledAssemblyInput.Part(b,0,part,preview);var i=new CoupledAssemblyInput(b,manifest,cells,plan,List.of(p));for(byte[] value:List.of(part,preview,manifest,cells,plan))Arrays.fill(value,(byte)0);
        Arrays.fill(i.nativeCells(),(byte)0);Arrays.fill(i.nativeManifest(),(byte)0);Arrays.fill(i.plan(),(byte)0);Arrays.fill(i.parts().get(0).bytes(),(byte)0);Arrays.fill(i.parts().get(0).previewBytes(),(byte)0);
        assertEquals(f.get("plan"),AssemblyCoupledCompiler.read(baseline(f),i,()->false).plan());assertThrows(UnsupportedOperationException.class,()->i.parts().clear());assertThrows(UnsupportedOperationException.class,()->b.partHashes().clear());
    }
    @Test void newIdentityRejectsLegacyAdoptionAuthorityClaimsUnknownFieldsAndRelocation(){
        var f=fixture("complete-new-door");var b=binding(f);assertThrows(IllegalArgumentException.class,()->AssemblyPatchBinding.parse(b.json()));
        for(String flag:List.of("canAuthorizePlacement","canAuthorizeModelSend","serverBaselineVerified","physicsVerified","movable")){var v=b.json();v.addProperty(flag,true);assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBinding.parse(v),flag);}
        var extra=b.json();extra.addProperty("allowPartial",true);assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBinding.parse(extra));
        var origin=b.json();origin.getAsJsonArray("origin").set(0,new JsonPrimitive(999));assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBinding.parse(origin));
        var old=b.json();old.addProperty("format","AssemblyPatchBinding");old.addProperty("version",2);assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBinding.parse(old));
        byte[] duplicate=("{\"version\":1,"+b.json().toString().substring(1)).getBytes(StandardCharsets.UTF_8);assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBinding.parse(duplicate,()->false));
    }
    @Test void cancellationAndChangedServerBaselineNeverRefreshOrRebaseTheOriginalInput(){
        var f=fixture("complete-new-door");var i=input(f);assertThrows(java.util.concurrent.CancellationException.class,()->AssemblyCoupledCompiler.read(baseline(f),i,()->true));
        var changed=f.deepCopy();changed.getAsJsonObject("capture").getAsJsonObject("fence").addProperty("start",6);changed.getAsJsonObject("capture").getAsJsonObject("fence").addProperty("end",6);
        assertThrows(IllegalArgumentException.class,()->AssemblyCoupledCompiler.read(baseline(changed),i,()->false));
    }
}
