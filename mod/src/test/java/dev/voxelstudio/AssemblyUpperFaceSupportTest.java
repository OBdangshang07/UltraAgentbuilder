package dev.voxelstudio;

import com.google.gson.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.world.EmptyBlockView;
import net.minecraft.world.WorldView;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.util.*;
import java.lang.reflect.Proxy;
import static org.junit.jupiter.api.Assertions.*;

/** Native 1.20.1 shape oracle for the independent READ-ONLY coupling analysis.
 * No application/transaction implementation or live server is tested here. */
final class AssemblyUpperFaceSupportTest {
    @BeforeAll static void init(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @Test void everyAdmittedUpperFaceActuallyIsAFullSquareInVanilla()throws Exception{
        var rows=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-upper-face-support.json"))).getAsJsonArray();
        assertTrue(rows.size()>1000);var seen=new HashSet<String>();int admitted=0,partial=0;
        for(var row:rows){
            var value=row.getAsJsonObject();String text=value.get("state").getAsString();assertTrue(seen.add(text));
            var state=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
            boolean actual=state.isSideSolidFullSquare(EmptyBlockView.INSTANCE,BlockPos.ORIGIN,Direction.UP);
            if(value.get("fullUpperFace").getAsBoolean()){
                assertTrue(actual,text);admitted++;
                if(state.getBlock() instanceof StairsBlock||state.getBlock() instanceof SlabBlock)partial++;
            }
            // Conservative false does not claim that every possible Vanilla
            // attachment/collision shape is false; closed trapdoors differ.
            if(state.isAir()||text.contains("half=bottom")&&state.getBlock() instanceof StairsBlock
                ||text.contains("type=bottom")&&state.getBlock() instanceof SlabBlock)assertFalse(actual,text);
        }
        assertTrue(admitted>400);assertTrue(partial>300);
    }
    @Test void vanillaTrapdoorPlacementDoesNotInventAnAttachmentRequirement()throws Exception{
        // No world is created. Any attempt to inspect an attachment or support
        // fails this test instead of returning invented air/solid block facts.
        var unreadable=(WorldView)Proxy.newProxyInstance(WorldView.class.getClassLoader(),new Class<?>[]{WorldView.class},
            (proxy,method,args)->{throw new AssertionError("Unexpected world read: "+method.getName());});
        var rows=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-upper-face-support.json"))).getAsJsonArray();
        int tested=0;
        for(var row:rows){
            String text=row.getAsJsonObject().get("state").getAsString();
            var state=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
            if(state.getBlock() instanceof TrapdoorBlock){assertTrue(state.canPlaceAt(unreadable,BlockPos.ORIGIN),text);tested++;}
        }
        assertEquals(96,tested);
    }
}
