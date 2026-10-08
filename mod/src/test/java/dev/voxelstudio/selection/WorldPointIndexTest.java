package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class WorldPointIndexTest {
    @Test void originalPointEqualityAndHashRemainUnchangedIncludingCollisionsAndNegativeCoordinates(){
        var first=new SelectionRegion.Point(-17,-40,-16);
        var equal=new SelectionRegion.Point(-17,-40,-16);
        var collision=new SelectionRegion.Point(-17,-39,-47);
        assertEquals(first,equal);assertEquals(first.hashCode(),equal.hashCode());assertEquals(first.hashCode(),collision.hashCode());assertNotEquals(first,collision);
        var source=new HashMap<SelectionRegion.Point,String>();source.put(first,"first");source.put(collision,"collision");
        var index=WorldPointIndex.copy(source);assertEquals("first",index.get(equal));assertEquals("collision",index.get(new SelectionRegion.Point(-17,-39,-47)));assertEquals(2,index.size());
    }
    @Test void defensiveCopyHasNoMutableViewsAndKeepsMapCopyOfNullRejection(){
        var point=new SelectionRegion.Point(0,0,0);var source=new HashMap<SelectionRegion.Point,String>();source.put(point,"original");var index=WorldPointIndex.copy(source);source.clear();
        assertEquals("original",index.get(point));assertThrows(UnsupportedOperationException.class,()->index.put(point,"changed"));assertThrows(UnsupportedOperationException.class,index::clear);
        assertThrows(UnsupportedOperationException.class,()->index.entrySet().iterator().next().setValue("changed"));assertThrows(UnsupportedOperationException.class,()->index.keySet().remove(point));assertThrows(UnsupportedOperationException.class,()->index.values().remove("original"));
        assertThrows(NullPointerException.class,()->WorldPointIndex.copy(null));source.put(null,"value");assertThrows(NullPointerException.class,()->WorldPointIndex.copy(source));source.clear();source.put(point,null);assertThrows(NullPointerException.class,()->WorldPointIndex.copy(source));
    }
    @Test void allOriginalSevenPartUltraGuardKeysRemainIndependentlyAddressable()throws Exception{
        var fixture=AssemblyPatchFixtures.header("ultra");var source=new HashMap<SelectionRegion.Point,String>();
        for(int part=0;part<7;part++)for(var value:AssemblyPatchFixtures.part(fixture,part).getAsJsonObject("patch").getAsJsonArray("guards")){
            var guard=value.getAsJsonObject();var point=AssemblyPatchFixtures.point(guard.getAsJsonArray("position"));var before=guard.get("before").getAsString();var previous=source.putIfAbsent(point,before);if(previous!=null)assertEquals(previous,before);
        }
        assertEquals(150157,source.size());var index=WorldPointIndex.copy(source);
        // Representation assertion, not a wall-clock/game-frame promise.
        assertEquals(Collections.unmodifiableMap(new HashMap<>()).getClass(),index.getClass());
        for(var entry:source.entrySet()){var point=entry.getKey();assertEquals(entry.getValue(),index.get(new SelectionRegion.Point(point.x(),point.y(),point.z())));}
        assertEquals(source,index);source.clear();assertEquals(150157,index.size());
    }
}
