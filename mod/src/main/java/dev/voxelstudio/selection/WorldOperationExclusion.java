package dev.voxelstudio.selection;

import dev.voxelstudio.PlacementService;
import net.minecraft.server.MinecraftServer;

/** Server-thread snapshot of existing operation lanes, not a new consent or
 * recoverable lock. Each owning service still validates its original owner.
 * Leaf busy readers never call this policy, preventing mutual recursion. */
public final class WorldOperationExclusion {
    public enum Kind { NEW_BUILDING,SINGLE_PATCH,WHOLE_ASSEMBLY,READ }
    record Lanes(boolean newBuilding,boolean singlePatch,boolean wholeAssembly,boolean read){}
    static boolean blocked(Kind kind,Lanes lanes){
        return switch(kind){
            case NEW_BUILDING->lanes.singlePatch||lanes.wholeAssembly||lanes.read;
            // Original Capture audits and BEFORE belong to these own lanes;
            // independent undo additionally checks READ at its entry/confirm.
            case SINGLE_PATCH->lanes.newBuilding||lanes.wholeAssembly;
            case WHOLE_ASSEMBLY->lanes.newBuilding||lanes.singlePatch;
            case READ->lanes.newBuilding||lanes.singlePatch||lanes.wholeAssembly;
        };
    }
    public static void require(MinecraftServer server,Kind kind){
        if(!server.isOnThread())throw new IllegalStateException("World operation exclusion requires server thread");
        var lanes=new Lanes(PlacementService.busy(server),WorldPatchPlacementService.busy(server),AssemblyPatchPlacementService.busy(server),SelectionReadService.busy(server));
        if(blocked(kind,lanes))throw new IllegalStateException("已有其他建筑、单片/整组改造或读取任务；等待或显式取消，不隐式接管");
    }
    private WorldOperationExclusion(){}
}
