package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Explicit test-only authority for ONE completed asset in ONE new world.
 * This is neither a model receipt verifier nor production write permission. */
final class StudioRealAssetAuthorization {
    record Approved(Path root, Path game, String runId, String worldName, String fixture,
                    String jobId, String assetHash, String cellsHash, String manifestSha256,
                    boolean navigationAcknowledged) {}
    private static final Set<String> KEYS = Set.of("format", "version", "developmentRoot", "root",
        "testRunId", "worldName", "fixture", "jobId", "assetHash", "cellsHash", "manifestSha256",
        "sourceLedgerSha256", "sourceAssessmentSha256", "navigationAcknowledged",
        "newWorldOnly", "visibleWindowAuthorized", "formalWorldAuthorized", "modelCalls");

    static Approved verify(Path development, Path game, Path sourceProject, Path output,
                           String fixture, String runId, String authorizationHash) throws IOException {
        StudioFlowWorkspace.verify(development, game, sourceProject);
        Path root = physicalDirectory(output);
        require(root.getParent().equals(physicalDirectory(development.resolve("build")))
            && root.getFileName().toString().equals("real-asset-placement-" + runId)
            && runId != null && runId.matches("[a-f0-9]{32}"), "Exact real-asset output required");
        require(authorizationHash != null && authorizationHash.matches("[a-f0-9]{64}"), "Pinned test authorization required");
        byte[] bytes = physicalFile(root.resolve("authorization.json"), 65536);
        require(sha(bytes).equals(authorizationHash), "Real-asset authorization changed");
        try {
            var auth = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            require(auth.keySet().equals(KEYS), "Unexpected real-asset authorization fields");
            require("RealAssetPlacementAuthorization".equals(string(auth, "format")) && integer(auth, "version") == 1,
                "Unsupported real-asset authorization");
            require(development.toString().equals(string(auth, "developmentRoot")) && root.toString().equals(string(auth, "root"))
                && runId.equals(string(auth, "testRunId")), "Real-asset source or run mismatch");
            String world = "real-asset-fixture-" + runId, expectedFixture = "real-asset-" + runId;
            require(world.equals(string(auth, "worldName")) && expectedFixture.equals(fixture)
                && expectedFixture.equals(string(auth, "fixture")), "Real-asset world or fixture mismatch");
            require(bool(auth, "newWorldOnly") && bool(auth, "visibleWindowAuthorized")
                && !bool(auth, "formalWorldAuthorized") && integer(auth, "modelCalls") == 0, "New isolated world only");
            String job = string(auth, "jobId");
            require(job.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"), "Original real-asset job required");
            for (String key : List.of("assetHash", "cellsHash", "manifestSha256", "sourceLedgerSha256", "sourceAssessmentSha256"))
                require(string(auth, key).matches("[a-f0-9]{64}"), "Pinned original artifact hash required");
            return new Approved(root, game, runId, world, fixture, job, string(auth, "assetHash"),
                string(auth, "cellsHash"), string(auth, "manifestSha256"), bool(auth, "navigationAcknowledged"));
        } catch (JsonParseException | IllegalArgumentException | IllegalStateException | NullPointerException ex) {
            throw new IOException("Malformed real-asset authorization", ex);
        }
    }

    static void verifyNewWorld(Approved approved) throws IOException {
        require(!Files.exists(approved.game().resolve("saves").resolve(approved.worldName()), LinkOption.NOFOLLOW_LINKS),
            "Refusing to open any existing real-asset world");
    }
    static void verifyWorld(Approved approved, Path actual) throws IOException {
        require(physicalDirectory(actual).equals(physicalDirectory(approved.game().resolve("saves").resolve(approved.worldName()))),
            "Not the exact new real-asset world");
    }
    static void verifyFixture(Approved approved, Path development, byte[] manifest, byte[] cells) throws IOException {
        Path directory = physicalDirectory(development.resolve("mod/build/test-fixtures").resolve(approved.fixture()));
        require(Arrays.equals(manifest, physicalFile(directory.resolve("manifest.json"), 4 * 1024 * 1024))
            && Arrays.equals(cells, physicalFile(directory.resolve("cells.bin"), 16 * 1024 * 1024)),
            "Real-asset fixture changed while loading");
        require(sha(manifest).equals(approved.manifestSha256()) && sha(cells).equals(approved.cellsHash()),
            "Real-asset bytes differ from original");
        try {
            var metadata = JsonParser.parseString(new String(manifest, StandardCharsets.UTF_8)).getAsJsonObject();
            require(string(metadata, "assetHash").equals(approved.assetHash()) && string(metadata, "cellsHash").equals(approved.cellsHash()),
                "Real-asset native identity mismatch");
            require(!metadata.has("diagnosticOnly") || !bool(metadata, "diagnosticOnly"), "Diagnostic asset is never placeable");
        } catch (JsonParseException | IllegalArgumentException | IllegalStateException | NullPointerException ex) {
            throw new IOException("Malformed real-asset manifest", ex);
        }
    }
    private static Path physicalDirectory(Path path) throws IOException {
        require(path != null && path.isAbsolute() && path.normalize().equals(path)
            && Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path)
            && path.toRealPath().equals(path), "Absolute physical real-asset directory required");
        return path;
    }
    private static byte[] physicalFile(Path path, long maximum) throws IOException {
        require(Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path)
            && path.toRealPath().equals(path) && Files.size(path) <= maximum, "Unsafe real-asset evidence file");
        byte[] bytes = Files.readAllBytes(path); require(bytes.length <= maximum, "Real-asset evidence quota"); return bytes;
    }
    static String sha(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception ex) { throw new IllegalStateException(ex); }
    }
    private static String string(JsonObject object, String key) throws IOException {
        var value = object.get(key); require(value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString(), "String required: " + key);
        return value.getAsString();
    }
    private static boolean bool(JsonObject object, String key) throws IOException {
        var value = object.get(key); require(value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean(), "Boolean required: " + key);
        return value.getAsBoolean();
    }
    private static int integer(JsonObject object, String key) throws IOException {
        var value = object.get(key); require(value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()
            && value.getAsString().matches("0|[1-9][0-9]*"), "Integer required: " + key);
        try { return Integer.parseInt(value.getAsString()); } catch (NumberFormatException ex) { throw new IOException("Integer quota", ex); }
    }
    private static void require(boolean valid, String message) throws IOException { if (!valid) throw new IOException(message); }
}
