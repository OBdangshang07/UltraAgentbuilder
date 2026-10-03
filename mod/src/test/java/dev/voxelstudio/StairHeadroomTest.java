package dev.voxelstudio;

import com.google.gson.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.EmptyBlockView;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

/** Verify native cells against real MC collision states, not component names. */
class StairHeadroomTest {
    static Asset asset;
    @BeforeAll static void setup()throws Exception{
        SharedConstants.createGameVersion();Bootstrap.initialize();Path p=Path.of("build/test-fixtures/scene-four-metre-world-tower");
        asset=new Asset("stair-headroom",JsonParser.parseString(Files.readString(p.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(p.resolve("cells.bin")));
    }
    @Test void fullHeightNativeTowerHasClimbableClearance(){verify(0,false);}
    @Test void rotatedMirroredNativeTowerRetainsClimbableClearance(){verify(1,true);}
    private void verify(int rotation,boolean mirror){
        var placement=new Placement(asset,BlockPos.ORIGIN,rotation,mirror,1,true);int w=placement.width(),d=placement.length(),h=asset.height,plane=w*d;
        boolean[] air=new boolean[asset.volume()],support=new boolean[asset.volume()];
        for(int i=0;i<asset.volume();i++){
            var p=placement.local(i);int dest=p.getX()+p.getZ()*w+p.getY()*plane;
            if(asset.cell(i)==1)air[dest]=true;
            else if(asset.cell(i)>=2){var collision=asset.state(i).getCollisionShape(EmptyBlockView.INSTANCE,BlockPos.ORIGIN);air[dest]=collision.isEmpty();support[dest]=net.minecraft.block.Block.isShapeFullCube(collision);}
        }
        var start=placement.local(asset.index(3,1,3));int first=start.getX()+start.getZ()*w+start.getY()*plane;
        boolean[] seen=new boolean[asset.volume()];int[] queue=new int[asset.volume()];int read=0,write=1;seen[first]=true;queue[0]=first;
        int[][] directions={{1,0},{-1,0},{0,1},{0,-1}};
        while(read<write){int i=queue[read++],x=i%w,y=i/plane,z=(i/w)%d;
            for(var dir:directions)for(int dy=-1;dy<=1;dy++){
                int nx=x+dir[0],ny=y+dy,nz=z+dir[1];if(nx<0||nx>=w||nz<0||nz>=d||ny<1||ny+1>=h)continue;
                int n=nx+nz*w+ny*plane;if(seen[n]||!support[n-plane]||!air[n]||!air[n+plane]||dy==1&&(y+2>=h||!air[i+2*plane]))continue;
                seen[n]=true;queue[write++]=n;
            }
        }
        for(int y=8;y<=220;y+=4){var p=placement.local(asset.index(3,y+1,3));assertTrue(seen[p.getX()+p.getZ()*w+p.getY()*plane],"Disconnected office floor "+y);}
        assertEquals(224,h);assertFalse(asset.navigationAcknowledgementRequired);
    }
}
