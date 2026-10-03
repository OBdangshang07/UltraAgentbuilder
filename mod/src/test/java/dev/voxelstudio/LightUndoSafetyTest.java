package dev.voxelstudio;

import net.minecraft.Bootstrap;
import net.minecraft.SharedConstants;
import net.minecraft.block.Blocks;
import net.minecraft.state.property.Properties;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class LightUndoSafetyTest {
 @BeforeAll static void init(){SharedConstants.createGameVersion();Bootstrap.initialize();}
 @Test void onlyAnExactDryApprovedLightStateGetsTheHardnessException(){
  var light=Blocks.LIGHT.getDefaultState().with(Properties.LEVEL_15,15).with(Properties.WATERLOGGED,false);
  assertTrue(PlacementService.matchesApprovedLight(light,light));
  assertFalse(PlacementService.matchesApprovedLight(light,null));
  assertFalse(PlacementService.matchesApprovedLight(light.with(Properties.LEVEL_15,14),light));
  var wet=light.with(Properties.WATERLOGGED,true);assertFalse(PlacementService.matchesApprovedLight(wet,wet));
  for(var block:new net.minecraft.block.Block[]{Blocks.BEDROCK,Blocks.BARRIER,Blocks.COMMAND_BLOCK,Blocks.STONE,Blocks.AIR}){
   assertFalse(PlacementService.matchesApprovedLight(block.getDefaultState(),block.getDefaultState()));
   assertFalse(PlacementService.matchesApprovedLight(block.getDefaultState(),light));
  }
 }
}
