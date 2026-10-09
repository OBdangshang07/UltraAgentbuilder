package dev.voxelstudio;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;

public final class VoxelStudio implements ModInitializer {
    public static final String ID = "voxel_studio";
    @Override public void onInitialize() {
        ServerTickEvents.START_SERVER_TICK.register(s->dev.voxelstudio.selection.SelectionPerformanceProbe.serverStart());
        ServerTickEvents.END_SERVER_TICK.register(PlacementService::tick);
        ServerTickEvents.END_SERVER_TICK.register(dev.voxelstudio.selection.SelectionReadService::tick);
        ServerTickEvents.END_SERVER_TICK.register(dev.voxelstudio.selection.WorldPatchPlacementService::tick);
        ServerTickEvents.END_SERVER_TICK.register(dev.voxelstudio.selection.WorldPatchUndoService::tick);
        ServerTickEvents.END_SERVER_TICK.register(dev.voxelstudio.selection.AssemblyPatchPlacementService::tick);
        ServerTickEvents.END_SERVER_TICK.register(dev.voxelstudio.selection.AssemblyPatchUndoService::tick);
        ServerTickEvents.END_SERVER_TICK.register(s->dev.voxelstudio.selection.SelectionPerformanceProbe.serverEnd());
        ServerLifecycleEvents.SERVER_STOPPING.register(PlacementService::stopping);
        ServerLifecycleEvents.SERVER_STOPPING.register(dev.voxelstudio.selection.AssemblyPatchUndoService::stopping);
        ServerLifecycleEvents.SERVER_STOPPING.register(dev.voxelstudio.selection.AssemblyPatchPlacementService::stopping);
        ServerLifecycleEvents.SERVER_STOPPING.register(dev.voxelstudio.selection.WorldPatchUndoService::stopping);
        ServerLifecycleEvents.SERVER_STOPPING.register(dev.voxelstudio.selection.WorldPatchPlacementService::stopping);
        ServerLifecycleEvents.SERVER_STOPPING.register(dev.voxelstudio.selection.SelectionReadService::stopping);
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents.CHUNK_LOAD.register((w,c)->WorldChangeTracker.chunk(w,c.getPos().x,c.getPos().z));
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents.CHUNK_UNLOAD.register((w,c)->WorldChangeTracker.chunk(w,c.getPos().x,c.getPos().z));
    }
}
