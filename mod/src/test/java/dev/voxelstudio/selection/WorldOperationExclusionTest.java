package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Pure lane-policy tests only. Live server entry/tick behavior is a separate
 * exact-JAR game gate, not proven by a truth-table regression. */
final class WorldOperationExclusionTest {
    @Test void everyLaneCombinationFollowsTheDocumentedFamilyMatrix(){
        var conflicts=Map.of(
            WorldOperationExclusion.Kind.NEW_BUILDING,Set.of(1,2,3),
            WorldOperationExclusion.Kind.SINGLE_PATCH,Set.of(0,2),
            WorldOperationExclusion.Kind.WHOLE_ASSEMBLY,Set.of(0,1),
            WorldOperationExclusion.Kind.READ,Set.of(0,1,2));
        for(int mask=0;mask<16;mask++){
            var state=new WorldOperationExclusion.Lanes((mask&1)!=0,(mask&2)!=0,(mask&4)!=0,(mask&8)!=0);
            for(var kind:WorldOperationExclusion.Kind.values()){
                int bits=mask;boolean expected=conflicts.get(kind).stream().anyMatch(bit->(bits&(1<<bit))!=0);
                assertEquals(expected,WorldOperationExclusion.blocked(kind,state),kind+" / "+mask);
            }
        }
    }
    @Test void originalAuditDoesNotSelfBlockItsOwningFinalPreparation(){
        var originalRead=new WorldOperationExclusion.Lanes(false,false,false,true);
        assertFalse(WorldOperationExclusion.blocked(WorldOperationExclusion.Kind.SINGLE_PATCH,originalRead));
        assertFalse(WorldOperationExclusion.blocked(WorldOperationExclusion.Kind.WHOLE_ASSEMBLY,originalRead));
        assertTrue(WorldOperationExclusion.blocked(WorldOperationExclusion.Kind.NEW_BUILDING,originalRead));
    }
    @Test void newBuildingSinglePatchAndWholeAssemblyExcludeEachOtherBothWays(){
        var families=List.of(WorldOperationExclusion.Kind.NEW_BUILDING,WorldOperationExclusion.Kind.SINGLE_PATCH,WorldOperationExclusion.Kind.WHOLE_ASSEMBLY);
        for(int source=0;source<families.size();source++){
            var state=new WorldOperationExclusion.Lanes(source==0,source==1,source==2,false);
            for(int target=0;target<families.size();target++)assertEquals(source!=target,WorldOperationExclusion.blocked(families.get(target),state));
            assertTrue(WorldOperationExclusion.blocked(WorldOperationExclusion.Kind.READ,state));
        }
    }
}
