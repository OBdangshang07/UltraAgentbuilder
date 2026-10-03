package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceArchiveUiStateTest {
    @Test void purgeRequiresBothIndependentAcknowledgementsAndResizeInvalidatesThem(){
        var state=new ReferenceArchiveConfirmation("purge");assertFalse(state.ready());assertFalse(state.submit());
        state.toggleDeletion();assertFalse(state.submit());state.toggleDeletion();state.toggleCopies();assertFalse(state.submit());
        state.toggleDeletion();assertTrue(state.ready());state.resize();assertFalse(state.ready());assertFalse(state.deletion());assertFalse(state.copies());
        state.toggleCopies();state.toggleDeletion();state.toggleCopies();assertFalse(state.ready());state.toggleCopies();assertTrue(state.submit());
        assertFalse(state.submit());state.toggleCopies();state.toggleDeletion();assertTrue(state.copies());assertTrue(state.deletion());
        state.resize();assertTrue(state.submitted());assertFalse(state.submit());
    }
    @Test void nonDestructiveDialogsStillRequireOneExplicitSubmission(){
        for(var purpose:new String[]{"archive","restore"}){var state=new ReferenceArchiveConfirmation(purpose);assertFalse(state.submitted());assertTrue(state.ready());assertTrue(state.submit());assertFalse(state.submit());state.resize();assertFalse(state.ready());}
        assertThrows(IllegalArgumentException.class,()->new ReferenceArchiveConfirmation("delete-world"));
    }
    @Test void closingAndReopeningCannotApplyOldResultOrReleaseANewerRequest(){
        var state=new ReferenceArchiveUiOperation();long old=state.begin();assertTrue(state.busy());assertTrue(state.current(old));state.invalidate();assertTrue(state.busy());assertFalse(state.current(old));
        assertThrows(IllegalStateException.class,state::begin);var stale=state.finish(old);assertTrue(stale.released());assertFalse(stale.current());assertFalse(state.busy());
        long next=state.begin();assertTrue(state.current(next));assertFalse(state.current(old));var duplicate=state.finish(old);assertFalse(duplicate.released());assertFalse(duplicate.current());assertTrue(state.busy());
        var fresh=state.finish(next);assertTrue(fresh.released());assertTrue(fresh.current());assertFalse(state.busy());
    }
}
