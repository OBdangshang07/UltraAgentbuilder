package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class StudioFlowWorkspaceTest {
    @TempDir Path temp;
    record Fixture(Path project, Path root, Path game, Path receipt, JsonObject copy) {
        void save() throws IOException { Files.writeString(receipt, copy.toString()); }
        Path verify() throws IOException { return StudioFlowWorkspace.verify(root, game, project); }
    }
    Fixture fixture(boolean archive) throws Exception {
        Path project = Files.createDirectories(temp.resolve("project")).toRealPath();
        Files.createDirectories(project.resolve("mod")); Files.createDirectories(project.resolve("build"));
        Path parent = archive ? Files.createDirectories(temp.resolve("voxel-studio-build-20261002-001/build")).toRealPath() : project.resolve("build");
        if (archive) {
            Path link = project.resolve("mod/build");
            if (System.getProperty("os.name").startsWith("Windows")) {
                Process child = new ProcessBuilder("cmd.exe", "/d", "/c", "mklink", "/J", link.toString(), parent.toString()).redirectErrorStream(true).start();
                String output = new String(child.getInputStream().readAllBytes()); assertEquals(0, child.waitFor(), output);
            } else Files.createSymbolicLink(link, parent);
        }
        Path root = Files.createDirectory(parent.resolve("p3-selection-development-" + "a".repeat(32)));
        Path game = Files.createDirectories(root.resolve("mod/run"));
        var copy = new JsonObject(); copy.addProperty("type", "source-only-selection-development-workspace"); copy.addProperty("result", "passed");
        copy.addProperty("root", root.toString()); copy.addProperty("sourceProject", project.toString()); copy.addProperty("developmentOnly", true);
        for (String flag : List.of("worldsCopied", "accountDataCopied", "bridgeDataCopied")) copy.addProperty(flag, false);
        if (archive) { copy.addProperty("workspaceLayout", "archive-drive-source-v1"); copy.addProperty("workspaceParent", parent.toString());
            copy.addProperty("newFilesOnly", true); copy.addProperty("priorFilesMoved", false); copy.addProperty("sourceCacheRetained", true); }
        var fixture = new Fixture(project, root, game, root.resolve("development-workspace.json"), copy); fixture.save(); return fixture;
    }
    @Test void exactLegacyProjectLayoutPasses() throws Exception { var f = fixture(false); assertEquals(f.project(), f.verify()); }
    @Test void exactArchiveBoundToOriginalBuildJunctionPasses() throws Exception { var f = fixture(true); assertEquals(f.project(), f.verify()); }
    @Test void sourceProjectIsBoundByCallerNotReceipt() throws Exception {
        var f = fixture(false); Path other = Files.createDirectory(temp.resolve("other"));
        assertThrows(IOException.class, () -> StudioFlowWorkspace.verify(f.root(), f.game(), other));
        f.copy().addProperty("sourceProject", other.toString()); f.save(); assertThrows(IOException.class, f::verify);
    }
    @Test void wrongReceiptRootAndGameAreRejected() throws Exception {
        var f = fixture(false); Path other = Files.createDirectories(temp.resolve("other/mod/run"));
        assertThrows(IOException.class, () -> StudioFlowWorkspace.verify(f.root(), other, f.project()));
        f.copy().addProperty("root", other.toString()); f.save(); assertThrows(IOException.class, f::verify);
    }
    @Test void archiveRequiresAllNewCopyFlags() throws Exception {
        var f = fixture(true); var original = f.copy().deepCopy();
        for (String flag : List.of("newFilesOnly", "priorFilesMoved", "sourceCacheRetained")) {
            f.copy().addProperty(flag, !original.get(flag).getAsBoolean()); f.save(); assertThrows(IOException.class, f::verify);
            f.copy().add(flag, original.get(flag));
            f.copy().remove(flag); f.save(); assertThrows(IOException.class, f::verify); f.copy().add(flag, original.get(flag));
        }
    }
    @Test void privateDataOrNonDevelopmentFlagsAreRejected() throws Exception {
        var f = fixture(false);
        for (String flag : List.of("developmentOnly", "worldsCopied", "accountDataCopied", "bridgeDataCopied")) {
            boolean original = f.copy().get(flag).getAsBoolean(); f.copy().addProperty(flag, !original); f.save(); assertThrows(IOException.class, f::verify);
            f.copy().addProperty(flag, Boolean.toString(original)); f.save(); assertThrows(IOException.class, f::verify);
            f.copy().addProperty(flag, original);
        }
    }
    @Test void unknownOrLegacyLayoutCannotAuthorizeArchive() throws Exception {
        var f = fixture(true);
        for (String layout : List.of("arbitrary-drive", "project-source-v1")) { f.copy().addProperty("workspaceLayout", layout); f.save(); assertThrows(IOException.class, f::verify); }
        f.copy().remove("workspaceLayout"); f.save(); assertThrows(IOException.class, f::verify);
    }
    @Test void archiveReceiptCannotReplacePhysicalProjectBinding() throws Exception {
        var f = fixture(true); Path other = Files.createDirectories(temp.resolve("voxel-studio-build-20261002-002/build"));
        f.copy().addProperty("workspaceParent", other.toString()); f.save(); assertThrows(IOException.class, f::verify);
    }
    @Test void malformedFailedAndOversizeReceiptsAreRejected() throws Exception {
        var f = fixture(false);
        for (String text : List.of("null", "[]", "{", "{}")) { Files.writeString(f.receipt(), text); assertThrows(IOException.class, f::verify); }
        f.copy().addProperty("result", "failed"); f.save(); assertThrows(IOException.class, f::verify);
        Files.writeString(f.receipt(), " ".repeat(4 * 1024 * 1024 + 1)); assertThrows(IOException.class, f::verify);
    }
    @Test void nonNormalizedAndMissingSourceBindingsAreRejected() throws Exception {
        var f = fixture(false); assertThrows(IOException.class, () -> StudioFlowWorkspace.verify(f.root(), f.game(), null));
        assertThrows(IOException.class, () -> StudioFlowWorkspace.verify(f.root(), f.game(), Path.of("relative")));
        f.copy().addProperty("sourceProject", f.project().resolve("mod/..").toString()); f.save(); assertThrows(IOException.class, f::verify);
    }
    @Test void linkedRootIsRejectedBeforeWorldCreation() throws Exception {
        var f = fixture(true); Path alias = f.project().resolve("build").resolve(f.root().getFileName());
        if (System.getProperty("os.name").startsWith("Windows")) {
            Process child = new ProcessBuilder("cmd.exe", "/d", "/c", "mklink", "/J", alias.toString(), f.root().toString()).redirectErrorStream(true).start();
            String output = new String(child.getInputStream().readAllBytes()); assertEquals(0, child.waitFor(), output);
        } else Files.createSymbolicLink(alias, f.root());
        assertThrows(IOException.class, () -> StudioFlowWorkspace.verify(alias, alias.resolve("mod/run"), f.project()));
    }
}
