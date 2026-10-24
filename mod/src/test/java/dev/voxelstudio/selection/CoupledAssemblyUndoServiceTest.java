package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.lang.reflect.Modifier;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** API/state checks only; no mock server or native world acceptance. */
final class CoupledAssemblyUndoServiceTest {
    @Test void everyPendingInverseCoreStateRemainsWaitingRatherThanComplete(){
        var terminal=Map.of(CoupledAssemblyUndoExecution.State.COMPLETED,CoupledAssemblyUndoService.State.COMPLETED,
            CoupledAssemblyUndoExecution.State.CANCELLED,CoupledAssemblyUndoService.State.CANCELLED,
            CoupledAssemblyUndoExecution.State.CONFLICT,CoupledAssemblyUndoService.State.CONFLICT,
            CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED,CoupledAssemblyUndoService.State.REVIEW_REQUIRED);
        for(var state:CoupledAssemblyUndoExecution.State.values())assertEquals(terminal.getOrDefault(state,
            state==CoupledAssemblyUndoExecution.State.APPLYING?CoupledAssemblyUndoService.State.RUNNING:CoupledAssemblyUndoService.State.WAIT_LOG),CoupledAssemblyUndoService.mapped(state));
        assertThrows(NullPointerException.class,()->CoupledAssemblyUndoService.mapped(null));
    }
    @Test void inverseConfirmationAndHandlesCannotBeRebuiltFromIdsOrSerializedReports(){
        for(var type:List.of(CoupledAssemblyUndoService.Confirmation.class,CoupledAssemblyUndoService.PrepareHandle.class,CoupledAssemblyUndoService.Operation.class)){
            assertFalse(java.io.Serializable.class.isAssignableFrom(type));assertEquals(0,type.getConstructors().length);
            for(var constructor:type.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
        }
    }
    @Test void evenCompletedInverseViewsNeverClaimPhysicalSaveDurability(){
        for(var state:CoupledAssemblyUndoService.State.values()){
            assertFalse(new CoupledAssemblyUndoService.Status(state,3,2,1,3,"synthetic state only").worldDurabilityVerified());
            assertFalse(new CoupledAssemblyUndoService.Result(state,3,2,1,3,"synthetic-id","not a lease").worldDurabilityVerified());
        }
    }
}
