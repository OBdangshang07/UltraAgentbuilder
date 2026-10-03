package dev.voxelstudio.client;

import net.fabricmc.api.ClientModInitializer;
import java.nio.file.*;

/** Test-only chain. The first phase grants ZERO generation/world permissions;
 * a separate, exact live authorization is checked by the second controller. */
public final class InstalledPatchAcceptanceEntrypoint implements ClientModInitializer {
    @Override public void onInitializeClient(){
        String explicit=System.getProperty("voxelstudio.installedQaRoot");
        if(explicit==null)throw new IllegalStateException("Explicit new installed test required");
        if(Files.exists(Path.of(explicit).resolve("patch-authorization.json")))
            new InstalledCompanionAcceptance(c->InstalledWorldPatchAcceptance.start(c,Path.of(explicit))).onInitializeClient();
        else new InstalledCompanionAcceptance().onInitializeClient();
    }
}
