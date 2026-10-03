package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import net.minecraft.util.math.BlockPos;
import static org.junit.jupiter.api.Assertions.*;

class StudioSelfTestTest {
    @Test void isolatedAnchorsKeepTheirOriginalBoundedRegion(){
        assertEquals(new BlockPos(0,-60,-96),StudioSelfTest.fixtureAnchor("0,-60,-96"));
        assertEquals(new BlockPos(128,-64,-128),StudioSelfTest.fixtureAnchor("128,-64,-128"));
        assertEquals(new BlockPos(-128,319,128),StudioSelfTest.fixtureAnchor("-128,319,128"));
        for(String invalid:new String[]{"224,-60,224","129,0,0","0,0,-129","0,-65,0","0,320,0","1,2","0,1,2,3","0, 1,2"})
            assertThrows(IllegalArgumentException.class,()->StudioSelfTest.fixtureAnchor(invalid));
    }
}
