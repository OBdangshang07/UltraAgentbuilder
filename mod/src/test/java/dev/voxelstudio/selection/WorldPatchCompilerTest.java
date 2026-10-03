package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Exact Node production artifacts vs an independent server-side compiler.
 * No live server, model, game, real-world write or physics acceptance. */
final class WorldPatchCompilerTest {
    private JsonObject fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/world-patch-safety.json"))).getAsJsonObject();}
    private SelectionRegion.Point point(JsonArray a){return new SelectionRegion.Point(a.get(0).getAsInt(),a.get(1).getAsInt(),a.get(2).getAsInt());}
    private SelectionRegion region(JsonObject o){return new SelectionRegion(point(o.getAsJsonArray("min")),point(o.getAsJsonArray("max")));}
    private SelectionBaseline baseline(JsonObject f){
        var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var protectedRegions=new ArrayList<SelectionRegion>();for(var r:s.getAsJsonArray("protected"))protectedRegions.add(region(r.getAsJsonObject()));
        var selection=new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),protectedRegions);
        return SelectionBaseline.fromSealedCapture(selection,f.getAsJsonObject("capture"));
    }
    private JsonObject first()throws Exception{return fixtures().getAsJsonArray("valid").get(0).getAsJsonObject();}
    private WorldPatchCompiler.Compiled compile(JsonObject f){return WorldPatchCompiler.compile(baseline(f),f.getAsJsonObject("raw"),()->false);}
    private WorldPatchPreview.Binding binding(JsonObject f,SelectionBaseline b){var v=f.getAsJsonObject("preview");return new WorldPatchPreview.Binding(b.selection,b.contextRevision,b.snapshotHash,b.selectionHash,v.get("patchHash").getAsString(),v.get("previewHash").getAsString());}
    private byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    @Test void wholeCompiledArtifactsMatchProductionHashesWritesGuardsAndKeepSemantics()throws Exception{
        var fixtures=fixtures();assertEquals(0,fixtures.get("realModelCalls").getAsInt());assertEquals(0,fixtures.get("worldWrites").getAsInt());assertEquals(7,fixtures.getAsJsonArray("valid").size());
        for(var item:fixtures.getAsJsonArray("valid")){var f=item.getAsJsonObject();var compiled=compile(f);
            assertEquals(f.get("patch"),compiled.json(),f.get("name").getAsString());assertEquals(f.get("responseHash").getAsString(),compiled.responseHash());assertEquals(f.getAsJsonObject("patch").get("patchHash").getAsString(),compiled.patchHash());assertFalse(compiled.canAuthorizePlacement());assertFalse(compiled.physicsVerified());
            WorldPatchCompiler.verifyDownloaded(compiled,f.getAsJsonObject("patch"));var pin=binding(f,compiled.baseline());var preview=WorldPatchPreview.parse(bytes(f.get("preview")),pin);WorldPatchCompiler.verifyPreview(compiled,preview,pin);
        }
    }
    @Test void independentlyRejectsEveryProductionUnsafeCaseRatherThanTrustingNodeVerdict()throws Exception{
        var invalid=fixtures().getAsJsonArray("invalid");assertTrue(invalid.size()>=25);
        for(var item:invalid){var f=item.getAsJsonObject();assertThrows(RuntimeException.class,()->compile(f),f.get("name").getAsString());}
    }
    @Test void ordinaryGroundIsSupportedWhileUnknownSnowAndDynamicStatesRemainProtected(){
        for(String state:List.of("minecraft:dirt","minecraft:grass_block[snowy=false]")){
            assertTrue(WorldPatchStatePolicy.supported(state));assertNull(WorldPatchStatePolicy.protection(new SelectionScan.BlockFact(state,false)));
            assertDoesNotThrow(()->WorldPatchStatePolicy.requireStatic(state));assertDoesNotThrow(()->WorldPatchStatePolicy.requireNeighbor(new SelectionScan.BlockFact(state,false)));
        }
        for(String state:List.of("minecraft:grass_block","minecraft:grass_block[snowy=true]","minecraft:grass_block[snowy=false,unknown=true]","minecraft:water[level=0]","minecraft:sand"))
            assertThrows(RuntimeException.class,()->WorldPatchStatePolicy.requireNeighbor(new SelectionScan.BlockFact(state,false)),state);
        assertThrows(RuntimeException.class,()->WorldPatchStatePolicy.requireNeighbor(new SelectionScan.BlockFact("minecraft:dirt",true)));
    }
    @Test void allAdvertisedPropertyCombinationsProduceTheExactProductionPatchHash()throws Exception{
        var f=first();var source=fixtures();var original=baseline(f);var glass=baseline(source.getAsJsonObject("catalogGlassBase"));var raw=f.getAsJsonObject("raw");var states=source.getAsJsonArray("catalogStates");assertTrue(states.size()>100);
        for(var item:states){var row=item.getAsJsonObject();var base=row.get("before").getAsString().equals("minecraft:glass")?glass:original;var proposal=raw.deepCopy();proposal.addProperty("snapshotHash",base.snapshotHash);proposal.addProperty("selectionHash",base.selectionHash);var op=proposal.getAsJsonArray("operations").get(0).getAsJsonObject();op.addProperty("after",row.get("state").getAsString());op.addProperty("before",row.get("before").getAsString());
            var compiled=WorldPatchCompiler.compile(base,proposal,()->false);assertEquals(row.get("patchHash").getAsString(),compiled.patchHash(),row.get("state").getAsString());}
    }
    @Test void pinsMustComeFromTheOriginalResponseAndOriginalSnapshot()throws Exception{
        var f=first();var original=baseline(f);var pin=binding(f,original);var raw=bytes(f.get("raw"));var response=f.get("responseHash").getAsString();
        assertEquals(pin.patchHash(),WorldPatchCompiler.read(original,raw,pin,response,()->false).patchHash());
        assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.read(original,raw,pin,"0".repeat(64),()->false));
        var wrong=new WorldPatchPreview.Binding(original.selection,original.contextRevision,original.snapshotHash,original.selectionHash,"0".repeat(64),pin.previewHash());assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.read(original,raw,wrong,response,()->false));
        var changed=f.getAsJsonObject("capture").deepCopy();changed.getAsJsonObject("fence").addProperty("start",10);changed.getAsJsonObject("fence").addProperty("end",10);var replacement=SelectionBaseline.fromSealedCapture(original.selection,changed);
        assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.read(replacement,raw,pin,response,()->false));
    }
    @Test void downloadedWritesGuardsAndAuthorityFlagsCannotBeRehashedIntoAcceptance()throws Exception{
        var f=first();var compiled=compile(f);
        for(int kind=0;kind<4;kind++){var bad=compiled.json();if(kind==0)bad.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:stone_bricks");if(kind==1)bad.getAsJsonArray("guards").remove(0);if(kind==2)bad.addProperty("canAuthorizePlacement",true);if(kind==3)bad.addProperty("physicsVerified",true);
            bad.remove("patchHash");bad.addProperty("patchHash",SelectionBaseline.hash(bad));assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.verifyDownloaded(compiled,bad));
        }
    }
    @Test void rehashedPreviewCannotSubstituteDifferentWritesOrNewPins()throws Exception{
        var f=first();var compiled=compile(f);var original=binding(f,compiled.baseline());var v=f.getAsJsonObject("preview").deepCopy();v.getAsJsonArray("palette").set(0,new JsonPrimitive("minecraft:gold_block"));v.remove("previewHash");v.addProperty("previewHash",SelectionBaseline.hash(v));
        var changed=new WorldPatchPreview.Binding(original.selection(),original.contextRevision(),original.snapshotHash(),original.selectionHash(),original.patchHash(),v.get("previewHash").getAsString());var preview=WorldPatchPreview.parse(bytes(v),changed);
        assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.verifyPreview(compiled,preview,original));assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.verifyPreview(compiled,preview,changed));
    }
    @Test void strictDuplicateUtf8TrailingAndDeepJsonCannotBecomeAProposal()throws Exception{
        for(String value:List.of("{\"operations\":[],\"operations\":[]}","{} {}","null","[1]","{\"x\":"+"[".repeat(34)+"0"+"]".repeat(34)+"}"))assertThrows(RuntimeException.class,()->WorldPatchJson.parse(value.getBytes(StandardCharsets.UTF_8),()->false));
        assertThrows(IllegalArgumentException.class,()->WorldPatchJson.parse(new byte[]{'{','"','x','"',':','"',(byte)0xc3,'"','}'},()->false));
        assertThrows(IllegalArgumentException.class,()->WorldPatchJson.parse(new byte[SelectionLimits.snapshotBytes()+1],()->false));
    }
    @Test void noScopeTransformCommandsOrPermissionsCanBeAddedToProposal()throws Exception{
        var f=first();for(String key:List.of("world","selection","anchor","rotation","mirror","command","canAuthorizePlacement")){var raw=f.getAsJsonObject("raw").deepCopy();raw.addProperty(key,true);assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.compile(baseline(f),raw,()->false));}
    }
    @Test void cancelledAuditProducesNoCompiledCandidateEvenAfterLocalWork()throws Exception{
        var f=first();var original=baseline(f);assertThrows(java.util.concurrent.CancellationException.class,()->WorldPatchCompiler.compile(original,f.getAsJsonObject("raw"),()->true));
        var count=new AtomicInteger();assertThrows(java.util.concurrent.CancellationException.class,()->WorldPatchCompiler.compile(original,f.getAsJsonObject("raw"),()->count.incrementAndGet()>=3));
    }
    @Test void outputFactsAndGuardsAreImmutableAndCallerJsonCannotMutateCandidate()throws Exception{
        var f=first();var compiled=compile(f);var originalHash=compiled.patchHash();compiled.json().getAsJsonArray("writes").remove(0);f.getAsJsonObject("raw").getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("after","minecraft:gold_block");
        assertEquals(1,compiled.writes().size());assertEquals("minecraft:glass",compiled.writes().get(0).after());assertEquals(originalHash,compiled.patchHash());assertThrows(UnsupportedOperationException.class,()->compiled.writes().clear());assertThrows(UnsupportedOperationException.class,()->compiled.guards().get(0).roles().clear());
    }
    @Test void numericStringsFractionalVersionsAndCoordinatesNeverTruncate()throws Exception{
        var f=first();for(int kind=0;kind<3;kind++){var raw=f.getAsJsonObject("raw").deepCopy();if(kind==0)raw.addProperty("version",1.5);if(kind==1)raw.addProperty("version","1");if(kind==2)raw.getAsJsonArray("operations").get(0).getAsJsonObject().getAsJsonArray("position").set(0,new JsonPrimitive("0"));assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.compile(baseline(f),raw,()->false));}
    }
}
