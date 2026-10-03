package dev.voxelstudio.client;

import net.fabricmc.loader.api.FabricLoader;

/** Reports the loaded mod, not a manually maintained test-version label. */
final class StudioRuntimeVersion {
    private StudioRuntimeVersion() {}
    static String loaded() {
        return FabricLoader.getInstance().getModContainer("voxel_studio")
            .orElseThrow(() -> new IllegalStateException("Voxel Studio runtime metadata is missing"))
            .getMetadata().getVersion().getFriendlyString();
    }
}
