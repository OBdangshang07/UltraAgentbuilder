package dev.voxelstudio.selection;

import com.google.gson.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.WorldView;
import org.junit.jupiter.api.*;
import java.lang.reflect.Proxy;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual vanilla states/canPlaceAt, but no server/world, lease or placement. */
final class CoupledAssemblyNativeCheckTest {
    @BeforeAll static void init(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    private static BlockState state(String text)throws Exception{return BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();}
    private static final String LOWER="minecraft:dark_oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]",UPPER=LOWER.replace("half=lower","half=upper");
    private static final SelectionRegion.Point LOW=new SelectionRegion.Point(0,1,0),HIGH=new SelectionRegion.Point(0,2,0),SUPPORT=new SelectionRegion.Point(0,0,0);
    private static WorldPatchCompiler.Write write(SelectionRegion.Point p,String before,String after){return new WorldPatchCompiler.Write(p,before,after,WorldPatchPreview.air(after)?"clear":"set",WorldPatchPreview.air(before)?"added":WorldPatchPreview.air(after)?"removed":"replaced");}
    private static List<WorldPatchCompiler.Write> pair(){return List.of(write(LOW,"minecraft:air",LOWER),write(HIGH,"minecraft:air",UPPER));}
    private static CoupledAssemblyNativeCheck check(Map<SelectionRegion.Point,BlockState> world,CoupledAssemblyNativeCheck.Mode mode){return new CoupledAssemblyNativeCheck(mode,-64,320,p->world.getOrDefault(p,Blocks.AIR.getDefaultState()));}
    @Test void pendingMatchingLowerAllowsVanillaUpperPreflightWithoutWritingTheWorld()throws Exception{
        var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(SUPPORT,Blocks.STONE.getDefaultState());var oracle=check(world,CoupledAssemblyNativeCheck.Mode.FORWARD);assertTrue(oracle.check(pair(),false));assertEquals(1,world.size());assertFalse(oracle.check(pair(),true));assertFalse(oracle.canAuthorizePlacement());
        var actual=(WorldView)Proxy.newProxyInstance(WorldView.class.getClassLoader(),new Class<?>[]{WorldView.class},(proxy,method,args)->{if(method.getName().equals("getBlockState")){var p=(BlockPos)args[0];return world.getOrDefault(new SelectionRegion.Point(p.getX(),p.getY(),p.getZ()),Blocks.AIR.getDefaultState());}throw new AssertionError(method.getName());});
        assertFalse(state(UPPER).canPlaceAt(actual,new BlockPos(0,2,0)),"The unmodified live world really still has AIR below upper");for(var w:pair())world.put(w.position(),state(w.after()));assertTrue(oracle.check(pair(),true));
    }
    @Test void actualVanillaSupportNotClientBooleanDeterminesDoorPreflight()throws Exception{
        var rows=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-upper-face-support.json"))).getAsJsonArray();int tested=0;
        for(var row:rows){var r=row.getAsJsonObject();String text=r.get("state").getAsString();if(!r.get("fullUpperFace").getAsBoolean()&&!text.contains("half=bottom")&&!text.contains("type=bottom"))continue;var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(SUPPORT,state(text));boolean expected=r.get("fullUpperFace").getAsBoolean();assertEquals(expected,check(world,CoupledAssemblyNativeCheck.Mode.FORWARD).check(pair(),false),text);tested++;}assertTrue(tested>500);
        for(var support:List.of(Blocks.AIR.getDefaultState(),state("minecraft:oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]"))){var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(SUPPORT,support);assertFalse(check(world,CoupledAssemblyNativeCheck.Mode.FORWARD).check(pair(),false));}
    }
    @Test void missingMismatchedReorderedOrNoncanonicalPairCannotUseNativePreflight()throws Exception{
        var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(SUPPORT,Blocks.STONE.getDefaultState());var oracle=check(world,CoupledAssemblyNativeCheck.Mode.FORWARD);
        for(var rows:List.of(pair().subList(0,1),List.of(pair().get(1),pair().get(0)),List.of(pair().get(0),write(HIGH,"minecraft:air",UPPER.replace("hinge=left","hinge=right"))),List.of(pair().get(0),write(new SelectionRegion.Point(1,2,0),"minecraft:air",UPPER))))assertFalse(oracle.check(rows,false));
        assertFalse(oracle.check(List.of(write(LOW,"minecraft:air","minecraft:dark_oak_door")),false));assertFalse(oracle.check(List.of(write(LOW,"minecraft:air","minecraft:light[level=15,waterlogged=false]")),false));
    }
    @Test void unknownProtectedOrOutsideHeightReadsNeverBecomeSupportOrLoadedWorldFacts()throws Exception{
        var unreadable=new CoupledAssemblyNativeCheck(CoupledAssemblyNativeCheck.Mode.FORWARD,-64,320,p->null);assertFalse(unreadable.check(pair(),false));var be=new HashMap<SelectionRegion.Point,BlockState>();be.put(SUPPORT,Blocks.CHEST.getDefaultState());assertFalse(check(be,CoupledAssemblyNativeCheck.Mode.FORWARD).check(pair(),false));
        int[] reads={0};var bounded=new CoupledAssemblyNativeCheck(CoupledAssemblyNativeCheck.Mode.FORWARD,1,320,p->{reads[0]++;return Blocks.AIR.getDefaultState();});assertFalse(bounded.check(pair(),false));assertEquals(2,reads[0],"Below-height support must not reach reader");
    }
    @Test void inverseGroupRequiresBothExactOriginalDoorMembersAndStaticRestoration()throws Exception{
        var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(SUPPORT,Blocks.STONE.getDefaultState());world.put(LOW,state(LOWER));world.put(HIGH,state(UPPER));var oracle=check(world,CoupledAssemblyNativeCheck.Mode.UNDO);var rows=List.of(write(HIGH,UPPER,"minecraft:air"),write(LOW,LOWER,"minecraft:air"));assertTrue(oracle.check(rows,false));assertFalse(oracle.check(rows.subList(0,1),false));assertFalse(oracle.check(List.of(rows.get(1),rows.get(0)),false));for(var w:rows)world.put(w.position(),state(w.after()));assertTrue(oracle.check(rows,true));
    }
    @Test void exactNativeExplicitClearAndItsInverseRemainDistinctFromUnsupportedAirTargets()throws Exception{
        var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(LOW,Blocks.STONE.getDefaultState());var clear=List.of(write(LOW,"minecraft:stone","minecraft:air"));var forward=check(world,CoupledAssemblyNativeCheck.Mode.FORWARD);assertTrue(forward.check(clear,false));world.put(LOW,Blocks.AIR.getDefaultState());assertTrue(forward.check(clear,true));
        var inverse=List.of(write(LOW,"minecraft:air","minecraft:stone"));var undo=check(world,CoupledAssemblyNativeCheck.Mode.UNDO);assertTrue(undo.check(inverse,false));world.put(LOW,Blocks.STONE.getDefaultState());assertTrue(undo.check(inverse,true));assertFalse(forward.check(List.of(write(LOW,"minecraft:stone","minecraft:cave_air")),false));
    }
    @Test void everyAdmittedNonDoorStateUsesRealVanillaCanPlaceAtWithoutInventedAttachments()throws Exception{
        var fixtures=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-upper-face-support.json"))).getAsJsonArray();int count=0,trapdoors=0,stairs=0,slabs=0;
        for(var row:fixtures){String text=row.getAsJsonObject().get("state").getAsString();var actual=state(text);if(actual.getBlock() instanceof DoorBlock)continue;try{AssemblyCoupledPolicy.target(text);}catch(IllegalArgumentException e){continue;}var oracle=check(new HashMap<>(),CoupledAssemblyNativeCheck.Mode.FORWARD);assertTrue(oracle.check(List.of(write(LOW,"minecraft:air",text)),false),text);count++;if(actual.getBlock() instanceof TrapdoorBlock)trapdoors++;if(actual.getBlock() instanceof StairsBlock)stairs++;if(actual.getBlock() instanceof SlabBlock)slabs++;}
        // Fixed original catalogue:1128 variants,931 admitted non-door states.
        // Check exact enumeration, not an invented >1000 non-door threshold.
        assertEquals(1128,fixtures.size());assertEquals(931,count);assertEquals(96,trapdoors);assertEquals(680,stairs);assertEquals(54,slabs);
    }
    private static WorldView pending(CoupledAssemblyNativeCheck oracle,Map<SelectionRegion.Point,BlockState> targets)throws Exception{
        var method=CoupledAssemblyNativeCheck.class.getDeclaredMethod("pending",Map.class);method.setAccessible(true);return (WorldView)method.invoke(oracle,targets);
    }
    @Test void typedRuntimeQueryIdentitiesPreserveBothHeightOverloadsAndPendingStates()throws Exception{
        var world=new HashMap<SelectionRegion.Point,BlockState>();world.put(SUPPORT,Blocks.STONE.getDefaultState());
        var view=pending(check(world,CoupledAssemblyNativeCheck.Mode.FORWARD),Map.of(LOW,state(LOWER),HIGH,state(UPPER)));
        assertEquals(-64,view.getBottomY());assertEquals(384,view.getHeight());assertEquals(320,view.getTopY());
        assertFalse(view.isOutOfHeightLimit(-64));assertTrue(view.isOutOfHeightLimit(320));
        assertFalse(view.isOutOfHeightLimit(new BlockPos(0,319,0)));assertTrue(view.isOutOfHeightLimit(new BlockPos(0,-65,0)));
        assertEquals(state(LOWER),view.getBlockState(new BlockPos(0,1,0)));assertEquals(Blocks.STONE.getDefaultState(),view.getBlockState(BlockPos.ORIGIN));
        assertTrue(view.getFluidState(new BlockPos(0,1,0)).isEmpty());
    }
    @Test void unadmittedWorldQueryCannotReadProtectedDataOrFallThroughToTheWorld()throws Exception{
        int[] reads={0};var oracle=new CoupledAssemblyNativeCheck(CoupledAssemblyNativeCheck.Mode.FORWARD,-64,320,p->{reads[0]++;return Blocks.STONE.getDefaultState();});
        var view=pending(oracle,Map.of());assertThrows(IllegalStateException.class,()->view.getBlockEntity(BlockPos.ORIGIN));assertEquals(0,reads[0]);
        assertEquals(Blocks.STONE.getDefaultState(),view.getBlockState(BlockPos.ORIGIN));assertEquals(1,reads[0]);
        assertThrows(IllegalStateException.class,()->view.getBlockState(new BlockPos(0,320,0)));assertEquals(1,reads[0]);
    }
}

