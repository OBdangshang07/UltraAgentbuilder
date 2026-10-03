package dev.voxelstudio.client;

import java.util.Set;

/** Read-only lookup eligibility, never authority to submit another generation. */
final class StudioTaskRecovery {
    private static final Set<String> FINISHED=Set.of("preview-ready","failed","cancelled","archived-unknown");
    static boolean querySavedState(String state){
        // "interrupted" may have been saved during orderly Bridge shutdown.
        // The restarted Bridge owns whether its same job can safely continue.
        return state!=null&&!FINISHED.contains(state);
    }
}
