package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;

final class SelectionScanTest {
    private WorldSelection selection(){var r=new SelectionRegion(new SelectionRegion.Point(-1,-1,-1),new SelectionRegion.Point(2,1,2));return new WorldSelection(new WorldSelection.WorldIdentity("test","minecraft:overworld",-64,320),1,r,r,List.of());}
    private static final class Source implements SelectionScan.Source {
        long revision=5,now,readMillis;long selector=1;String world="test",dimension="minecraft:overworld";boolean loaded=true,fail,failStep;int reads,begunSteps;String state="minecraft:stone";List<SelectionRegion.Point> points=new ArrayList<>();
        public void beginStep(){begunSteps++;if(failStep)throw new IllegalStateException("step unavailable");}
        public SelectionScan.Identity identity(){return new SelectionScan.Identity(world,dimension,selector,revision);}
        public boolean loaded(int x,int z){return loaded;}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){reads++;points.add(p);now+=readMillis;if(fail)throw new IllegalStateException("read unavailable");return new SelectionScan.BlockFact(state,false);}
    }
    private SelectionScan scan(Source source,int max){return new SelectionScan(selection(),source,max,5000000,2,()->source.now);}
    private SelectionScan.Progress finish(SelectionScan scan){for(int i=0;i<1000;i++){var p=scan.step();if(p.state()!=SelectionScan.State.READING)return p;}throw new AssertionError("Read did not finish");}
    @Test void eachCellReadsOnceInBoundedSteps(){var s=new Source();var scan=scan(s,3);assertEquals(3,scan.step().processed());assertEquals(SelectionScan.State.CAPTURED,finish(scan).state());assertEquals(18,s.reads);assertEquals(18,new HashSet<>(s.points).size());assertEquals(4,scan.capture().getAsJsonArray("chunks").size());}
    @Test void budgetIsCooperativeAndDoesNotClaimPreemptingSlowOperations(){var s=new Source();s.readMillis=3000000;var scan=scan(s,4096);var p=scan.step();assertEquals(2,p.reads());assertEquals(6000000,p.maxStepNanos());assertEquals(SelectionScan.State.READING,p.state());}
    @Test void unknownChunksAreExplicitAndNeverReadOrLoaded(){var s=new Source();s.loaded=false;var scan=scan(s,3);assertEquals(SelectionScan.State.CAPTURED,finish(scan).state());assertEquals(0,s.reads);assertEquals(18,scan.progress().processed());for(var c:scan.capture().getAsJsonArray("chunks")){assertEquals("unknown",c.getAsJsonObject().get("coverage").getAsString());assertTrue(c.getAsJsonObject().getAsJsonArray("palette").isEmpty());}}
    @Test void changingWorldRegionRestartsWithinBoundAndDoesNotMixFacts(){var s=new Source();var scan=scan(s,1);scan.step();s.revision++;scan.step();s.state="minecraft:air";assertEquals(SelectionScan.State.CAPTURED,finish(scan).state());assertEquals(1,scan.progress().restarts());assertEquals(19,s.reads);for(var c:scan.capture().getAsJsonArray("chunks"))assertEquals("minecraft:air",c.getAsJsonObject().getAsJsonArray("palette").get(0).getAsJsonObject().get("state").getAsString());}
    @Test void endlessChangesEndAsUnstableNotAnInfiniteScan(){var s=new Source();var scan=scan(s,1);scan.step();for(int i=0;i<3;i++){s.revision++;scan.step();}assertEquals(SelectionScan.State.UNSTABLE,scan.progress().state());assertEquals(2,scan.progress().restarts());assertThrows(IllegalStateException.class,scan::capture);}
    @Test void dimensionSelectionAndWorldChangesCannotReuseCapture(){for(int kind=0;kind<3;kind++){var s=new Source();var scan=scan(s,1);scan.step();if(kind==0)s.world="new";if(kind==1)s.dimension="minecraft:the_nether";if(kind==2)s.selector++;assertEquals(SelectionScan.State.STALE,scan.step().state());assertEquals(1,s.reads);}}
    @Test void cancelledOrFailedReadsNeverPublishOrResume(){var s=new Source();var scan=scan(s,1);scan.step();scan.cancel();assertEquals(SelectionScan.State.CANCELLED,scan.step().state());assertEquals(1,s.reads);assertThrows(IllegalStateException.class,scan::detachCapture);var other=new Source();other.fail=true;var failed=scan(other,1);assertEquals(SelectionScan.State.FAILED,failed.step().state());failed.step();assertEquals(1,other.reads);}
    @Test void revisionRegressionFailsAndNewCaptureCannotFinishAfterSourceChange(){var s=new Source();var scan=scan(s,1);scan.step();s.revision--;assertEquals(SelectionScan.State.FAILED,scan.step().state());var other=new Source();var captured=scan(other,4096);finish(captured);other.revision++;assertThrows(IllegalStateException.class,captured::capture);assertEquals(SelectionScan.State.READING,captured.progress().state());}
    @Test void detachTransfersOnlyACompletePrivateBufferWithoutLaterScannerMutation(){var s=new Source();var scan=scan(s,4096);finish(scan);var payload=scan.detachCapture();assertEquals(SelectionScan.State.DETACHED,scan.progress().state());scan.cancel();scan.step();assertEquals(4,payload.getAsJsonArray("chunks").size());assertEquals(18,s.reads);assertThrows(IllegalStateException.class,scan::capture);}
    @Test void chunkCacheLifecycleIsExactlyOnePerReadStepNotPerCellOrAfterCompletion(){var s=new Source();var scan=scan(s,3);var p=finish(scan);assertEquals(p.steps(),s.begunSteps);assertEquals(6,s.begunSteps);scan.step();scan.capture();assertEquals(6,s.begunSteps);}
    @Test void stepSetupFailureCannotProduceAFactOrResume(){var s=new Source();s.failStep=true;var scan=scan(s,4096);assertEquals(SelectionScan.State.FAILED,scan.step().state());assertEquals(0,s.reads);scan.step();assertEquals(1,s.begunSteps);assertThrows(IllegalStateException.class,scan::capture);}
}
