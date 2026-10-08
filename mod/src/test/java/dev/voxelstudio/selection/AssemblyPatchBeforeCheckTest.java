package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Production synthetic whole transport and read-only fake world only.
 * Not real game, physics, model understanding or final placement acceptance. */
final class AssemblyPatchBeforeCheckTest {
    private static final class Case {
        final JsonObject fixture;
        final SelectionBaseline baseline;
        final AssemblyPatchInput input;
        final AssemblyPatchCompiler.Compiled compiled;
        final AssemblyPatchPreview preview;
        final AssemblyPatchBeforeCheck.Plan plan;
        Case(String tier)throws Exception{
            fixture=AssemblyPatchFixtures.header(tier);baseline=AssemblyPatchFixtures.baseline(fixture);input=AssemblyPatchFixtures.input(fixture);
            compiled=AssemblyPatchCompiler.compile(baseline,input,()->false);preview=AssemblyPatchPreview.from(input);plan=AssemblyPatchBeforeCheck.prepare(compiled,preview,()->false);
        }
        Case(JsonObject fixture,SelectionBaseline baseline,AssemblyPatchInput input){
            this.fixture=fixture;this.baseline=baseline;this.input=input;
            compiled=AssemblyPatchCompiler.compile(baseline,input,()->false);preview=AssemblyPatchPreview.from(input);plan=AssemblyPatchBeforeCheck.prepare(compiled,preview,()->false);
        }
    }
    private static final class Source implements AssemblyPatchBeforeCheck.Source {
        final SelectionBaseline baseline;
        final Map<List<Integer>,Boolean> coverage=new HashMap<>();
        final Map<SelectionRegion.Point,SelectionScan.BlockFact> overrides=new HashMap<>();
        final Set<SelectionRegion.Point> visited=new HashSet<>();
        long contextRevision,selectionRevision,now,latency;
        String world,dimension;
        int reads,begun,mutateAtRead;
        boolean failRead,failStep,failIdentity;
        Source(Case c){
            baseline=c.baseline;contextRevision=baseline.contextRevision;selectionRevision=baseline.selection.revision();world=baseline.selection.world().worldId();dimension=baseline.selection.world().dimension();
            var capture=JsonParser.parseString(c.fixture.get("payload").getAsString()).getAsJsonObject().getAsJsonObject("capture");
            for(var item:capture.getAsJsonArray("chunks")){var chunk=item.getAsJsonObject();coverage.put(List.of(chunk.get("x").getAsInt(),chunk.get("z").getAsInt()),chunk.get("coverage").getAsString().equals("known"));}
        }
        public void beginStep(){begun++;if(failStep)throw new IllegalStateException("synthetic whole begin failure");}
        public SelectionScan.Identity identity(){if(failIdentity)throw new IllegalStateException("synthetic whole identity failure");return new SelectionScan.Identity(world,dimension,selectionRevision,contextRevision);}
        public boolean loaded(int x,int z){return Boolean.TRUE.equals(coverage.get(List.of(x,z)));}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){reads++;assertTrue(visited.add(p),"Whole BEFORE must not reread per-part slabs");now+=latency;if(reads==mutateAtRead)contextRevision++;if(failRead)throw new IllegalStateException("synthetic whole read failure");return overrides.getOrDefault(p,baseline.at(p));}
    }
    private AssemblyPatchBeforeCheck scan(Case c,Source source,int budget){return new AssemblyPatchBeforeCheck(c.plan,source,budget,2_000_000,()->source.now);}
    private AssemblyPatchBeforeCheck.Progress finish(AssemblyPatchBeforeCheck check){
        for(int i=0;i<10_000;i++){var result=check.step();if(result.state()!=AssemblyPatchBeforeCheck.State.CHECKING)return result;}
        throw new AssertionError("Original whole BEFORE did not terminate");
    }
    @Test void whole224MetreSevenPartCandidateChecksOneCompleteWAndSixDisjointFaces()throws Exception{
        var c=new Case("ultra");var source=new Source(c);var check=scan(c,source,4096);
        assertEquals(AssemblyPatchBeforeCheck.State.MATCHED,finish(check).state());var result=check.result();
        assertEquals(7,c.input.parts().size());assertEquals(54406,c.compiled.writes().size());assertEquals(224,c.baseline.selection.edit().max().y()-c.baseline.selection.edit().min().y());
        assertEquals(260096,result.checked());assertEquals(result.checked(),result.known()+result.unknown());assertEquals(result.known(),source.reads);assertEquals(result.steps(),source.begun);assertTrue(result.steps()>1);
        assertEquals(c.input.binding(),result.binding());assertSame(c.compiled,c.plan.compiled);assertSame(c.baseline,c.plan.baseline);assertFalse(result.canAuthorizePlacement());assertFalse(result.physicsVerified());
        assertTrue(source.visited.contains(new SelectionRegion.Point(-17,-40,-16)));assertTrue(source.visited.contains(new SelectionRegion.Point(-16,-41,-16)));assertFalse(source.visited.contains(new SelectionRegion.Point(-17,-41,-17)));
    }
    @Test void keptCellsAndTightlyAdjacentFacesAreComparedEvenWithoutAWrite()throws Exception{
        var c=new Case("lite");var kept=c.baseline.selection.edit().min();
        outer:for(int y=kept.y();y<c.baseline.selection.edit().max().y();y++)for(int z=kept.z();z<c.baseline.selection.edit().max().z();z++)for(int x=kept.x();x<c.baseline.selection.edit().max().x();x++){
            var p=new SelectionRegion.Point(x,y,z);if(c.preview.at(p)==null){kept=p;break outer;}
        }
        assertNull(c.preview.at(kept));var edge=new SelectionRegion.Point(c.baseline.selection.edit().min().x()-1,c.baseline.selection.edit().min().y(),c.baseline.selection.edit().min().z());
        for(var p:List.of(kept,edge)){
            var source=new Source(c);var before=c.baseline.at(p);assertNotNull(before);source.overrides.put(p,new SelectionScan.BlockFact(before.state().equals("minecraft:glass")?"minecraft:stone":"minecraft:glass",false));
            var check=scan(c,source,4096);assertEquals(AssemblyPatchBeforeCheck.State.CONFLICT,finish(check).state());assertThrows(IllegalStateException.class,check::result);
        }
    }
    @Test void environmentWorldDimensionAndSelectionChangesNeverRefreshTheWholeBaseline()throws Exception{
        var c=new Case("lite");for(int kind=0;kind<4;kind++){
            var source=new Source(c);var check=scan(c,source,1);check.step();int reads=source.reads;
            switch(kind){case 0->source.contextRevision++;case 1->source.world="other_synthetic_world";case 2->source.dimension="minecraft:the_nether";case 3->source.selectionRevision++;}
            assertEquals(AssemblyPatchBeforeCheck.State.CONFLICT,check.step().state());assertEquals(reads,source.reads);assertThrows(IllegalStateException.class,check::result);assertEquals(AssemblyPatchBeforeCheck.State.CONFLICT,check.step().state());
        }
    }
    @Test void changedBeforeEntityOrUnloadedChunkFailsEvenWithUnchangedRevision()throws Exception{
        var c=new Case("lite");var p=c.baseline.selection.edit().min();
        for(int kind=0;kind<3;kind++){
            var source=new Source(c);switch(kind){
                case 0->source.overrides.put(p,new SelectionScan.BlockFact(c.baseline.at(p).state().equals("minecraft:glass")?"minecraft:stone":"minecraft:glass",false));
                case 1->source.overrides.put(p,new SelectionScan.BlockFact(c.baseline.at(p).state(),true));
                case 2->source.coverage.put(List.of(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16)),false);
            }
            var check=scan(c,source,4096);assertEquals(AssemblyPatchBeforeCheck.State.CONFLICT,finish(check).state());assertThrows(IllegalStateException.class,check::result);
        }
    }
    @Test void changedUnknownCoverageCannotRefreshAnExistingOriginalWholeCandidate()throws Exception{
        var fixture=AssemblyPatchFixtures.header("lite");var selection=AssemblyPatchFixtures.selection(fixture);var payload=JsonParser.parseString(fixture.get("payload").getAsString()).getAsJsonObject();
        // A chunk strictly outside W and all write-neighbor guards can be
        // unknown in the original context. Compile against that ORIGINAL
        // sealed synthetic capture, never substitute it into a live job.
        var chunks=payload.getAsJsonObject("capture").getAsJsonArray("chunks");JsonObject chosen=null;
        for(var value:chunks){var chunk=value.getAsJsonObject();int x=chunk.get("x").getAsInt(),z=chunk.get("z").getAsInt();if(x==-2&&z==0){chosen=chunk;break;}}
        assertNotNull(chosen);chosen.addProperty("coverage","unknown");chosen.add("palette",new JsonArray());chosen.add("runs",new JsonArray());
        var baseline=SelectionBaseline.fromSealedCapture(selection,payload.getAsJsonObject("capture"));
        assertNotEquals(AssemblyPatchFixtures.baseline(fixture).snapshotHash,baseline.snapshotHash);
        // The existing candidate must refuse a replacement unknown snapshot.
        var input=AssemblyPatchFixtures.input(fixture);assertThrows(IllegalArgumentException.class,()->AssemblyPatchCompiler.compile(baseline,input,()->false));
    }
    /** A separate LOCALLY AUTHORED original unknown capture/proposal branch,
     * not checked client FINAL metadata/SEND, a real job, or any replacement
     * of the complete production control fixtures read from disk. */
    private Case originalUnknownBoundary()throws Exception{
        var fixture=AssemblyPatchFixtures.header("lite");var original=AssemblyPatchFixtures.input(fixture);var envelope=AssemblyPatchFixtures.part(fixture,0);
        var payload=JsonParser.parseString(fixture.get("payload").getAsString()).getAsJsonObject();boolean found=false;
        for(var value:payload.getAsJsonObject("capture").getAsJsonArray("chunks")){
            var chunk=value.getAsJsonObject();if(chunk.get("x").getAsInt()==0&&chunk.get("z").getAsInt()==-1){
                chunk.addProperty("coverage","unknown");chunk.add("palette",new JsonArray());chunk.add("runs",new JsonArray());found=true;break;
            }
        }
        assertTrue(found);fixture.addProperty("payload",payload.toString());var baseline=AssemblyPatchFixtures.baseline(fixture);
        var raw=WorldPatchJson.parse(original.parts().get(0).proposal(),()->false);raw.addProperty("snapshotHash",baseline.snapshotHash);
        var rebuilt=WorldPatchCompiler.compile(baseline,raw,()->false);envelope.add("patch",rebuilt.json());
        var preview=envelope.getAsJsonObject("preview");preview.addProperty("snapshotHash",baseline.snapshotHash);preview.addProperty("patchHash",rebuilt.patchHash());preview.remove("previewHash");preview.addProperty("previewHash",SelectionBaseline.hash(preview));
        var c=fixture.getAsJsonObject("metadata").getAsJsonObject("candidate");var set=fixture.getAsJsonObject("metadata").getAsJsonObject("patchSet");
        set.addProperty("snapshotHash",baseline.snapshotHash);set.getAsJsonArray("partHashes").set(0,new JsonPrimitive(rebuilt.patchHash()));set.remove("patchSetHash");set.addProperty("patchSetHash",SelectionBaseline.hash(set));
        c.addProperty("snapshotHash",baseline.snapshotHash);c.add("patchSetHash",set.get("patchSetHash"));c.getAsJsonArray("previewHashes").set(0,preview.get("previewHash"));c.remove("candidateHash");c.addProperty("candidateHash",SelectionBaseline.hash(c));
        var input=new AssemblyPatchInput(AssemblyPatchFixtures.binding(fixture),List.of(AssemblyPatchFixtures.transport(fixture,0,envelope)));return new Case(fixture,baseline,input);
    }
    @Test void originalUnknownBoundaryIsComparedAsCoverageNeverReadLoadedOrAssumedAir()throws Exception{
        var c=originalUnknownBoundary();var source=new Source(c);var check=scan(c,source,4096);assertEquals(AssemblyPatchBeforeCheck.State.MATCHED,finish(check).state());var result=check.result();
        assertEquals(3712,result.checked());assertEquals(160,result.unknown());assertEquals(3552,result.known());assertEquals(result.known(),source.reads);assertTrue(source.visited.stream().noneMatch(p->p.x()==0&&p.z()<0));assertFalse(result.canAuthorizePlacement());
        var changed=new Source(c);changed.coverage.put(List.of(0,-1),true);var conflict=scan(c,changed,4096);assertEquals(AssemblyPatchBeforeCheck.State.CONFLICT,finish(conflict).state());assertThrows(IllegalStateException.class,conflict::result);
    }
    @Test void midReadChangeCannotPublishOrCountTheChangingCell()throws Exception{
        var c=new Case("lite");var source=new Source(c);source.mutateAtRead=2;var check=scan(c,source,4096);
        assertEquals(AssemblyPatchBeforeCheck.State.CONFLICT,check.step().state());assertEquals(1,check.progress().checked());assertEquals(2,source.reads);assertThrows(IllegalStateException.class,check::result);
    }
    @Test void resultRevalidationAndIdentityFailurePermanentlyInvalidateMatchedComparison()throws Exception{
        var c=new Case("lite");for(boolean failure:new boolean[]{false,true}){
            var source=new Source(c);var check=scan(c,source,4096);assertEquals(AssemblyPatchBeforeCheck.State.MATCHED,finish(check).state());check.result();
            if(failure)source.failIdentity=true;else source.contextRevision++;
            assertThrows(IllegalStateException.class,check::result);assertEquals(failure?AssemblyPatchBeforeCheck.State.FAILED:AssemblyPatchBeforeCheck.State.CONFLICT,check.progress().state());
            source.failIdentity=false;source.contextRevision=c.baseline.contextRevision;assertThrows(IllegalStateException.class,check::result);
        }
    }
    @Test void cancellationAndReadStepFailuresDoNotResumeOrReturnPartialResults()throws Exception{
        var c=new Case("lite");var source=new Source(c);var check=scan(c,source,1);check.step();check.cancel();assertEquals(AssemblyPatchBeforeCheck.State.CANCELLED,check.step().state());assertEquals(1,source.reads);assertThrows(IllegalStateException.class,check::result);
        for(boolean begin:new boolean[]{false,true}){
            var bad=new Source(c);bad.failStep=begin;bad.failRead=!begin;var failed=scan(c,bad,4096);assertEquals(AssemblyPatchBeforeCheck.State.FAILED,failed.step().state());int reads=bad.reads;failed.step();assertEquals(reads,bad.reads);assertThrows(IllegalStateException.class,failed::result);
        }
    }
    @Test void preparationRejectsDifferentWholeIdentityAndCancellationWithoutReturningAPlan()throws Exception{
        var c=new Case("lite");var changed=c.fixture.deepCopy();changed.getAsJsonObject("metadata").getAsJsonObject("candidate").addProperty("sourceHash","f".repeat(64));var display=AssemblyPatchPreview.from(AssemblyPatchFixtures.input(changed));
        assertThrows(IllegalArgumentException.class,()->AssemblyPatchBeforeCheck.prepare(c.compiled,display,()->false));assertThrows(CancellationException.class,()->AssemblyPatchBeforeCheck.prepare(c.compiled,c.preview,()->true));
        var checks=new AtomicInteger();assertThrows(CancellationException.class,()->AssemblyPatchBeforeCheck.prepare(c.compiled,c.preview,()->checks.incrementAndGet()>2));
    }
    @Test void boundedTickTimeIsCooperativeAndBudgetsCannotBeEnlarged()throws Exception{
        var c=new Case("lite");var source=new Source(c);source.latency=3_000_000;var check=scan(c,source,4096);var progress=check.step();assertEquals(1,progress.checked());assertEquals(3_000_000,progress.maxStepNanos());assertEquals(AssemblyPatchBeforeCheck.State.CHECKING,progress.state());
        assertThrows(IllegalArgumentException.class,()->new AssemblyPatchBeforeCheck(c.plan,source,4097,2_000_000,()->0));assertThrows(IllegalArgumentException.class,()->new AssemblyPatchBeforeCheck(c.plan,source,1,2_000_001,()->0));
    }
}
