package dev.voxelstudio;

import com.google.gson.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.util.math.BlockPos;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

public class HighriseTest {
    static Asset asset;static JsonObject manifest;static byte[] bytes;
    @BeforeAll static void init()throws Exception{
        SharedConstants.createGameVersion();Bootstrap.initialize();
        var root=Path.of("build/test-fixtures/highrise");manifest=JsonParser.parseString(Files.readString(root.resolve("manifest.json"))).getAsJsonObject();bytes=Files.readAllBytes(root.resolve("cells.bin"));asset=new Asset("tower-test",manifest,bytes);
    }
    @Test void reads224BlockNativeAssetWithInteriorsAndLamps(){
        assertEquals(224,asset.height);assertTrue(asset.clearCount>100000);assertTrue(asset.setCount>20000);
        assertEquals(0,manifest.getAsJsonObject("navigation").get("disconnectedFloorCells").getAsInt());
        int lamps=0;for(int i=0;i<asset.volume();i++)if(asset.cell(i)>=2&&asset.state(i).getLuminance()>0)lamps++;assertTrue(lamps>0);
    }
    @Test void rotationsAndMirrorsPreserveTallHeightAndCellIdentity(){
        for(int r=0;r<4;r++)for(boolean mirror:List.of(false,true)){
            var p=new Placement(asset,new BlockPos(-80,64,32),r,mirror,1,true);var seen=new BitSet(asset.volume());
            for(int i=0;i<asset.volume();i++){
                var local=p.local(i);int mapped=local.getX()+local.getZ()*p.width()+local.getY()*p.width()*p.length();
                assertTrue(local.getY()>=0&&local.getY()<224);assertFalse(seen.get(mapped));seen.set(mapped);
                assertEquals(local.add(p.anchor()),p.world(i));
            }
            assertEquals(asset.volume(),seen.cardinality());
        }
    }
    @Test void worldTopIsExclusiveAndNegativeYOrOverflowCannotBypassIt(){
        assertTrue(Asset.fitsHeight(96,224,-64,320));assertFalse(Asset.fitsHeight(97,224,-64,320));
        assertTrue(Asset.fitsHeight(-64,384,-64,320));assertFalse(Asset.fitsHeight(-65,384,-64,320));
        assertFalse(Asset.fitsHeight(0,384,0,256));assertFalse(Asset.fitsHeight(Integer.MAX_VALUE,224,-64,320));
    }
    @Test void oversizedNativeDimensionsAndVolumeAreRejectedBeforeHashOrAllocation(){
        var m=manifest.deepCopy();m.getAsJsonObject("dimensions").addProperty("height",385);assertThrows(IllegalArgumentException.class,()->new Asset("bad",m,bytes));
        m.getAsJsonObject("dimensions").addProperty("height",384);m.getAsJsonObject("dimensions").addProperty("width",256);m.getAsJsonObject("dimensions").addProperty("length",256);assertThrows(IllegalArgumentException.class,()->new Asset("bad",m,bytes));
    }
}
