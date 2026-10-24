package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.lang.reflect.Modifier;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Pure API/state evidence only. No Minecraft server, native write, UI action,
 * installed lifecycle or physical-save acceptance is synthesized here. */
final class CoupledAssemblyPlacementServiceTest {
    @Test void pendingCoreStatesNeverAppearAsCompletedOrAsPermission(){
        var terminal=Map.of(
            CoupledAssemblyExecution.State.COMPLETED,CoupledAssemblyPlacementService.State.COMPLETED,
            CoupledAssemblyExecution.State.CANCELLED,CoupledAssemblyPlacementService.State.CANCELLED,
            CoupledAssemblyExecution.State.CONFLICT,CoupledAssemblyPlacementService.State.CONFLICT,
            CoupledAssemblyExecution.State.REVIEW_REQUIRED,CoupledAssemblyPlacementService.State.REVIEW_REQUIRED);
        for(var state:CoupledAssemblyExecution.State.values())assertEquals(terminal.getOrDefault(state,
            state==CoupledAssemblyExecution.State.APPLYING?CoupledAssemblyPlacementService.State.RUNNING:CoupledAssemblyPlacementService.State.WAIT_LOG),CoupledAssemblyPlacementService.mapped(state));
        assertThrows(NullPointerException.class,()->CoupledAssemblyPlacementService.mapped(null));
    }
    @Test void confirmationPreparationAndOperationCannotBeCreatedFromIdsOrReports(){
        for(var type:List.of(CoupledAssemblyPlacementService.Confirmation.class,CoupledAssemblyPlacementService.PrepareHandle.class,CoupledAssemblyPlacementService.Operation.class)){
            assertFalse(java.io.Serializable.class.isAssignableFrom(type));
            for(var constructor:type.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()),type.getName());
            assertEquals(0,type.getConstructors().length);
        }
    }
    @Test void evenCompletedPublicStatusAndResultDoNotClaimPhysicalSaveVerification(){
        for(var state:CoupledAssemblyPlacementService.State.values()){
            assertFalse(new CoupledAssemblyPlacementService.Status(state,2,2,"synthetic public view only").worldDurabilityVerified());
            assertFalse(new CoupledAssemblyPlacementService.Result(state,2,2,"synthetic-id","not a lease").worldDurabilityVerified());
        }
    }
}
