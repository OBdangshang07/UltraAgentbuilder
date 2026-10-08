package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

final class AssemblyPatchPreviewTest {
    @Test void completeUltraMergesSharedSectionsAcrossTransportBoundariesAndNegativeCoordinates()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("ultra"));var display=AssemblyPatchPreview.from(input);
        var expected=new HashMap<List<Integer>,Integer>();var partOwners=new HashMap<List<Integer>,Set<Integer>>();
        for(var part:input.parts())for(var section:part.preview().sections()){
            var key=List.of(section.x(),section.y(),section.z());expected.merge(key,section.rows().size(),Integer::sum);partOwners.computeIfAbsent(key,k->new HashSet<>()).add(part.index());
        }
        assertTrue(partOwners.values().stream().anyMatch(parts->parts.size()>1),"Real transport boundaries must split a shared section");
        int rows=0;boolean negative=false;List<Integer> previous=null;
        for(var section:display.sections()){
            var key=List.of(section.x(),section.y(),section.z());assertEquals(expected.remove(key),section.rows().size());
            var order=List.of(section.y(),section.z(),section.x());if(previous!=null)assertTrue(compare(previous,order)<0);previous=order;
            int last=-1;for(var row:section.rows()){
                var p=row.position();assertEquals(section.x(),Math.floorDiv(p.x(),16));assertEquals(section.y(),Math.floorDiv(p.y(),16));assertEquals(section.z(),Math.floorDiv(p.z(),16));
                int index=Math.floorMod(p.y(),16)*256+Math.floorMod(p.z(),16)*16+Math.floorMod(p.x(),16);assertTrue(index>last);last=index;
                assertSame(row,display.at(p));negative|=p.x()<0||p.y()<0||p.z()<0;rows++;
            }
        }
        assertTrue(negative);assertTrue(expected.isEmpty());assertEquals(54406,rows);assertEquals(rows,display.totalWrites());
        assertEquals(rows,display.counts().values().stream().mapToInt(Integer::intValue).sum());assertEquals(rows,display.visible(display.all(WorldPatchPreview.Mode.CHANGES)).size());
        assertFalse(display.movable());assertFalse(display.canAuthorizePlacement());assertFalse(display.currentWorldVerified());
    }
    @Test void beforeAfterCategoryAndHalfOpenFloorCutsRetainOneWholeOriginalScope()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite"));var display=AssemblyPatchPreview.from(input);var categories=EnumSet.of(WorldPatchPreview.Difference.ADDED);
        var filter=new WorldPatchPreview.Filter(WorldPatchPreview.Mode.AFTER,-39,-35,categories);categories.clear();var rows=display.visible(filter);
        long expected=display.sections().stream().flatMap(s->s.rows().stream()).filter(row->row.difference()==WorldPatchPreview.Difference.ADDED&&row.position().y()>=-39&&row.position().y()<-35).count();assertEquals(expected,rows.size());assertFalse(rows.isEmpty());
        for(var row:rows){assertNull(WorldPatchPreview.displayState(row,WorldPatchPreview.Mode.BEFORE,true));assertEquals(row.after(),WorldPatchPreview.displayState(row,WorldPatchPreview.Mode.AFTER,false));}
        assertEquals(display.totalWrites(),display.visible(display.all(WorldPatchPreview.Mode.BEFORE)).size());
        assertThrows(IllegalArgumentException.class,()->display.visible(new WorldPatchPreview.Filter(WorldPatchPreview.Mode.CHANGES,-65,0,Set.of(WorldPatchPreview.Difference.ADDED))));
        assertThrows(UnsupportedOperationException.class,()->display.sections().get(0).rows().clear());assertThrows(UnsupportedOperationException.class,()->display.palette().clear());assertThrows(UnsupportedOperationException.class,()->display.counts().clear());
    }
    @Test void cancelledBackgroundDifferenceDoesNotReturnAPartialDisplay()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite"));assertThrows(CancellationException.class,()->AssemblyPatchPreview.from(input,()->true));
        var checks=new AtomicInteger();assertThrows(CancellationException.class,()->AssemblyPatchPreview.from(input,()->checks.incrementAndGet()>3));
    }
    private int compare(List<Integer> a,List<Integer> b){for(int i=0;i<3;i++){int order=Integer.compare(a.get(i),b.get(i));if(order!=0)return order;}return 0;}
}
