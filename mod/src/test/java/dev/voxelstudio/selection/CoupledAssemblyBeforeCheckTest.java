package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.lang.reflect.Modifier;
import java.util.concurrent.CancellationException;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic original facts only. No native source/lease or game writes. */
final class CoupledAssemblyBeforeCheckTest {
    private static final class Case {
        final JsonObject fixture;final CoupledAssemblyInput input;final AssemblyCoupledCompiler.Compiled compiled;final SelectionBaseline baseline;final CoupledAssemblyPreview preview;final CoupledAssemblyBeforeCheck.Plan plan;
        Case(String name)throws Exception{this(CoupledAssemblyTestFixtures.fixture(name));}
        Case(JsonObject fixture){this.fixture=fixture;input=CoupledAssemblyTestFixtures.input(fixture);baseline=SelectionBaseline.fromSealedCapture(input.binding().selection(),fixture.getAsJsonObject("capture"));compiled=AssemblyCoupledCompiler.read(baseline,input,()->false);preview=CoupledAssemblyPreview.from(input);plan=CoupledAssemblyBeforeCheck.prepare(compiled,input,preview,()->false);}
    }
    private static final class Source implements CoupledAssemblyBeforeCheck.Source {
        final Case original;final Map<List<Integer>,Object> chunks=new HashMap<>();final Map<SelectionRegion.Point,SelectionScan.BlockFact> overrides=new HashMap<>();final Set<SelectionRegion.Point> visited=new HashSet<>();
        String world,dimension;long selectionRevision,contextRevision,now,latency;int reads,begun,mutateAt;boolean failRead,failBegin,failIdentity,failChunk;Runnable onRead=()->{};
        Source(Case original){this.original=original;var b=original.baseline;world=b.selection.world().worldId();dimension=b.selection.world().dimension();selectionRevision=b.selection.revision();contextRevision=b.contextRevision;for(var value:original.fixture.getAsJsonObject("capture").getAsJsonArray("chunks")){var c=value.getAsJsonObject();if(c.get("coverage").getAsString().equals("known"))chunks.put(List.of(c.get("x").getAsInt(),c.get("z").getAsInt()),new Object());}}
        public void beginStep(){begun++;if(failBegin)throw new IllegalStateException("Synthetic begin failure");}
        public SelectionScan.Identity identity(){if(failIdentity)throw new IllegalStateException("Synthetic identity failure");return new SelectionScan.Identity(world,dimension,selectionRevision,contextRevision);}
        public Object loadedChunk(int x,int z){if(failChunk)throw new IllegalStateException("Synthetic nonloading chunk failure");return chunks.get(List.of(x,z));}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){reads++;assertNotNull(original.baseline.at(p),"Unknown cannot be read as AIR");assertTrue(visited.add(p),"No duplicated per-part BEFORE slabs");now+=latency;if(reads==mutateAt)contextRevision++;onRead.run();if(failRead)throw new IllegalStateException("Synthetic read failure");return overrides.getOrDefault(p,original.baseline.at(p));}
    }
    private CoupledAssemblyBeforeCheck scan(Case c,Source source,int budget){return new CoupledAssemblyBeforeCheck(c.plan,source,budget,2_000_000,()->source.now);}
    private void finish(CoupledAssemblyBeforeCheck check){for(int i=0;i<50000&&check.progress().state()==CoupledAssemblyBeforeCheck.State.CHECKING;i++)check.step();assertNotEquals(CoupledAssemblyBeforeCheck.State.CHECKING,check.progress().state());}
    @Test void multipartDoorChecksOneWholeWAndSixDisjointFacesNotOnlyWrittenCells()throws Exception{
        var c=new Case("door-crosses-8192");var source=new Source(c);var check=scan(c,source,4096);finish(check);assertEquals(CoupledAssemblyBeforeCheck.State.MATCHED,check.progress().state());var result=check.result();assertEquals(2,c.input.parts().size());assertEquals(21248,result.checked());assertEquals(result.checked(),result.known());assertEquals(0,result.unknown());assertEquals(result.known(),source.reads);assertEquals(source.reads,source.visited.size());assertEquals(result.steps()+1,source.begun);assertTrue(result.checked()>c.compiled.writes().size());assertFalse(source.visited.contains(new SelectionRegion.Point(-1,-1,-1)));assertTrue(source.visited.contains(new SelectionRegion.Point(-1,0,0)));assertTrue(source.visited.contains(new SelectionRegion.Point(0,-1,0)));assertFalse(result.canAuthorizePlacement());assertFalse(result.physicsVerified());
    }
    @Test void changedKeepFaceOrEntityConflictsEvenWithoutAnyReportedRevisionChange()throws Exception{
        var c=new Case("complete-new-door");var kept=c.baseline.selection.edit().min();assertNull(c.preview.at(kept));var face=new SelectionRegion.Point(-1,0,0);for(int kind=0;kind<3;kind++){var source=new Source(c);var p=kind==1?face:kept;var before=c.baseline.at(p);source.overrides.put(p,kind==2?new SelectionScan.BlockFact(before.state(),true):new SelectionScan.BlockFact("minecraft:diamond_block",false));var check=scan(c,source,4096);finish(check);assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,check.progress().state());assertThrows(IllegalStateException.class,check::result);}
    }
    @Test void changedOriginalWorldDimensionSelectionOrEpochCannotRefreshTheBefore()throws Exception{
        var c=new Case("complete-new-door");for(int kind=0;kind<4;kind++){var source=new Source(c);var check=scan(c,source,1);check.step();int reads=source.reads;switch(kind){case 0->source.world="different_synthetic_world";case 1->source.dimension="minecraft:the_nether";case 2->source.selectionRevision++;case 3->source.contextRevision++;}check.step();assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,check.progress().state());assertEquals(reads,source.reads);assertThrows(IllegalStateException.class,check::result);}
    }
    @Test void unloadedOrReplacedOriginalChunkFailsDuringScanAndAfterMatchedResult()throws Exception{
        var c=new Case("complete-new-door");for(int kind=0;kind<2;kind++){var source=new Source(c);var check=scan(c,source,1);check.step();if(kind==0)source.chunks.remove(List.of(0,0));else source.chunks.put(List.of(0,0),new Object());finish(check);assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,check.progress().state());}
        var source=new Source(c);var check=scan(c,source,4096);finish(check);check.result();source.chunks.put(List.of(0,0),new Object());assertThrows(IllegalStateException.class,check::result);assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,check.progress().state());
    }
    /** Authored separate SYNTHETIC original capture/input, never a mutation or
     * refreshed binding of a live/paid task. Rebuild all native parts/previews. */
    private Case originalUnknownFace()throws Exception{
        var f=CoupledAssemblyTestFixtures.fixture("complete-new-door");boolean found=false;for(var value:f.getAsJsonObject("capture").getAsJsonArray("chunks")){var c=value.getAsJsonObject();if(c.get("x").getAsInt()==-1&&c.get("z").getAsInt()==0){c.addProperty("coverage","unknown");c.add("palette",new JsonArray());c.add("runs",new JsonArray());found=true;}}assertTrue(found);
        var old=CoupledAssemblyTestFixtures.input(f);var b=SelectionBaseline.fromSealedCapture(old.binding().selection(),f.getAsJsonObject("capture"));var manifest=WorldPatchJson.parse(old.nativeManifest(),()->false);var compiled=AssemblyCoupledCompiler.compile(b,manifest,old.nativeCells(),()->false);var plan=compiled.plan();var set=compiled.patchSet(()->false);var binding=f.getAsJsonObject("binding").deepCopy();for(var key:List.of("snapshotHash","selectionHash","assetHash","cellsHash","analysisHash","scheduleHash"))binding.add(key,plan.get(key));binding.add("couplingPlanHash",plan.get("planHash"));binding.add("patchSetHash",set.get("patchSetHash"));binding.add("partHashes",set.get("partHashes"));var parts=new JsonArray();var previews=new JsonArray();var previewHashes=new JsonArray();
        for(int i=0;i<old.parts().size();i++){var part=compiled.part(i,()->false);var preview=f.getAsJsonArray("previews").get(i).getAsJsonObject().deepCopy();preview.add("snapshotHash",plan.get("snapshotHash"));preview.add("patchHash",part.get("partHash"));preview.add("couplingPlanHash",plan.get("planHash"));preview.remove("previewHash");preview.addProperty("previewHash",SelectionBaseline.hash(preview));parts.add(part);previews.add(preview);previewHashes.add(preview.get("previewHash"));}binding.add("previewHashes",previewHashes);f.add("binding",binding);f.add("parts",parts);f.add("previews",previews);f.add("plan",plan);f.add("patchSet",set);return new Case(f);
    }
    @Test void originalUnknownFaceIsCoverageNeverAirAndLaterLoadingInvalidatesResult()throws Exception{
        var c=originalUnknownFace();var source=new Source(c);var check=scan(c,source,4096);finish(check);assertEquals(CoupledAssemblyBeforeCheck.State.MATCHED,check.progress().state());var result=check.result();assertEquals(102,result.checked());assertEquals(12,result.unknown());assertEquals(90,result.known());assertEquals(90,source.reads);assertTrue(source.visited.stream().noneMatch(p->p.x()==-1));source.chunks.put(List.of(-1,0),new Object());assertThrows(IllegalStateException.class,check::result);assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,check.progress().state());
    }
    @Test void midReadRevisionOrCancellationCannotCountTheChangingCellOrPublishPartialResult()throws Exception{
        var c=new Case("complete-new-door");var source=new Source(c);source.mutateAt=2;var check=scan(c,source,4096);check.step();assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,check.progress().state());assertEquals(1,check.progress().checked());assertEquals(2,source.reads);assertThrows(IllegalStateException.class,check::result);
        var s=new Source(c);var cancelled=scan(c,s,4096);s.onRead=()->{if(s.reads==2)cancelled.cancel();};cancelled.step();assertEquals(CoupledAssemblyBeforeCheck.State.CANCELLED,cancelled.progress().state());assertEquals(1,cancelled.progress().checked());assertThrows(IllegalStateException.class,cancelled::result);var untouched=scan(c,new Source(c),4096);untouched.cancel();assertEquals(0,untouched.step().reads());
    }
    @Test void equalPlanHashBareCompileOrForeignPreviewCannotAcquireOriginalInputBrand()throws Exception{
        var c=new Case("complete-new-door");var data=AssemblyCoupledCompiler.compile(c.baseline,WorldPatchJson.parse(c.input.nativeManifest(),()->false),c.input.nativeCells(),()->false);assertEquals(c.compiled.plan(),data.plan());assertFalse(data.fromOriginalInput(c.input));assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBeforeCheck.prepare(data,c.input,c.preview,()->false));var other=CoupledAssemblyTestFixtures.input(c.fixture);assertEquals(c.input.binding(),other.binding());assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBeforeCheck.prepare(c.compiled,other,CoupledAssemblyPreview.from(other),()->false));assertThrows(IllegalArgumentException.class,()->CoupledAssemblyBeforeCheck.prepare(c.compiled,c.input,CoupledAssemblyPreview.from(other),()->false));assertThrows(CancellationException.class,()->CoupledAssemblyBeforeCheck.prepare(c.compiled,c.input,c.preview,()->true));for(var constructor:CoupledAssemblyBeforeCheck.Plan.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
    }
    @Test void boundedSlowReadFailuresAndResultRevalidationArePermanentWithoutRetry()throws Exception{
        var c=new Case("complete-new-door");var slow=new Source(c);slow.latency=2_100_000;var bounded=scan(c,slow,4096);bounded.step();assertEquals(1,bounded.progress().checked());assertEquals(2_100_000,bounded.progress().maxStepNanos());finish(bounded);assertEquals(CoupledAssemblyBeforeCheck.State.MATCHED,bounded.progress().state());bounded.cancel();assertThrows(IllegalStateException.class,bounded::result);
        for(int kind=0;kind<4;kind++){var s=new Source(c);switch(kind){case 0->s.failRead=true;case 1->s.failBegin=true;case 2->s.failIdentity=true;case 3->s.failChunk=true;}var check=scan(c,s,4096);finish(check);assertEquals(CoupledAssemblyBeforeCheck.State.FAILED,check.progress().state());assertThrows(IllegalStateException.class,check::result);}
        var s=new Source(c);var matched=scan(c,s,4096);finish(matched);s.contextRevision++;assertThrows(IllegalStateException.class,matched::result);assertEquals(CoupledAssemblyBeforeCheck.State.CONFLICT,matched.progress().state());
    }
}
