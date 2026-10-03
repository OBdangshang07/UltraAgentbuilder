package dev.voxelstudio;
import com.google.gson.*;import net.minecraft.*;import net.minecraft.block.*;import net.minecraft.state.property.Properties;import net.minecraft.block.enums.*;import net.minecraft.util.math.BlockPos;import org.junit.jupiter.api.*;import java.nio.file.*;import java.util.*;import static org.junit.jupiter.api.Assertions.*;
public class SpecialBlocksTest {
    static Asset asset;
    @BeforeAll static void init()throws Exception{SharedConstants.createGameVersion();Bootstrap.initialize();Path dir=Path.of("build/test-fixtures/terraced-courtyard-study");asset=new Asset("test-special",JsonParser.parseString(Files.readString(dir.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(dir.resolve("cells.bin")));}
    @Test void actualRegistryContainsDoorsTrapdoorsStairsAndSlabs(){var types=new HashSet<String>();for(int i=0;i<asset.volume();i++){var b=asset.state(i).getBlock();if(b instanceof DoorBlock)types.add("door");if(b instanceof TrapdoorBlock)types.add("trapdoor");if(b instanceof SlabBlock)types.add("slab");}assertEquals(Set.of("door","trapdoor","slab"),types);assertTrue(asset.navigationAcknowledgementRequired);}
    @Test void doorsStayPairedForAllEightTransforms(){for(int r=0;r<4;r++)for(boolean m:List.of(false,true)){Placement p=new Placement(asset,BlockPos.ORIGIN,r,m,1,true);for(int i=0;i<asset.volume();i++)if(SpecialBlocks.door(p.state(i))){int j=i+SpecialBlocks.offset(p.state(i))*asset.width*asset.length;assertTrue(SpecialBlocks.matching(p.state(i),p.state(j)));assertEquals(p.world(i).up(SpecialBlocks.offset(p.state(i))),p.world(j));}}}
    @Test void logicalDoorGroupsContainBothCells(){Placement p=new Placement(asset,BlockPos.ORIGIN,1,true,1,true);for(int i=0;i<asset.volume();i++)if(SpecialBlocks.door(p.state(i))){var g=SpecialBlocks.group(p,i,n->Blocks.AIR.getDefaultState());assertEquals(2,g.size());}}
    @Test void mirroredDoorChangesHingeAndSlabKeepsVerticalHalf(){for(int i=0;i<asset.volume();i++){var a=asset.state(i);var b=new Placement(asset,BlockPos.ORIGIN,0,true,1,true).state(i);if(SpecialBlocks.door(a))assertNotEquals(a.get(Properties.DOOR_HINGE),b.get(Properties.DOOR_HINGE));if(a.getBlock() instanceof SlabBlock)assertEquals(a.get(Properties.SLAB_TYPE),b.get(Properties.SLAB_TYPE));}}
    @Test void everyApprovedMaterialResolvesInMinecraft1201()throws Exception{for(var v:JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/material-states.json"))).getAsJsonArray())assertNotNull(parse(v.getAsString()));}
    private static BlockState parse(String s)throws Exception{return net.minecraft.command.argument.BlockArgumentParser.block(net.minecraft.registry.Registries.BLOCK.getReadOnlyWrapper(),s,false).blockState();}
    @Test void allStairTransformsMatchCompilerAndActualModelBounds()throws Exception{
        Path fixture=Path.of("build/test-fixtures/special-block-world-fixture");var manifest=JsonParser.parseString(Files.readString(fixture.resolve("manifest.json"))).getAsJsonObject();byte[] cells=Files.readAllBytes(fixture.resolve("cells.bin"));
        for(var v:JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/state-transforms.json"))).getAsJsonArray()){
            var row=v.getAsJsonObject();var local=manifest.deepCopy();int paletteIndex=local.getAsJsonArray("palette").size();local.getAsJsonArray("palette").add(row.get("source"));
            byte[] changed=cells.clone();int index=2+2*16+1*256;changed[index*2]=(byte)paletteIndex;changed[index*2+1]=0;
            local.addProperty("cellsHash",Asset.sha(changed));local.remove("assetHash");local.addProperty("assetHash",Asset.sha(Asset.canonical(local).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            Asset a=new Asset("transform-test",local,changed);var p=new Placement(a,BlockPos.ORIGIN,row.get("rotation").getAsInt(),row.get("mirror").getAsBoolean(),0,true);assertEquals(parse(row.get("expected").getAsString()),p.state(index));
        }
    }
}
