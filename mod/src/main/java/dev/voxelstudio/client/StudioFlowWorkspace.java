package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;

/** Read-only source-copy identity gate. No account, model or world APIs. */
final class StudioFlowWorkspace {
    private StudioFlowWorkspace() {}

    static Path verify(Path development, Path game, Path sourceProject) throws IOException {
        Path root = physicalDirectory(development), source = physicalDirectory(sourceProject);
        require(root.getFileName().toString().matches("p3-selection-development-[a-f0-9]{32}"), "Invalid development name");
        require(physicalDirectory(game).equals(physicalDirectory(root.resolve("mod/run"))), "Not the independent development game");
        Path receipt = root.resolve("development-workspace.json");
        require(Files.isRegularFile(receipt, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(receipt)
            && receipt.toRealPath().equals(receipt) && Files.size(receipt) <= 4L * 1024 * 1024, "Invalid source-copy receipt file");
        try {
            var copy = JsonParser.parseString(Files.readString(receipt)).getAsJsonObject();
            require("source-only-selection-development-workspace".equals(string(copy, "type"))
                && "passed".equals(string(copy, "result")), "Invalid source-copy receipt");
            require(path(copy, "root").equals(root) && path(copy, "sourceProject").equals(source), "Source-copy project binding mismatch");
            for (String flag : new String[]{"developmentOnly"}) require(bool(copy, flag), "Development-only receipt required");
            for (String flag : new String[]{"worldsCopied", "accountDataCopied", "bridgeDataCopied"}) require(!bool(copy, flag), "Private data copied");
            String layout = copy.has("workspaceLayout") ? string(copy, "workspaceLayout") : "project-source-v1";
            Path parent;
            if ("project-source-v1".equals(layout)) {
                parent = physicalDirectory(source.resolve("build"));
                if (copy.has("workspaceParent")) require(path(copy, "workspaceParent").equals(parent), "Legacy parent mismatch");
            } else {
                require("archive-drive-source-v1".equals(layout), "Unknown source-copy layout");
                // Resolve ONLY the existing original project's mod/build binding.
                // This intentional build junction is not permission for arbitrary archives.
                parent = physicalDirectory(source.resolve("mod/build").toRealPath());
                require(parent.getFileName().toString().equals("build")
                    && parent.getParent().getFileName().toString().matches("voxel-studio-build-[0-9-]+"), "Invalid physical archive parent");
                require(path(copy, "workspaceParent").equals(parent), "Archive parent mismatch");
                require(bool(copy, "newFilesOnly") && !bool(copy, "priorFilesMoved")
                    && bool(copy, "sourceCacheRetained"), "New source-copy flags required");
            }
            require(root.getParent().equals(parent), "Source copy outside bound parent");
            return source;
        } catch (JsonParseException | IllegalArgumentException | IllegalStateException | NullPointerException ex) {
            throw new IOException("Invalid independent source-copy identity", ex);
        }
    }

    private static Path physicalDirectory(Path path) throws IOException {
        require(path != null && path.isAbsolute() && path.normalize().equals(path), "Absolute physical path required");
        require(Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path)
            && path.toRealPath().equals(path), "Source-copy path aliases forbidden");
        return path;
    }
    private static Path path(JsonObject object, String key) throws IOException {
        Path value = Path.of(string(object, key));
        require(value.isAbsolute() && value.normalize().equals(value) && value.toRealPath().equals(value), "Invalid receipt path: " + key);
        return value;
    }
    private static String string(JsonObject object, String key) throws IOException {
        JsonElement value = object.get(key);
        require(value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString(), "Missing receipt string: " + key);
        return value.getAsString();
    }
    private static boolean bool(JsonObject object, String key) throws IOException {
        JsonElement value = object.get(key);
        require(value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean(), "Missing receipt boolean: " + key);
        return value.getAsBoolean();
    }
    private static void require(boolean valid, String message) throws IOException {
        if (!valid) throw new IOException(message);
    }
}
