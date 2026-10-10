package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;

/** Synthetic capacity/scheduler evidence only. Not a live-world or quality gate. */
final class BoundedCbdSelectionTest {
    private SelectionRegion r(int x,int y,int z,int xx,int yy,int zz){return new SelectionRegion(new SelectionRegion.Point(x,y,z),new SelectionRegion.Point(xx,yy,zz));}
    private WorldSelection cbd(){return new WorldSelection(new WorldSelection.WorldIdentity("synthetic_cbd_capacity","minecraft:overworld",-64,320),1,
            r(-40,-64,-40,40,174,40),r(-32,-59,-32,32,165,32),List.of());}
    private static final class Source implements SelectionScan.Source {
        long reads,revision=7;boolean loaded=true,alternating;
        public SelectionScan.Identity identity(){return new SelectionScan.Identity("synthetic_cbd_capacity","minecraft:overworld",1,revision);}
        public boolean loaded(int x,int z){return loaded;}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){reads++;return new SelectionScan.BlockFact(alternating&&reads%2==0?"minecraft:stone":"minecraft:air",false);}
    }
    private SelectionScan scan(Source source){return new SelectionScan(cbd(),source,4096,2000000,2,()->0);}
    private SelectionScan.Progress finish(SelectionScan scan){for(int i=0;i<2000;i++){var p=scan.step();if(p.state()!=SelectionScan.State.READING)return p;}throw new AssertionError("Bounded scan did not finish");}
    @Test void fullOriginalCbdAndItsSurroundingContextHaveExactUncroppedCoverage(){var s=cbd();assertEquals(917504,s.edit().cells());assertEquals(1523200,s.context().cells());assertEquals(s.context().cells(),s.chunks().stream().mapToLong(c->c.region().cells()).sum());assertTrue(s.edit().contains(new SelectionRegion.Point(31,164,31)));assertFalse(s.edit().contains(new SelectionRegion.Point(32,164,31)));}
    @Test void exactVolumeLimitsAndLegacySmallerSelectionAreStillDistinct(){var w=cbd().world();assertDoesNotThrow(()->new WorldSelection(w,1,r(-64,0,-64,64,128,64),r(-64,0,-64,64,64,64),List.of()));assertThrows(IllegalArgumentException.class,()->new WorldSelection(w,1,r(-64,0,-64,64,129,64),r(-64,0,-64,64,64,64),List.of()));assertThrows(IllegalArgumentException.class,()->new WorldSelection(w,1,r(-64,0,-64,64,128,64),r(-64,0,-64,64,65,64),List.of()));assertDoesNotThrow(()->new WorldSelection(w,1,r(0,0,0,128,32,128),r(0,0,0,128,32,128),List.of()));}
    @Test void largeSelectionReadsInOriginal4096CellStepsAndDetachesOnlyWhenComplete(){var source=new Source();var scan=scan(source);long prior=0;SelectionScan.Progress p=null;for(int i=0;i<2000;i++){p=scan.step();assertTrue(p.reads()-prior<=4096);prior=p.reads();if(p.state()!=SelectionScan.State.READING)break;}assertEquals(SelectionScan.State.CAPTURED,p.state());assertEquals(1523200,source.reads);var sealed=scan.detachCapture();var baseline=SelectionBaseline.fromSealedCapture(cbd(),sealed);assertEquals("minecraft:air",baseline.at(new SelectionRegion.Point(31,164,31)).state());assertEquals(SelectionScan.State.DETACHED,scan.progress().state());assertThrows(IllegalStateException.class,scan::detachCapture);}
    @Test void missingChunksNeverLoadReadOrBecomeAir(){var source=new Source();source.loaded=false;var scan=scan(source);assertEquals(SelectionScan.State.CAPTURED,finish(scan).state());assertEquals(0,source.reads);assertEquals(1523200,scan.progress().processed());var baseline=SelectionBaseline.fromSealedCapture(cbd(),scan.detachCapture());assertNull(baseline.at(new SelectionRegion.Point(0,0,0)));}
    @Test void cancellationAndBoundedRestartsNeverPublishPartialLargeData(){var source=new Source();var scan=scan(source);scan.step();scan.cancel();assertEquals(SelectionScan.State.CANCELLED,scan.step().state());assertEquals(4096,source.reads);assertThrows(IllegalStateException.class,scan::detachCapture);var changing=new Source();var other=scan(changing);other.step();for(int i=0;i<3;i++){changing.revision++;other.step();}assertEquals(SelectionScan.State.UNSTABLE,other.progress().state());assertEquals(2,other.progress().restarts());assertThrows(IllegalStateException.class,other::detachCapture);}
    @Test void highEntropyStillStopsAtOriginalBytesWithoutAirSubstitution(){var source=new Source();source.alternating=true;var scan=scan(source);assertEquals(SelectionScan.State.FAILED,finish(scan).state());assertEquals("快照大小超限",scan.progress().reason());assertTrue(source.reads<1523200);long original=source.reads;scan.step();assertEquals(original,source.reads);assertThrows(IllegalStateException.class,scan::detachCapture);assertEquals(16777216,SelectionLimits.snapshotBytes());}
    @Test void expandingTheOuterFaceCannotShrinkOrMoveTheInnerCbd(){var draft=new SelectionDraft(cbd().world());draft.region(cbd().context());draft.target(SelectionDraft.Target.EDIT,-1);draft.region(cbd().edit());var before=draft.selection();draft.target(SelectionDraft.Target.CONTEXT,-1);draft.face(0,true,41);assertEquals(before.edit(),draft.selection().edit());assertEquals(64,draft.selection().edit().max().x()-draft.selection().edit().min().x());assertEquals(224,draft.selection().edit().max().y()-draft.selection().edit().min().y());}
}
