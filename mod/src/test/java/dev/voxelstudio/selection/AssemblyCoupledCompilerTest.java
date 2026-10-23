package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Exact Node/Java whole-native agreement, not a server application or a
 * single-part approval. Every fixture is authored synthetic block-only data. */
final class AssemblyCoupledCompilerTest {
    private static JsonObject fixtures;
    @BeforeAll static void load()throws Exception{fixtures=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-coupled.json"))).getAsJsonObject();}
    private SelectionRegion region(JsonObject v){return new SelectionRegion(WorldPatchJson.point(v.get("min")),WorldPatchJson.point(v.get("max")));}
    private SelectionBaseline baseline(JsonObject f){
        var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var protectedRegions=new ArrayList<SelectionRegion>();for(var r:s.getAsJsonArray("protected"))protectedRegions.add(region(r.getAsJsonObject()));
        var selection=new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),protectedRegions);
        return SelectionBaseline.fromSealedCapture(selection,f.getAsJsonObject("capture"));
    }
    private AssemblyCoupledCompiler.Compiled compile(JsonObject f){return AssemblyCoupledCompiler.compile(baseline(f),f.getAsJsonObject("manifest"),Base64.getDecoder().decode(f.get("cellsBase64").getAsString()),()->false);}
    private JsonObject first(){return fixtures.getAsJsonArray("valid").get(0).getAsJsonObject();}
    private JsonObject named(String name){for(var f:fixtures.getAsJsonArray("valid"))if(f.getAsJsonObject().get("name").getAsString().equals(name))return f.getAsJsonObject();throw new AssertionError("Missing fixture "+name);}
    @Test void independentCompilerReconstructsEveryFullAnalysisPlanPartAndSet(){
        assertEquals(0,fixtures.get("realModelCalls").getAsInt());assertEquals(0,fixtures.get("worldWrites").getAsInt());assertEquals(11,fixtures.getAsJsonArray("valid").size());assertEquals(AssemblyCoupledPolicy.HASH,fixtures.get("policyHash").getAsString());
        for(var element:fixtures.getAsJsonArray("valid")){
            var f=element.getAsJsonObject();var compiled=compile(f);String name=f.get("name").getAsString();
            assertEquals(f.get("analysis"),compiled.analysis(),name+" analysis");assertEquals(f.get("plan"),compiled.plan(),name+" plan");assertFalse(compiled.canAuthorizePlacement());assertFalse(compiled.physicsVerified());
            assertEquals(f.getAsJsonArray("parts").size(),compiled.partCount());
            for(int index=0;index<compiled.partCount();index++){assertEquals(f.getAsJsonArray("parts").get(index),compiled.part(index,()->false),name+" part"+index);compiled.verifyPart(index,f.getAsJsonArray("parts").get(index).getAsJsonObject(),()->false);}
            assertEquals(f.get("patchSet"),compiled.patchSet(()->false),name+" set");
            var groups=new JsonArray();for(var group:compiled.groups()){var row=new JsonObject();row.addProperty("offset",group.offset());row.addProperty("kind",group.kind());var indices=new JsonArray();group.operationIndices().forEach(indices::add);row.add("operationIndices",indices);row.addProperty("canAuthorizePlacement",false);groups.add(row);}
            assertEquals(f.get("groups"),groups,name+" groups");
        }
    }
    @Test void invalidWholeNativeFactsAreIndependentlyRejectedBeforeAnyPartExists(){
        var rows=fixtures.getAsJsonArray("invalid");assertTrue(rows.size()>=28);
        for(var element:rows){var f=element.getAsJsonObject();assertThrows(RuntimeException.class,()->compile(f),f.get("name").getAsString());}
    }
    @Test void everyNativeOperationOccursExactlyOnceAndDoorGroupsNeverSplitAtPartBoundary(){
        var c=compile(named("door-crosses-8192"));assertEquals(8193,c.writes().size());assertEquals(2,c.partCount());assertEquals(List.of(8191,8192),c.groups().get(c.groups().size()-1).operationIndices());
        var seen=new HashSet<Integer>();int offset=0;for(var g:c.groups()){assertEquals(offset,g.offset());for(int i:g.operationIndices())assertTrue(seen.add(i));offset+=g.operationIndices().size();}
        assertEquals(8193,seen.size());assertEquals(8193,offset);assertEquals(1,c.part(1,()->false).getAsJsonArray("writes").size());
    }
    @Test void globalPairPromotionKeepsInterleavedNativeWritesWithoutTreatingPartAsAnApplyScope(){
        var c=compile(named("interleaved-pairs"));var groups=c.groups().stream().map(AssemblyCoupledCompiler.Group::operationIndices).toList();
        assertEquals(List.of(List.of(0),List.of(1),List.of(2),List.of(3,5),List.of(4,6)),groups);
        var p=c.part(0,()->false);assertFalse(p.get("partIsApplyScope").getAsBoolean());assertTrue(p.get("completePlanRequired").getAsBoolean());
    }
    @Test void originalInputsAndReturnedJsonCannotMutateACompiledWholePlan(){
        var f=first().deepCopy();var manifest=f.getAsJsonObject("manifest");byte[] cells=Base64.getDecoder().decode(f.get("cellsBase64").getAsString());var c=AssemblyCoupledCompiler.compile(baseline(f),manifest,cells,()->false);var expected=c.plan();
        manifest.addProperty("assetHash","0".repeat(64));Arrays.fill(cells,(byte)0);var returned=c.plan();returned.addProperty("canAuthorizePlacement",true);returned.getAsJsonArray("pairs").remove(0);
        assertEquals(expected,c.plan());assertEquals(first().get("parts").getAsJsonArray().get(0),c.part(0,()->false));
        assertThrows(UnsupportedOperationException.class,()->c.writes().clear());assertThrows(UnsupportedOperationException.class,()->c.groups().clear());
    }
    @Test void rehashedPartTamperingAndWrongIndicesDoNotBecomeIndependentAuthority(){
        var c=compile(first());for(String key:List.of("canAuthorizePlacement","completePlanRequired","offset","planHash")){
            var p=c.part(0,()->false);if(key.equals("planHash"))p.addProperty(key,"0".repeat(64));else if(key.equals("offset"))p.addProperty(key,1);else p.addProperty(key,!p.get(key).getAsBoolean());
            p.remove("partHash");p.addProperty("partHash",SelectionBaseline.hash(p));assertThrows(IllegalArgumentException.class,()->c.verifyPart(0,p,()->false),key);
        }
        assertThrows(IllegalArgumentException.class,()->c.part(-1,()->false));assertThrows(IllegalArgumentException.class,()->c.part(c.partCount(),()->false));
    }
    @Test void cancellationPropagatesBeforeAndDuringCompleteNativeReconstruction(){
        var f=named("door-crosses-8192");var b=baseline(f);byte[] cells=Base64.getDecoder().decode(f.get("cellsBase64").getAsString());
        assertThrows(java.util.concurrent.CancellationException.class,()->AssemblyCoupledCompiler.compile(b,f.getAsJsonObject("manifest"),cells,()->true));
        var calls=new AtomicInteger();assertThrows(java.util.concurrent.CancellationException.class,()->AssemblyCoupledCompiler.compile(b,f.getAsJsonObject("manifest"),cells,()->calls.incrementAndGet()>12));
        var c=compile(f);assertThrows(java.util.concurrent.CancellationException.class,()->c.part(0,()->true));assertThrows(java.util.concurrent.CancellationException.class,()->c.patchSet(()->true));
    }
    @Test void sharedFiniteSupportPolicyAgreesWithoutRelaxingLegacyTargetOrBeforeRules(){
        for(var row:fixtures.getAsJsonArray("supportCases")){var v=row.getAsJsonObject();assertEquals(v.get("fullUpperFace").getAsBoolean(),AssemblyCoupledPolicy.fullUpperFace(v.get("state").getAsString()),v.get("state").getAsString());}
        String lower="minecraft:dark_oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]";
        assertDoesNotThrow(()->AssemblyCoupledPolicy.target(lower));assertThrows(IllegalArgumentException.class,()->WorldPatchStatePolicy.requireStatic(lower));
        assertEquals("coupled-block",WorldPatchStatePolicy.protection(new SelectionScan.BlockFact(lower,false)));
    }
}
