package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class StudioRealAssetAuthorizationTest {
    @TempDir Path temp;
    static final String RUN = "b".repeat(32), JOB = "12345678-1234-1234-1234-123456789abc";
    record Fixture(StudioFlowWorkspaceTest.Fixture workspace, Path root, JsonObject auth, Path fixture, byte[] manifest, byte[] cells) {
        String save() throws IOException {
            byte[] bytes = auth.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            Files.write(root.resolve("authorization.json"), bytes); return StudioRealAssetAuthorization.sha(bytes);
        }
        StudioRealAssetAuthorization.Approved verify() throws IOException {
            return StudioRealAssetAuthorization.verify(workspace.root(), workspace.game(), workspace.project(), root,
                "real-asset-" + RUN, RUN, save());
        }
        void writeFixture() throws IOException { Files.write(fixture.resolve("manifest.json"), manifest); Files.write(fixture.resolve("cells.bin"), cells); }
    }
    Fixture fixture() throws Exception {
        var factory = new StudioFlowWorkspaceTest(); factory.temp = temp; var workspace = factory.fixture(false);
        Path root = Files.createDirectories(workspace.root().resolve("build/real-asset-placement-" + RUN));
        Path directory = Files.createDirectories(workspace.root().resolve("mod/build/test-fixtures/real-asset-" + RUN));
        byte[] cells = {2, 0};
        var manifest = new JsonObject(); manifest.addProperty("assetHash", "a".repeat(64));
        manifest.addProperty("cellsHash", StudioRealAssetAuthorization.sha(cells)); manifest.addProperty("diagnosticOnly", false);
        byte[] bytes = manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var auth = new JsonObject(); auth.addProperty("format", "RealAssetPlacementAuthorization"); auth.addProperty("version", 1);
        auth.addProperty("developmentRoot", workspace.root().toString()); auth.addProperty("root", root.toString());
        auth.addProperty("testRunId", RUN); auth.addProperty("worldName", "real-asset-fixture-" + RUN);
        auth.addProperty("fixture", "real-asset-" + RUN); auth.addProperty("jobId", JOB); auth.addProperty("assetHash", "a".repeat(64));
        auth.addProperty("cellsHash", StudioRealAssetAuthorization.sha(cells)); auth.addProperty("manifestSha256", StudioRealAssetAuthorization.sha(bytes));
        auth.addProperty("sourceLedgerSha256", "c".repeat(64)); auth.addProperty("sourceAssessmentSha256", "d".repeat(64));
        auth.addProperty("navigationAcknowledged", false); auth.addProperty("newWorldOnly", true);
        auth.addProperty("visibleWindowAuthorized", true); auth.addProperty("formalWorldAuthorized", false); auth.addProperty("modelCalls", 0);
        var result = new Fixture(workspace, root, auth, directory, bytes, cells); result.save(); result.writeFixture(); return result;
    }
    @Test void exactNewWorldAndPinnedBytesPassButDoNotCertifyModelOrigin() throws Exception {
        var f = fixture(); var approved = f.verify(); StudioRealAssetAuthorization.verifyNewWorld(approved);
        StudioRealAssetAuthorization.verifyFixture(approved, f.workspace().root(), f.manifest(), f.cells());
        assertEquals(JOB, approved.jobId()); assertEquals("a".repeat(64), approved.assetHash()); assertFalse(approved.navigationAcknowledged());
    }
    @Test void anyExistingNamedSaveIsRefused() throws Exception {
        var f = fixture(); var approved = f.verify(); Files.createDirectories(approved.game().resolve("saves").resolve(approved.worldName()));
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verifyNewWorld(approved));
    }
    @Test void exactCreatedWorldCannotBeReplacedByAnotherSave() throws Exception {
        var f = fixture(); var approved = f.verify(); var expected = Files.createDirectories(approved.game().resolve("saves").resolve(approved.worldName()));
        var other = Files.createDirectory(expected.getParent().resolve("other"));
        StudioRealAssetAuthorization.verifyWorld(approved, expected);
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verifyWorld(approved, other));
    }
    @Test void authorizationPinCannotBeUpdatedByRehashingAChangedLocalFile() throws Exception {
        var f = fixture(); var original = f.save(); f.auth().addProperty("navigationAcknowledged", true); f.save();
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(f.workspace().root(), f.workspace().game(), f.workspace().project(),
            f.root(), "real-asset-" + RUN, RUN, original));
    }
    @Test void widenedModelFormalWorldOrHiddenAuthorityIsRejected() throws Exception {
        var f = fixture(); var original = f.auth().deepCopy();
        for (String flag : List.of("newWorldOnly", "visibleWindowAuthorized", "formalWorldAuthorized")) {
            f.auth().addProperty(flag, !original.get(flag).getAsBoolean()); assertThrows(IOException.class, f::verify);
            f.auth().addProperty(flag, original.get(flag).getAsBoolean());
            f.auth().addProperty(flag, Boolean.toString(original.get(flag).getAsBoolean())); assertThrows(IOException.class, f::verify);
            f.auth().add(flag, original.get(flag));
        }
        for (int calls : List.of(1, 26, -1)) { f.auth().addProperty("modelCalls", calls); assertThrows(IOException.class, f::verify); }
    }
    @Test void callerRunFixtureAndOriginalProjectMustMatch() throws Exception {
        var f = fixture(); String pin = f.save(); var w = f.workspace(); var other = Files.createDirectory(temp.resolve("other"));
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(w.root(), w.game(), other, f.root(), "real-asset-" + RUN, RUN, pin));
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(w.root(), w.game(), w.project(), f.root(), "other", RUN, pin));
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(w.root(), w.game(), w.project(), f.root(), "real-asset-" + RUN, "c".repeat(32), pin));
    }
    @Test void worldRootJobAndHashesCannotBeExpandedEvenWithANewPin() throws Exception {
        var f = fixture(); var original = f.auth().deepCopy();
        for (String field : List.of("root", "developmentRoot", "worldName", "fixture", "testRunId", "jobId",
            "assetHash", "cellsHash", "manifestSha256", "sourceLedgerSha256", "sourceAssessmentSha256")) {
            f.auth().addProperty(field, "../foreign"); assertThrows(IOException.class, f::verify); f.auth().add(field, original.get(field));
        }
    }
    @Test void missingAdditionalOrMalformedFieldsFailClosed() throws Exception {
        var f = fixture(); f.auth().addProperty("worldDirectory", temp.toString()); assertThrows(IOException.class, f::verify);
        f.auth().remove("worldDirectory"); var original = f.auth().deepCopy();
        for (String key : original.keySet()) { f.auth().remove(key); assertThrows(IOException.class, f::verify); f.auth().add(key, original.get(key)); }
        for (String text : List.of("[]", "null", "{", "{}")) {
            Files.writeString(f.root().resolve("authorization.json"), text);
            assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(f.workspace().root(), f.workspace().game(), f.workspace().project(),
                f.root(), "real-asset-" + RUN, RUN, StudioRealAssetAuthorization.sha(text.getBytes(java.nio.charset.StandardCharsets.UTF_8))));
        }
    }
    @Test void versionAndCallsNeedExactIntegersNotCoercibleStringsOrFloats() throws Exception {
        var f = fixture();
        for (String field : List.of("version", "modelCalls")) {
            var original = f.auth().get(field);
            f.auth().addProperty(field, original.getAsString()); assertThrows(IOException.class, f::verify);
            f.auth().addProperty(field, 1.0); assertThrows(IOException.class, f::verify);
            f.auth().add(field, original);
        }
    }
    @Test void fixtureByteReplacementIsDetected() throws Exception {
        var f = fixture(); var approved = f.verify(); Files.write(f.fixture().resolve("cells.bin"), new byte[]{3, 0});
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verifyFixture(approved, f.workspace().root(), f.manifest(), f.cells()));
        f.writeFixture(); assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verifyFixture(approved, f.workspace().root(), f.manifest(), new byte[]{3, 0}));
    }
    @Test void diagnosticAssetRemainsRejectedWhenAllLocalHashesAreUpdated() throws Exception {
        var f = fixture(); var manifest = JsonParser.parseString(new String(f.manifest(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        manifest.addProperty("diagnosticOnly", true); byte[] bytes = manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(f.fixture().resolve("manifest.json"), bytes); f.auth().addProperty("manifestSha256", StudioRealAssetAuthorization.sha(bytes)); var approved = f.verify();
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verifyFixture(approved, f.workspace().root(), bytes, f.cells()));
    }
    @Test void manifestIdentityCannotBeSubstitutedDespiteFreshByteHashes() throws Exception {
        var f = fixture(); var manifest = JsonParser.parseString(new String(f.manifest(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        manifest.addProperty("assetHash", "e".repeat(64)); byte[] bytes = manifest.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(f.fixture().resolve("manifest.json"), bytes); f.auth().addProperty("manifestSha256", StudioRealAssetAuthorization.sha(bytes)); var approved = f.verify();
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verifyFixture(approved, f.workspace().root(), bytes, f.cells()));
    }
    @Test void oversizedAuthorizationAndRelativeOutputAreRefused() throws Exception {
        var f = fixture(); byte[] bytes = " ".repeat(65537).getBytes(java.nio.charset.StandardCharsets.UTF_8); Files.write(f.root().resolve("authorization.json"), bytes);
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(f.workspace().root(), f.workspace().game(), f.workspace().project(),
            f.root(), "real-asset-" + RUN, RUN, StudioRealAssetAuthorization.sha(bytes)));
        assertThrows(IOException.class, () -> StudioRealAssetAuthorization.verify(f.workspace().root(), f.workspace().game(), f.workspace().project(),
            Path.of("relative"), "real-asset-" + RUN, RUN, f.save()));
    }
}
