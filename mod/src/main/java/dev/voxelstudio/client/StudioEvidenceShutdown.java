package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/** Opt-in, dev-only shutdown witness. Never requests a stop or changes its outcome. */
public final class StudioEvidenceShutdown {
    private static final EvidenceShutdownTrace TRACE = new EvidenceShutdownTrace();
    private static Path output;
    private static JsonObject identity;
    private StudioEvidenceShutdown() {}

    static void controlled(boolean resultWritten) {
        TRACE.controlled(resultWritten ? EvidenceShutdownTrace.Controlled.RESULT_WRITTEN
                                      : EvidenceShutdownTrace.Controlled.FAILURE_WRITTEN);
    }

    private static void initialize() throws Exception {
        if (output != null) return;
        Path root = StudioEvidenceSelfTest.root(); // Existing exact isolated-root authority.
        var marker = JsonParser.parseString(Files.readString(root.resolve("renderer-authorization.json"))).getAsJsonObject();
        String instance = marker.get("instanceId").getAsString();
        if (!instance.matches("[a-f0-9-]{36}")) throw new IllegalStateException("Invalid renderer instance");
        var process = new JsonObject();
        process.addProperty("instanceId", instance);
        process.addProperty("pid", ProcessHandle.current().pid());
        process.addProperty("startedAt", ProcessHandle.current().info().startInstant().orElseThrow().toEpochMilli());
        identity = process;
        output = root;
    }

    public static synchronized void observe(MinecraftClient client, boolean stopping) {
        if (!StudioEvidenceSelfTest.enabled()) return;
        try {
            initialize();
            boolean close = client.getWindow() != null && client.getWindow().shouldClose();
            var observation = TRACE.observe(stopping, close, client.world != null,
                client.getServer() != null, Thread.currentThread().getStackTrace());
            if (observation == null) return;
            observation.add("processIdentity", identity.deepCopy());
            observation.addProperty("observedAt", System.currentTimeMillis());
            // Separate immutable files; never overwrite renderer-result/failure/exit.
            Files.writeString(output.resolve("renderer-shutdown-" + observation.get("sequence").getAsInt() + ".json"),
                observation.toString(), StandardOpenOption.CREATE_NEW);
        } catch (Exception ignored) {
            System.err.println("ULTRAAGENTBUILDER_EVIDENCE_SHUTDOWN_OBSERVATION_UNAVAILABLE");
        }
    }
}
