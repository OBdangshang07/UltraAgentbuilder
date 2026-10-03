package dev.voxelstudio;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class StudioBrandTest {
    @Test void displayNameDoesNotChangeCompatibilityNamespace() throws Exception {
        assertEquals("UltraAgentbuilder", StudioBrand.NAME);
        var configured = System.getProperty("ultraagentbuilder.testModMetadata");
        assertNotNull(configured, "Exact processed mod metadata required");
        var file = Path.of(configured).toRealPath();
        assertTrue(Files.isRegularFile(file));
        var metadata = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        assertEquals(StudioBrand.NAME, metadata.get("name").getAsString());
        assertEquals("voxel_studio", metadata.get("id").getAsString());
        assertEquals("dev.voxelstudio.VoxelStudio", metadata.getAsJsonObject("entrypoints").getAsJsonArray("main").get(0).getAsString());
    }
}
