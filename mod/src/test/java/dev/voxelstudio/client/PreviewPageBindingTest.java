package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class PreviewPageBindingTest {
    @Test void exactDisplayedCandidateCanOpenOnlyItsOwnIndependentPage(){
        Object shown=new Object();var page=new PreviewPageBinding<>(shown);var clicks=new AtomicInteger();
        assertTrue(page.current(shown,true));assertTrue(page.dispatch(shown,true,value->{assertSame(shown,value);clicks.incrementAndGet();}));
        assertEquals(1,clicks.get());
    }
    @Test void clearingControllerBeforeNextLayoutNeverPassesNullToThePage(){
        var page=new PreviewPageBinding<>(new Object());
        assertFalse(page.current(null,true));assertFalse(page.dispatch(null,true,value->fail("stale click reached constructor")));
        assertFalse(new PreviewPageBinding<>(null).dispatch(null,true,value->fail("empty page acquired candidate")));
    }
    @Test void replacementWithEqualValueIsNotTheDisplayedIdentity(){
        String shown=new String("same candidate hash");var page=new PreviewPageBinding<>(shown);String replacement=new String(shown);
        assertEquals(shown,replacement);assertFalse(page.current(replacement,true));
        assertFalse(page.dispatch(replacement,true,value->fail("replacement was silently adopted")));
    }
    @Test void snapshotInvalidationIsCheckedAtClickTimeNotOnlyDuringTick(){
        Object shown=new Object();var page=new PreviewPageBinding<>(shown);
        assertTrue(page.current(shown,true));assertFalse(page.dispatch(shown,false,value->fail("stale world was accepted")));
        assertFalse(page.current(shown,false));
    }
    @Test void closingOrRelayoutRetiresOldCallbacksEvenIfSameCandidateReturns(){
        Object shown=new Object();var old=new PreviewPageBinding<>(shown);old.leave();
        var fresh=new PreviewPageBinding<>(shown);assertTrue(fresh.current(shown,true));
        assertFalse(old.dispatch(shown,true,value->fail("old widget remained live")));old.leave();assertFalse(old.current(shown,true));
        fresh.leave();assertFalse(fresh.current(shown,true));
    }
    @Test void readOnlyPreviewWithoutCandidateCannotAcquireAuditOrApplyControls(){
        Object shown=new Object();var preview=new PreviewPageBinding<>(shown);var candidate=new PreviewPageBinding<Object>(null);
        assertTrue(preview.dispatch(shown,true,value->assertSame(shown,value)));
        assertFalse(candidate.dispatch(null,true,value->fail("display-only preview acquired candidate")));
    }
    @Test void retainingCandidateDoesNotKeepItsOldPreviewPageLiveAfterReplacement(){
        Object shown=new Object(),input=new Object();var preview=new PreviewPageBinding<>(shown);var candidate=new PreviewPageBinding<>(input);
        assertTrue(candidate.current(input,true));assertFalse(preview.current(new Object(),true));
        preview.leave();assertFalse(preview.current(shown,true));assertTrue(candidate.current(input,true));
        candidate.leave();assertFalse(candidate.current(input,true));
    }
}
