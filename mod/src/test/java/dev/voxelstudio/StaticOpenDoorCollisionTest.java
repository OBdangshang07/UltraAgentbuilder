package dev.voxelstudio;

import com.google.gson.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.world.EmptyBlockView;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

/** Independent native shape oracle; never equates an open door with air. */
class StaticOpenDoorCollisionTest {
    @BeforeAll static void init(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @Test void everySupportedOpenDoorShapeAndCentredLevelSweepMatchMinecraft1201()throws Exception{
        var rows=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/static-open-door-collisions.json"))).getAsJsonArray();
        assertTrue(rows.size()>=16);
        for(var row:rows){
            var value=row.getAsJsonObject();String text=value.get("state").getAsString();var expected=value.getAsJsonObject("collision");assertNotNull(expected,text);
            var state=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
            var boxes=state.getCollisionShape(EmptyBlockView.INSTANCE,BlockPos.ORIGIN).getBoundingBoxes();assertEquals(1,boxes.size(),text);
            var b=boxes.get(0);double[] actual={b.minX,b.minY,b.minZ,b.maxX,b.maxY,b.maxZ};var encoded=expected.getAsJsonArray("box");
            for(int i=0;i<6;i++)assertEquals(encoded.get(i).getAsDouble(),actual[i],0.0000001,text);
            assertFalse(b.intersects(new Box(.2,0,.2,.8,1.8,.8)),text+" centred standing capsule");
            int face=expected.get("face").getAsInt();
            for(int[] direction:new int[][]{{0,-1,1},{1,0,2},{0,1,4},{-1,0,8}}){
                int dx=direction[0],dz=direction[1];
                var sweep=new Box(Math.min(.2,.2+dx),0,Math.min(.2,.2+dz),Math.max(.8,.8+dx),1.8,Math.max(.8,.8+dz));
                assertEquals(face==direction[2],b.intersects(sweep),text+" edge "+direction[2]);
            }
        }
    }
}
