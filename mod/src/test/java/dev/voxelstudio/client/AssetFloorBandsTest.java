package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AssetFloorBandsTest {
    @Test void exactRequestedFloorsArePreserved(){
        assertArrayEquals(new int[]{25,50,125,195},AssetFloorBands.parse("25,50,125,195",240,120));
        assertArrayEquals(new int[]{120},AssetFloorBands.parse(null,240,120));
    }
    @Test void invalidBandsNeverSilentlyChangeTheFloor(){
        for(String invalid:new String[]{"","-1","1,1","237","3,"," 25","9999999999","1.0"})
            assertThrows(IllegalArgumentException.class,()->AssetFloorBands.parse(invalid,240,120));
    }
}
