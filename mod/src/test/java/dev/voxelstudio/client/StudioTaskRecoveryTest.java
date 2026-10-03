package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioTaskRecoveryTest {
    @Test void interruptedAndUndeliveredTasksAreQueriedWithoutResubmission(){
        for(String state:new String[]{"submitting","submitted","generating","recovering","interrupted","awaiting-preview","recovered-query"})assertTrue(StudioTaskRecovery.querySavedState(state),state);
    }
    @Test void explicitCancellationAndArchiveStayFinished(){
        for(String state:new String[]{"preview-ready","failed","cancelled","archived-unknown"})assertFalse(StudioTaskRecovery.querySavedState(state),state);
        assertFalse(StudioTaskRecovery.querySavedState(null));
    }
}
