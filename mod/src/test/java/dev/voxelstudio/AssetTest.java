package dev.voxelstudio;

import com.google.gson.JsonParser;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.util.math.BlockPos;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

public class AssetTest {
    static Asset asset;
    @BeforeAll static void init() throws Exception {
        SharedConstants.createGameVersion(); Bootstrap.initialize();
        asset = new Asset("test-revision",JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/manifest.json"))).getAsJsonObject(),Files.readAllBytes(Path.of("build/test-fixtures/cells.bin")));
    }
    @Test void verifiesHashCountsMasksAndMinecraftRegistry() { assertEquals(1937,asset.setCount); assertEquals(721,asset.clearCount); assertEquals(0,asset.cell(asset.index(0,2,0))); assertEquals(1,asset.cell(asset.index(3,2,3))); }
    @Test void tamperedCellDataIsRejected() throws Exception {
        var m=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/manifest.json"))).getAsJsonObject();var bytes=Files.readAllBytes(Path.of("build/test-fixtures/cells.bin"));bytes[0]^=2;
        assertThrows(IllegalArgumentException.class,()->new Asset("tampered",m,bytes));
    }
    @Test void eachRotationAndMirrorIsBijectiveInsideOddBounds() {
        for(int rotation=0;rotation<4;rotation++)for(boolean mirror:List.of(false,true)) {
            Placement p=new Placement(asset,new BlockPos(-121,-48,-131),rotation,mirror,1,true);
            Set<BlockPos> points=new HashSet<>();
            for(int i=0;i<asset.volume();i++) { BlockPos local=p.local(i);assertTrue(local.getX()>=0&&local.getX()<p.width());assertTrue(local.getZ()>=0&&local.getZ()<p.length());assertEquals(p.world(i),local.add(p.anchor()));assertTrue(points.add(local)); }
            assertEquals(asset.volume(),points.size());
        }
    }
    @Test void fourQuarterTurnsRestorePositionAndState() {
        Placement a=new Placement(asset,BlockPos.ORIGIN,0,false,0,true),b=new Placement(asset,BlockPos.ORIGIN,4,false,1,true);
        for(int i=0;i<asset.volume();i++){assertEquals(a.local(i),b.local(i));assertEquals(a.state(i),b.state(i));}
    }
    @Test void floorDerived224mFacadeImportsWithRealTopStoreyAndPlacementTransforms() throws Exception {
        var root=Path.of("build/test-fixtures/storey-world-tower");
        var manifest=JsonParser.parseString(Files.readString(root.resolve("manifest.json"))).getAsJsonObject();
        var tower=new Asset("storey-layout-fixture",manifest,Files.readAllBytes(root.resolve("cells.bin")));
        assertEquals(224,tower.height);assertTrue(tower.sceneDesign);assertFalse(tower.navigationAcknowledgementRequired);assertDoesNotThrow(tower::requireBuildable);
        assertTrue(tower.state(5,222,29).isOf(net.minecraft.block.Blocks.GLASS));
        assertFalse(tower.state(5,223,29).isOf(net.minecraft.block.Blocks.GLASS));
        for(int rotation=0;rotation<4;rotation++)for(boolean mirror:List.of(false,true)) {
            var placement=new Placement(tower,new BlockPos(-60,64,-60),rotation,mirror,1,true);
            var local=placement.local(tower.index(5,222,29));
            assertEquals(222,local.getY());assertTrue(local.getX()>=0&&local.getX()<placement.width());assertTrue(local.getZ()>=0&&local.getZ()<placement.length());
            assertEquals(local.add(placement.anchor()),placement.world(tower.index(5,222,29)));
        }
    }
    @Test void analysisOnlyAssetsCannotBePlacedEvenIfTheirCellHashIsValid()throws Exception{
        var m=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/manifest.json"))).getAsJsonObject();m.remove("assetHash");m.addProperty("diagnosticOnly",true);m.addProperty("assetHash",Asset.sha(Asset.canonical(m).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var a=new Asset("diagnostic",m,Files.readAllBytes(Path.of("build/test-fixtures/cells.bin")));assertTrue(a.diagnosticOnly);assertThrows(IllegalStateException.class,a::requireBuildable);assertDoesNotThrow(asset::requireBuildable);
    }
    @Test void floorLinkedCoreImportsAt224mAndPairedDoorsRetainMinecraftStates() throws Exception {
        for(String id:List.of("floor-world-tower","floor-doors")) {
            var root=Path.of("build/test-fixtures/"+id);
            var a=new Asset(id,JsonParser.parseString(Files.readString(root.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(root.resolve("cells.bin")));
            assertDoesNotThrow(a::requireBuildable);
            if(id.equals("floor-world-tower")) {
                assertEquals(224,a.height);assertFalse(a.navigationAcknowledgementRequired);
                for(int y=0;y<220;y+=5){assertTrue(a.state(12,y+1,5).isAir());assertFalse(a.state(12,y,5).isAir());}
            } else {
                assertTrue(a.navigationAcknowledgementRequired);
                for(int y:List.of(2,7,12,18)) {
                    assertTrue(a.state(32,y+1,10).isOf(net.minecraft.block.Blocks.OAK_DOOR));
                    assertEquals(net.minecraft.block.enums.DoubleBlockHalf.LOWER,a.state(32,y+1,10).get(net.minecraft.state.property.Properties.DOUBLE_BLOCK_HALF));
                    assertEquals(net.minecraft.block.enums.DoubleBlockHalf.UPPER,a.state(32,y+2,10).get(net.minecraft.state.property.Properties.DOUBLE_BLOCK_HALF));
                    for(int r=0;r<4;r++)for(boolean mirror:List.of(false,true)) {
                        var p=new Placement(a,BlockPos.ORIGIN,r,mirror,1,true);
                        assertEquals(p.state(a.index(32,y+1,10)).get(net.minecraft.state.property.Properties.HORIZONTAL_FACING),p.state(a.index(32,y+2,10)).get(net.minecraft.state.property.Properties.HORIZONTAL_FACING));
                        assertNotEquals(p.state(a.index(32,y+1,10)).get(net.minecraft.state.property.Properties.DOOR_HINGE),p.state(a.index(32,y+1,11)).get(net.minecraft.state.property.Properties.DOOR_HINGE));
                    }
                }
            }
        }
    }
}
