package dev.voxelstudio.selection;

import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.block.Blocks;
import net.minecraft.state.property.Properties;
import net.minecraft.util.math.Direction;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

final class BlockStateFactsTest {
    @BeforeAll static void init(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @Test void registryIdentityAndPropertylessAirRemainExact(){assertEquals(new SelectionScan.BlockFact("minecraft:air",false),BlockStateFacts.read(Blocks.AIR.getDefaultState()));}
    @Test void blockEntitiesAreMarkedWithoutReadingTheirContents(){assertTrue(BlockStateFacts.read(Blocks.CHEST.getDefaultState()).blockEntity());assertTrue(BlockStateFacts.read(Blocks.OAK_SIGN.getDefaultState()).blockEntity());assertFalse(BlockStateFacts.read(Blocks.GLASS.getDefaultState()).blockEntity());}
    @Test void actualSpecialStatePropertiesAreSortedAndNotCollapsedToMaterials(){
        var state=Blocks.OAK_STAIRS.getDefaultState().with(Properties.HORIZONTAL_FACING,Direction.WEST).with(Properties.WATERLOGGED,true);
        assertEquals("minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=true]",BlockStateFacts.read(state).state());
        assertNotEquals(BlockStateFacts.read(state),BlockStateFacts.read(state.with(Properties.WATERLOGGED,false)));
    }
    @Test void doorAndTrapdoorPartsPreserveAllProperties(){var door=BlockStateFacts.read(Blocks.OAK_DOOR.getDefaultState());assertTrue(door.state().contains("half=lower"));assertTrue(door.state().contains("hinge=left"));assertTrue(BlockStateFacts.read(Blocks.OAK_TRAPDOOR.getDefaultState()).state().contains("open=false"));}
}
