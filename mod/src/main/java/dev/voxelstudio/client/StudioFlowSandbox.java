package dev.voxelstudio.client;

import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.resource.DataConfiguration;
import net.minecraft.util.WorldSavePath;
import net.minecraft.world.*;
import net.minecraft.world.gen.*;
import net.minecraft.world.level.LevelInfo;
import java.nio.file.*;

/** Explicit NEW-world source-fork gate for free player-flow testing. This does
 * not broaden the legacy self-test boundary or authorize production worlds. */
final class StudioFlowSandbox {
    static boolean enabled(){return StudioFlowSelfTest.enabled()&&System.getProperty("voxelstudio.flowFreshWorld")!=null;}
    static Path root()throws Exception{
        if(!enabled())throw new IllegalStateException("Explicit new-world flow gate required");
        Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize(),development=game.getParent().getParent();
        String boundProject=System.getProperty("voxelstudio.flowSourceProject");
        if(boundProject==null)throw new IllegalStateException("Explicit original source-project binding required");
        StudioFlowWorkspace.verify(development,game,Path.of(boundProject));
        Path root=Path.of(System.getProperty("voxelstudio.flowTestRoot")).toRealPath();
        if(!root.getParent().equals(development.resolve("build").toRealPath())||!root.getFileName().toString().matches("player-flow-[a-f0-9]{32}"))throw new IllegalStateException("Unsafe fresh flow output");
        var auth=JsonParser.parseString(Files.readString(root.resolve("authorization.json"))).getAsJsonObject();
        String name=System.getProperty("voxelstudio.flowFreshWorld"),expected="player-flow-fixture-"+root.getFileName().toString().substring("player-flow-".length());
        if(!expected.equals(name)||!expected.equals(auth.get("worldName").getAsString())||!auth.get("newWorldOnly").getAsBoolean()||!auth.get("visibleWindowAuthorized").getAsBoolean()||auth.get("modelCalls").getAsInt()!=0||auth.get("formalWorldAuthorized").getAsBoolean())throw new IllegalStateException("Invalid fresh flow authorization");
        return root;
    }
    static void create(MinecraftClient c)throws Exception{
        Path root=root(),game=FabricLoader.getInstance().getGameDir().toRealPath();String name=System.getProperty("voxelstudio.flowFreshWorld");
        if(c.getServer()!=null||c.world!=null||Files.exists(game.resolve("saves").resolve(name)))throw new IllegalStateException("Refusing to open any existing flow world");
        var process=new JsonObject();process.addProperty("pid",ProcessHandle.current().pid());process.addProperty("startedAt",ProcessHandle.current().info().startInstant().orElseThrow().toEpochMilli());
        Files.writeString(root.resolve("process.json"),process.toString(),StandardOpenOption.CREATE_NEW);
        c.options.getViewDistance().setValue(4);c.getTutorialManager().setStep(net.minecraft.client.tutorial.TutorialStep.NONE);
        var rules=new GameRules();rules.get(GameRules.DO_MOB_SPAWNING).set(false,null);rules.get(GameRules.DO_DAYLIGHT_CYCLE).set(false,null);
        var info=new LevelInfo(name,GameMode.CREATIVE,false,Difficulty.PEACEFUL,true,rules,DataConfiguration.SAFE_MODE);
        c.createIntegratedServerLoader().createAndStart(name,info,new GeneratorOptions(3393,false,false),registries->registries.get(RegistryKeys.WORLD_PRESET).getOrThrow(WorldPresets.FLAT).createDimensionsRegistryHolder());
    }
    static void verifyWorld(MinecraftClient c)throws Exception{
        root();if(c.getServer()==null)throw new IllegalStateException("Fresh flow server missing");
        Path actual=c.getServer().getSavePath(WorldSavePath.ROOT).toRealPath(),expected=FabricLoader.getInstance().getGameDir().toRealPath().resolve("saves").resolve(System.getProperty("voxelstudio.flowFreshWorld")).toRealPath();
        if(!actual.equals(expected))throw new IllegalStateException("Not the exact newly created flow world");
    }
}
