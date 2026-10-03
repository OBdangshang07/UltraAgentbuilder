package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Node-produced production snapshot/patch fixtures, then independent Java
 * comparison against a read-only fake source. NOT a live-server/game test. */
final class WorldPatchBeforeCheckTest {
    private SelectionRegion.Point point(JsonArray value){return new SelectionRegion.Point(value.get(0).getAsInt(),value.get(1).getAsInt(),value.get(2).getAsInt());}
    private SelectionRegion region(JsonObject value){return new SelectionRegion(point(value.getAsJsonArray("min")),point(value.getAsJsonArray("max")));}
    private WorldSelection selection(JsonObject value){
        var w=value.getAsJsonObject("world");var protectedRegions=new ArrayList<SelectionRegion>();for(var r:value.getAsJsonArray("protected"))protectedRegions.add(region(r.getAsJsonObject()));
        return new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),value.get("revision").getAsLong(),region(value.getAsJsonObject("context")),region(value.getAsJsonObject("edit")),protectedRegions);
    }
    private JsonObject fixture(int index)throws Exception{
        var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/world-patch-before.json"))).getAsJsonObject();
        assertEquals(0,f.get("realModelCalls").getAsInt());assertEquals(0,f.get("worldWrites").getAsInt());return f.getAsJsonArray("cases").get(index).getAsJsonObject();
    }
    private WorldPatchPreview preview(JsonObject fixture,WorldSelection selection){
        var v=fixture.getAsJsonObject("preview");var b=new WorldPatchPreview.Binding(selection,v.get("contextRevision").getAsLong(),v.get("snapshotHash").getAsString(),v.get("selectionHash").getAsString(),v.get("patchHash").getAsString(),v.get("previewHash").getAsString());
        return WorldPatchPreview.parse(v.toString().getBytes(StandardCharsets.UTF_8),b);
    }
    private final class Case {
        final JsonObject data;final SelectionBaseline baseline;final WorldPatchPreview preview;final WorldPatchBeforeCheck.Plan plan;
        Case(int index)throws Exception{data=fixture(index);var selection=selection(data.getAsJsonObject("selection"));baseline=SelectionBaseline.fromSealedCapture(selection,data.getAsJsonObject("capture"));preview=preview(data,selection);plan=WorldPatchBeforeCheck.prepare(baseline,preview);}
    }
    private static final class Source implements WorldPatchBeforeCheck.Source {
        final SelectionBaseline baseline;final Map<String,Boolean> coverage=new HashMap<>();final Map<SelectionRegion.Point,SelectionScan.BlockFact> overrides=new HashMap<>();
        final List<SelectionRegion.Point> points=new ArrayList<>();long revision,selector,now,latency;String world,dimension;int readCalls,begunSteps,mutateAtRead;boolean failRead,failStep;
        Source(SelectionBaseline b,JsonObject capture){baseline=b;revision=b.contextRevision;selector=b.selection.revision();world=b.selection.world().worldId();dimension=b.selection.world().dimension();
            for(var item:capture.getAsJsonArray("chunks")){var c=item.getAsJsonObject();coverage.put(c.get("x").getAsInt()+","+c.get("z").getAsInt(),c.get("coverage").getAsString().equals("known"));}
        }
        public void beginStep(){begunSteps++;if(failStep)throw new IllegalStateException("fixture step failure");}
        public SelectionScan.Identity identity(){return new SelectionScan.Identity(world,dimension,selector,revision);}
        public boolean loaded(int x,int z){return Boolean.TRUE.equals(coverage.get(x+","+z));}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){readCalls++;points.add(p);now+=latency;if(mutateAtRead==readCalls)revision++;if(failRead)throw new IllegalStateException("fixture read failure");return overrides.getOrDefault(p,baseline.at(p));}
    }
    private Source source(Case c){return new Source(c.baseline,c.data.getAsJsonObject("capture"));}
    private WorldPatchBeforeCheck scan(Case c,Source s,int cells){return new WorldPatchBeforeCheck(c.plan,s,cells,2_000_000,()->s.now);}
    private WorldPatchBeforeCheck.Progress finish(WorldPatchBeforeCheck scan){for(int i=0;i<1000;i++){var p=scan.step();if(p.state()!=WorldPatchBeforeCheck.State.CHECKING)return p;}throw new AssertionError("BEFORE comparison did not terminate");}
    @Test void serverHashesIndependentlyMatchBothNodeProductionSnapshots()throws Exception{
        for(int index=0;index<2;index++){var c=new Case(index);assertEquals(c.data.get("snapshotHash").getAsString(),c.baseline.snapshotHash);assertEquals(c.data.get("selectionHash").getAsString(),c.baseline.selectionHash);
            for(var item:c.data.getAsJsonArray("facts")){var v=item.getAsJsonObject();var expected=v.getAsJsonObject("fact");var actual=c.baseline.at(point(v.getAsJsonArray("position")));
                if(expected.get("coverage").getAsString().equals("unknown"))assertNull(actual);else{assertEquals(expected.get("state").getAsString(),actual.state());assertEquals(expected.get("blockEntity").getAsBoolean(),actual.blockEntity());}
            }
        }
    }
    @Test void completeReadChecksWholeWAndSixDisjointCapturedFaceSlabs()throws Exception{
        var c=new Case(0);var s=source(c);var check=scan(c,s,3);assertEquals(3,check.step().checked());assertEquals(WorldPatchBeforeCheck.State.MATCHED,finish(check).state());
        var result=check.result();assertEquals(56,result.checked());assertEquals(56,result.known());assertEquals(0,result.unknown());assertEquals(56,s.readCalls);assertEquals(56,new HashSet<>(s.points).size());
        assertEquals(result.steps(),s.begunSteps);assertEquals(c.preview.binding(),result.binding());assertFalse(result.canAuthorizePlacement());assertFalse(result.physicsVerified());
        assertTrue(s.points.contains(new SelectionRegion.Point(-2,-1,-1)));assertFalse(s.points.contains(new SelectionRegion.Point(-3,-2,-2)));
    }
    @Test void unknownCellsAreComparedAsCoverageNeverReadLoadedOrAir()throws Exception{
        var c=new Case(1);var s=source(c);var check=scan(c,s,7);assertEquals(WorldPatchBeforeCheck.State.MATCHED,finish(check).state());var result=check.result();
        assertTrue(result.unknown()>0);assertEquals(result.known(),s.readCalls);assertEquals(result.known()+result.unknown(),result.checked());
        assertTrue(s.points.stream().noneMatch(p->p.x()>=16));assertFalse(result.canAuthorizePlacement());
    }
    @Test void changedAndRestoredContextRevisionStillRefusesWithoutRestart()throws Exception{
        var c=new Case(0);var s=source(c);var check=scan(c,s,1);check.step();s.revision+=2;
        assertEquals(WorldPatchBeforeCheck.State.CONFLICT,check.step().state());assertEquals(1,s.readCalls);check.step();assertEquals(1,s.readCalls);assertThrows(IllegalStateException.class,check::result);
    }
    @Test void unchangedCounterCannotHideChangedBeforeOrBlockEntityCapability()throws Exception{
        for(boolean entity:new boolean[]{false,true}){var c=new Case(0);var s=source(c);s.overrides.put(new SelectionRegion.Point(0,0,0),new SelectionScan.BlockFact(entity?"minecraft:stone":"minecraft:glass",entity));var check=scan(c,s,4096);
            assertEquals(WorldPatchBeforeCheck.State.CONFLICT,finish(check).state());assertThrows(IllegalStateException.class,check::result);
        }
    }
    @Test void keptWAndReadOnlyNeighborFactsAreAlsoChecked()throws Exception{
        for(var point:List.of(new SelectionRegion.Point(-2,-1,-1),new SelectionRegion.Point(2,0,0))){var c=new Case(0);var s=source(c);s.overrides.put(point,new SelectionScan.BlockFact("minecraft:glass",false));var check=scan(c,s,4096);
            assertEquals(WorldPatchBeforeCheck.State.CONFLICT,finish(check).state());assertThrows(IllegalStateException.class,check::result);
        }
    }
    @Test void unloadAndNewlyKnownCoverageCannotSubstituteBaseline()throws Exception{
        for(int index=0;index<2;index++){var c=new Case(index);var s=source(c);s.coverage.put(index==0?"0,0":"1,0",index!=0);var check=scan(c,s,4096);
            assertEquals(WorldPatchBeforeCheck.State.CONFLICT,finish(check).state());assertThrows(IllegalStateException.class,check::result);
        }
    }
    @Test void dimensionWorldAndSelectionChangesFailBeforeAnyNewReads()throws Exception{
        for(int kind=0;kind<3;kind++){var c=new Case(0);var s=source(c);var check=scan(c,s,1);check.step();if(kind==0)s.world="changed";if(kind==1)s.dimension="minecraft:the_nether";if(kind==2)s.selector++;
            assertEquals(WorldPatchBeforeCheck.State.CONFLICT,check.step().state());assertEquals(1,s.readCalls);
        }
    }
    @Test void midReadRevisionChangeCannotReturnMatchedOrCountTheChangingCell()throws Exception{
        var c=new Case(0);var s=source(c);s.mutateAtRead=2;var check=scan(c,s,4096);assertEquals(WorldPatchBeforeCheck.State.CONFLICT,check.step().state());assertEquals(1,check.progress().checked());assertEquals(2,s.readCalls);assertThrows(IllegalStateException.class,check::result);
    }
    @Test void completeResultIsInvalidatedByLaterSourceChange()throws Exception{
        var c=new Case(0);var s=source(c);var check=scan(c,s,4096);finish(check);assertFalse(check.result().canAuthorizePlacement());s.revision++;
        assertThrows(IllegalStateException.class,check::result);assertEquals(WorldPatchBeforeCheck.State.CONFLICT,check.progress().state());
    }
    @Test void cooperativeTimeBudgetDoesNotClaimPreemption()throws Exception{
        var c=new Case(0);var s=source(c);s.latency=3_000_000;var check=scan(c,s,4096);var p=check.step();assertEquals(1,p.checked());assertEquals(3_000_000,p.maxStepNanos());assertEquals(WorldPatchBeforeCheck.State.CHECKING,p.state());
    }
    @Test void cancellationAndSourceFailuresCannotPublishOrResume()throws Exception{
        var c=new Case(0);var s=source(c);var check=scan(c,s,1);check.step();check.cancel();assertEquals(WorldPatchBeforeCheck.State.CANCELLED,check.step().state());assertEquals(1,s.readCalls);assertThrows(IllegalStateException.class,check::result);
        for(boolean failStep:new boolean[]{false,true}){var bad=source(c);bad.failStep=failStep;bad.failRead=!failStep;var failed=scan(c,bad,1);assertEquals(WorldPatchBeforeCheck.State.FAILED,failed.step().state());failed.step();assertEquals(failStep?0:1,bad.readCalls);assertThrows(IllegalStateException.class,failed::result);}
    }
    @Test void changedSnapshotHashCannotRebaseOriginalCandidate()throws Exception{
        var c=new Case(0);var raw=c.data.getAsJsonObject("capture").deepCopy();raw.getAsJsonObject("fence").addProperty("start",10);raw.getAsJsonObject("fence").addProperty("end",10);
        var replacement=SelectionBaseline.fromSealedCapture(c.baseline.selection,raw);assertNotEquals(c.baseline.snapshotHash,replacement.snapshotHash);assertThrows(IllegalArgumentException.class,()->WorldPatchBeforeCheck.prepare(replacement,c.preview));
    }
    @Test void attackerRehashedPreviewBeforeMustMatchOriginalServerFacts()throws Exception{
        var c=new Case(0);var f=c.data.deepCopy();var v=f.getAsJsonObject("preview");var p=v.getAsJsonArray("palette");p.set(1,new JsonPrimitive("minecraft:stone_bricks"));v.remove("previewHash");v.addProperty("previewHash",SelectionBaseline.hash(v));
        var changed=preview(f,c.baseline.selection);assertThrows(IllegalArgumentException.class,()->WorldPatchBeforeCheck.prepare(c.baseline,changed));
    }
    @Test void cancelledPreparationDoesNotReturnAPlan()throws Exception{var c=new Case(0);assertThrows(java.util.concurrent.CancellationException.class,()->WorldPatchBeforeCheck.prepare(c.baseline,c.preview,()->true));}
    @Test void baselineOwnsImmutableFactsNotMutableCaptureJson()throws Exception{
        var c=new Case(0);var p=new SelectionRegion.Point(0,0,0);assertEquals("minecraft:stone",c.baseline.at(p).state());
        c.data.getAsJsonObject("capture").getAsJsonArray("chunks").get(3).getAsJsonObject().getAsJsonArray("palette").get(0).getAsJsonObject().addProperty("state","minecraft:glass");
        assertEquals("minecraft:stone",c.baseline.at(p).state());assertThrows(UnsupportedOperationException.class,()->c.baseline.checkRegions().clear());
    }
    @Test void incompleteFractionalAndUnusedSealedRunsAreRejected()throws Exception{
        var c=new Case(0);for(int kind=0;kind<4;kind++){var raw=c.data.getAsJsonObject("capture").deepCopy();var chunk=raw.getAsJsonArray("chunks").get(0).getAsJsonObject();
            if(kind==0)raw.getAsJsonArray("chunks").remove(0);if(kind==1)chunk.getAsJsonArray("runs").get(0).getAsJsonArray().set(1,new JsonPrimitive(1.5));if(kind==2)chunk.getAsJsonArray("runs").get(0).getAsJsonArray().set(1,new JsonPrimitive(1));if(kind==3){var item=new JsonObject();item.addProperty("state","minecraft:glass");item.addProperty("blockEntity",false);chunk.getAsJsonArray("palette").add(item);}
            assertThrows(IllegalArgumentException.class,()->SelectionBaseline.fromSealedCapture(c.baseline.selection,raw));
        }
    }
    @Test void readBudgetCannotExpandBeyondPerTickLimits()throws Exception{
        var c=new Case(0);var s=source(c);assertThrows(IllegalArgumentException.class,()->new WorldPatchBeforeCheck(c.plan,s,4097,2_000_000,()->0));assertThrows(IllegalArgumentException.class,()->new WorldPatchBeforeCheck(c.plan,s,1,2_000_001,()->0));
    }
}
