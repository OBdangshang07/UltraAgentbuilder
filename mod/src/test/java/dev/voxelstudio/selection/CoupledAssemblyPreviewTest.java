package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Complete synthetic native display only; no GPU/game/consent proof. */
final class CoupledAssemblyPreviewTest {
    private CoupledAssemblyInput input(String name)throws Exception{return CoupledAssemblyTestFixtures.input(CoupledAssemblyTestFixtures.fixture(name));}
    @Test void everyCompleteFixtureMergesAllOriginalRowsWithoutGrantingWorldAuthority()throws Exception{
        for(var name:List.of("complete-new-door","static-only","negative-original-origin","captured-keep-support","captured-support-below-native","explicit-demolition-and-keep","top-stair","top-slab","double-slab","partial-blocks-without-door","interleaved-pairs")){
            var in=input(name);var view=CoupledAssemblyPreview.from(in);assertSame(in.binding(),view.binding());assertSame(in.binding().selection(),view.selection());assertEquals(in.binding().totalWrites(),view.totalWrites());assertEquals(view.totalWrites(),view.counts().values().stream().mapToInt(Integer::intValue).sum());assertTrue(view.fromOriginalInput(in));assertFalse(view.movable());assertFalse(view.canAuthorizePlacement());assertFalse(view.currentWorldVerified());for(var section:view.sections())for(var row:section.rows()){assertSame(row,view.at(row.position()));assertTrue(in.binding().selection().edit().contains(row.position()));}
        }
    }
    @Test void completePreviewRetainsBothDoorMembersAcross8192TransportBoundary()throws Exception{
        var in=input("door-crosses-8192");assertEquals(2,in.parts().size());var view=CoupledAssemblyPreview.from(in);var positions=new HashSet<SelectionRegion.Point>();int lower=0,upper=0;for(var section:view.sections())for(var row:section.rows()){assertTrue(positions.add(row.position()));if(row.after().contains("half=lower"))lower++;if(row.after().contains("half=upper"))upper++;}assertEquals(view.totalWrites(),positions.size());assertEquals(1,lower);assertEquals(1,upper);assertEquals(in.binding().totalWrites(),view.totalWrites());
    }
    @Test void negativeOriginalCoordinatesAreNotRebasedForRenderingOrFilters()throws Exception{
        var view=CoupledAssemblyPreview.from(input("negative-original-origin"));assertTrue(view.bounds().max().x()<0);assertTrue(view.bounds().max().y()<0);assertTrue(view.bounds().max().z()<0);for(var row:view.visible(view.all(WorldPatchPreview.Mode.AFTER)))assertTrue(view.bounds().contains(row.position()));var w=view.selection().world();assertThrows(IllegalArgumentException.class,()->view.checked(new WorldPatchPreview.Filter(WorldPatchPreview.Mode.AFTER,w.minY()-1,w.maxY(),EnumSet.allOf(WorldPatchPreview.Difference.class))));
    }
    @Test void displayCollectionsCannotBeMutatedIntoPartialOrRelocatedNativeResults()throws Exception{
        var view=CoupledAssemblyPreview.from(input("complete-new-door"));assertThrows(UnsupportedOperationException.class,()->view.sections().clear());assertThrows(UnsupportedOperationException.class,()->view.sections().get(0).rows().clear());assertThrows(UnsupportedOperationException.class,()->view.palette().clear());assertThrows(UnsupportedOperationException.class,()->view.counts().clear());assertThrows(UnsupportedOperationException.class,()->view.visible(view.all(WorldPatchPreview.Mode.AFTER)).clear());
    }
    @Test void cancelledCompleteMergeNeverReturnsAnAdoptablePartialView()throws Exception{
        var in=input("door-crosses-8192");assertThrows(CancellationException.class,()->CoupledAssemblyPreview.from(in,()->true));var calls=new AtomicInteger();assertThrows(CancellationException.class,()->CoupledAssemblyPreview.from(in,()->calls.incrementAndGet()>5));
    }
    @Test void equalLookingCopiedTransportIsNotTheOriginalPreviewInput()throws Exception{
        var in=input("complete-new-door");var other=input("complete-new-door");assertEquals(in.binding(),other.binding());var view=CoupledAssemblyPreview.from(in);assertTrue(view.fromOriginalInput(in));assertFalse(view.fromOriginalInput(other));assertTrue(WorldDifferenceView.class.isAssignableFrom(view.getClass()));assertFalse(AssemblyPatchPreview.class.isInstance(view));
    }
}
