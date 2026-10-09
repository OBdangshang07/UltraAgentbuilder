package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WorldOperationViewScopeTest {
    @Test void exactOriginalDimensionIsVisibleIncludingCanonicalCustomKeys(){
        for(String dimension:new String[]{"minecraft:overworld","minecraft:the_nether","minecraft:the_end","example:district/cbd"})
            assertTrue(WorldOperationViewScope.currentDimension(dimension,new String(dimension)));
    }
    @Test void switchingDimensionOrNamespaceDoesNotExposeRetainedOperation(){
        assertFalse(WorldOperationViewScope.currentDimension("minecraft:overworld","minecraft:the_nether"));
        assertFalse(WorldOperationViewScope.currentDimension("minecraft:overworld","example:overworld"));
        assertFalse(WorldOperationViewScope.currentDimension("example:district/cbd","example:cbd"));
    }
    @Test void missingAndMalformedKeysFailClosedRatherThanAcquiringAWorld(){
        assertFalse(WorldOperationViewScope.currentDimension(null,"minecraft:overworld"));
        assertFalse(WorldOperationViewScope.currentDimension("minecraft:overworld",null));
        for(String malformed:new String[]{"","overworld","Minecraft:overworld","minecraft:","minecraft:overworld ","minecraft:overworld?x","m:"+"a".repeat(128)})
            assertFalse(WorldOperationViewScope.currentDimension(malformed,malformed),malformed);
    }
    @Test void repeatedReadOnlyFilteringDoesNotRetireOrRebindTheOriginalKey(){
        String original="minecraft:overworld";
        assertFalse(WorldOperationViewScope.currentDimension(original,"minecraft:the_end"));
        assertTrue(WorldOperationViewScope.currentDimension(original,"minecraft:overworld"));
        assertFalse(WorldOperationViewScope.currentDimension(original,"minecraft:the_end"));
        assertEquals("minecraft:overworld",original);
    }
}
