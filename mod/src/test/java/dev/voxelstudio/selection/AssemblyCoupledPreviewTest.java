package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Whole-plan preview identity/geometry only. No renderer, Iris, live world,
 * confirmation, writer or complete-game acceptance is substituted here. */
final class AssemblyCoupledPreviewTest {
    private static JsonObject data;
    @BeforeAll static void init()throws Exception{data=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-coupled.json"))).getAsJsonObject();}
    private JsonObject fixture(String name){for(var row:data.getAsJsonArray("valid"))if(row.getAsJsonObject().get("name").getAsString().equals(name))return row.getAsJsonObject();throw new AssertionError(name);}
    private SelectionRegion region(JsonObject v){return new SelectionRegion(WorldPatchJson.point(v.get("min")),WorldPatchJson.point(v.get("max")));}
    private SelectionBaseline baseline(JsonObject f){
        var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var ps=new ArrayList<SelectionRegion>();for(var p:s.getAsJsonArray("protected"))ps.add(region(p.getAsJsonObject()));
        return SelectionBaseline.fromSealedCapture(new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),ps),f.getAsJsonObject("capture"));
    }
    private AssemblyCoupledCompiler.Compiled compile(JsonObject f){return AssemblyCoupledCompiler.compile(baseline(f),f.getAsJsonObject("manifest"),Base64.getDecoder().decode(f.get("cellsBase64").getAsString()),()->false);}
    private byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private String rehash(JsonObject v){v.remove("previewHash");String h=SelectionBaseline.hash(v);v.addProperty("previewHash",h);return h;}
    private WorldPatchPreview.Binding binding(AssemblyCoupledCompiler.Compiled c,JsonObject v){return c.previewBinding(0,v.get("previewHash").getAsString(),()->false);}
    private JsonObject preview(JsonObject f){return f.getAsJsonArray("previews").get(0).getAsJsonObject().deepCopy();}

    @Test void fullNativeVerificationAcceptsAllNewDisplaysButDoesNotGrantWrites(){
        for(var row:data.getAsJsonArray("valid")){
            var f=row.getAsJsonObject();var c=compile(f);
            for(int i=0;i<c.partCount();i++){
                var v=f.getAsJsonArray("previews").get(i).getAsJsonObject();var b=c.previewBinding(i,v.get("previewHash").getAsString(),()->false);var p=WorldPatchPreview.parse(bytes(v),b);
                c.verifyPreview(i,p,b,()->false);assertTrue(p.binding().coupled());assertFalse(p.canAuthorizePlacement());assertFalse(p.movable());
                assertEquals(c.part(i,()->false).getAsJsonArray("writes").size(),p.totalWrites());
            }
        }
    }
    @Test void legacyAndCoupledExpectedBindingsCannotSilentlySwitchProtocolVersions(){
        var f=fixture("complete-new-door");var c=compile(f);var v=preview(f);var b=binding(c,v);
        var legacy=new WorldPatchPreview.Binding(b.selection(),b.contextRevision(),b.snapshotHash(),b.selectionHash(),b.patchHash(),b.previewHash());
        assertFalse(legacy.coupled());assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bytes(v),legacy));
        v.remove("couplingPlanHash");v.remove("couplingPolicyHash");v.addProperty("version",1);v.addProperty("policy","static-patch-preview-data-v1");rehash(v);
        assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bytes(v),binding(c,v)));
        assertThrows(IllegalArgumentException.class,()->new WorldPatchPreview.Binding(b.selection(),b.contextRevision(),b.snapshotHash(),b.selectionHash(),b.patchHash(),b.previewHash(),b.couplingPlanHash(),null));
    }
    @Test void callerRehashedGeometryMayParseReadonlyButCannotMatchTheServerWholeNative(){
        var f=fixture("complete-new-door");var c=compile(f);var v=preview(f);var palette=v.getAsJsonArray("palette");
        for(int i=0;i<palette.size();i++)if(palette.get(i).getAsString().equals("minecraft:stone"))palette.set(i,new JsonPrimitive("minecraft:glass"));
        rehash(v);var b=binding(c,v);var p=WorldPatchPreview.parse(bytes(v),b);
        assertFalse(p.canAuthorizePlacement());assertThrows(IllegalArgumentException.class,()->c.verifyPreview(0,p,b,()->false));
    }
    @Test void callerRehashedPlanOrPolicyCannotReplaceCompleteServerIdentity(){
        var f=fixture("complete-new-door");var c=compile(f);
        for(String key:List.of("couplingPlanHash","couplingPolicyHash")){
            var v=preview(f);v.addProperty(key,"0".repeat(64));rehash(v);var original=binding(c,v);
            var forged=new WorldPatchPreview.Binding(original.selection(),original.contextRevision(),original.snapshotHash(),original.selectionHash(),original.patchHash(),original.previewHash(),v.get("couplingPlanHash").getAsString(),v.get("couplingPolicyHash").getAsString());
            var p=WorldPatchPreview.parse(bytes(v),forged);assertThrows(IllegalArgumentException.class,()->c.verifyPreview(0,p,forged,()->false));
        }
    }
    @Test void coupledParserRejectsDuplicateFieldsLossyUtf8AndUnusedPalette(){
        var f=fixture("complete-new-door");var c=compile(f);var v=preview(f);var b=binding(c,v);
        byte[] duplicate=("{\"version\":2,"+v.toString().substring(1)).getBytes(StandardCharsets.UTF_8);
        assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(duplicate,b));
        byte[] bad=bytes(v);bad[0]=(byte)255;assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bad,b));
        v.getAsJsonArray("palette").add("minecraft:zz_unused");rehash(v);assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bytes(v),binding(c,v)));
    }
    @Test void flagsExtraFieldsAndExplicitKeepsCannotBroadenCoupledPreviewMeaning(){
        var f=fixture("complete-new-door");var c=compile(f);
        for(String flag:List.of("movable","canAuthorizePlacement","serverBaselineVerified","physicsVerified","worldRendered")){
            var v=preview(f);v.addProperty(flag,true);rehash(v);assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bytes(v),binding(c,v)),flag);
        }
        var keeps=preview(f);keeps.getAsJsonObject("summary").addProperty("explicitKeeps",1);rehash(keeps);assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bytes(keeps),binding(c,keeps)));
        var extra=preview(f);extra.addProperty("allowPartialApplication",true);rehash(extra);assertThrows(IllegalArgumentException.class,()->WorldPatchPreview.parse(bytes(extra),binding(c,extra)));
    }
    @Test void aStructurallyValidNewPreviewCannotBeAdoptedByLegacyCompilerOrWholePart(){
        var f=fixture("static-only");var b=baseline(f);var c=compile(f);var v=preview(f);
        var proposal=new JsonObject();proposal.addProperty("format","WorldPatchProposal");proposal.addProperty("version",1);proposal.addProperty("snapshotHash",b.snapshotHash);proposal.addProperty("selectionHash",b.selectionHash);
        var op=new JsonObject();op.addProperty("op","set");op.add("position",c.writes().get(0).position().json());op.addProperty("before","minecraft:air");op.addProperty("after","minecraft:glass");var ops=new JsonArray();ops.add(op);proposal.add("operations",ops);
        var legacy=WorldPatchCompiler.compile(b,proposal,()->false);v.addProperty("patchHash",legacy.patchHash());rehash(v);
        var expected=new WorldPatchPreview.Binding(b.selection,b.contextRevision,b.snapshotHash,b.selectionHash,legacy.patchHash(),v.get("previewHash").getAsString(),v.get("couplingPlanHash").getAsString(),v.get("couplingPolicyHash").getAsString());
        var p=WorldPatchPreview.parse(bytes(v),expected);
        assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.verifyPreview(legacy,p,expected));
        assertThrows(IllegalArgumentException.class,()->WorldPatchCompiler.read(b,bytes(proposal),expected,SelectionBaseline.hash(proposal),()->false));
        assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput.Part(0,bytes(proposal),bytes(legacy.json()),p,bytes(v)));
    }
    @Test void layersAreReadonlyImmutableAndCancellationDoesNotReturnPartialRows(){
        var f=fixture("door-crosses-8192");var c=compile(f);var v=preview(f);var b=binding(c,v);var p=WorldPatchPreview.parse(bytes(v),b);
        assertThrows(UnsupportedOperationException.class,()->p.sections().clear());assertThrows(UnsupportedOperationException.class,()->p.palette().clear());
        assertTrue(p.visible(new WorldPatchPreview.Filter(WorldPatchPreview.Mode.AFTER,0,1,EnumSet.allOf(WorldPatchPreview.Difference.class))).size()>0);
        assertThrows(java.util.concurrent.CancellationException.class,()->WorldPatchPreview.parse(bytes(v),b,()->true));
        var calls=new AtomicInteger();assertThrows(java.util.concurrent.CancellationException.class,()->WorldPatchPreview.parse(bytes(v),b,()->calls.incrementAndGet()>4));
        assertThrows(java.util.concurrent.CancellationException.class,()->c.verifyPreview(0,p,b,()->true));
    }
}
