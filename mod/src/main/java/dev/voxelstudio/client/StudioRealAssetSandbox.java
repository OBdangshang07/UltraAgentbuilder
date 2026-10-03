package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.resource.DataConfiguration;
import net.minecraft.util.WorldSavePath;
import net.minecraft.world.*;
import net.minecraft.world.gen.*;
import net.minecraft.world.level.LevelInfo;
import java.nio.file.*;

/** No model API. Loads exact completed cells and creates a never-existing save. */
final class StudioRealAssetSandbox {
    static boolean enabled() {
        return FabricLoader.getInstance().isDevelopmentEnvironment() && Boolean.getBoolean("voxelstudio.selftest")
            && System.getProperty("voxelstudio.realAssetTestRoot") != null;
    }
    static StudioRealAssetAuthorization.Approved approved() throws Exception {
        if (!enabled() || StudioFlowSelfTest.enabled() || System.getProperty("voxelstudio.testJob") != null
            || !"visible".equals(System.getProperty("voxelstudio.testWindowHideMode")))
            throw new IllegalStateException("Explicit visible real-asset-only test required");
        Path game = FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize(), development = game.getParent().getParent();
        var approval = StudioRealAssetAuthorization.verify(development, game,
            Path.of(System.getProperty("voxelstudio.realAssetSourceProject")),
            Path.of(System.getProperty("voxelstudio.realAssetTestRoot")),
            System.getProperty("voxelstudio.testFixture"), System.getProperty("voxelstudio.testRunId"),
            System.getProperty("voxelstudio.realAssetAuthorizationHash"));
        if (approval.navigationAcknowledged() != Boolean.getBoolean("voxelstudio.testNavigationAcknowledged"))
            throw new IllegalStateException("Navigation acknowledgement must match explicit test authority");
        return approval;
    }
    static void create(MinecraftClient client) throws Exception {
        var approval = approved(); StudioRealAssetAuthorization.verifyNewWorld(approval);
        if (client.getServer() != null || client.world != null) throw new IllegalStateException("Existing world is not allowed");
        var identity = new JsonObject(); identity.addProperty("pid", ProcessHandle.current().pid());
        identity.addProperty("startedAt", ProcessHandle.current().info().startInstant().orElseThrow().toEpochMilli());
        identity.addProperty("testRunId", approval.runId());
        Files.writeString(approval.root().resolve("process.json"), identity.toString(), StandardOpenOption.CREATE_NEW);
        client.options.getViewDistance().setValue(4); client.getTutorialManager().setStep(net.minecraft.client.tutorial.TutorialStep.NONE);
        var rules = new GameRules(); rules.get(GameRules.DO_MOB_SPAWNING).set(false, null); rules.get(GameRules.DO_DAYLIGHT_CYCLE).set(false, null);
        var info = new LevelInfo(approval.worldName(), GameMode.CREATIVE, false, Difficulty.PEACEFUL, true, rules, DataConfiguration.SAFE_MODE);
        client.createIntegratedServerLoader().createAndStart(approval.worldName(), info, new GeneratorOptions(3393, false, false),
            registries -> registries.get(RegistryKeys.WORLD_PRESET).getOrThrow(WorldPresets.FLAT).createDimensionsRegistryHolder());
    }
    static void verifyWorld(MinecraftClient client) throws Exception {
        if (client.getServer() == null) throw new IllegalStateException("Real-asset test server missing");
        StudioRealAssetAuthorization.verifyWorld(approved(), client.getServer().getSavePath(WorldSavePath.ROOT).toAbsolutePath().normalize());
    }
}
