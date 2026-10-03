package dev.voxelstudio.client;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
final class WorldPatchPageStateTest {
    @Test void latePreviewTokenFailsOnResizeCloseAndReentry(){var page=new WorldPatchPageState();page.enter();var original=page.publication();assertTrue(original.getAsBoolean());page.enter();assertFalse(original.getAsBoolean());var resized=page.publication();assertTrue(resized.getAsBoolean());page.leave();assertFalse(resized.getAsBoolean());page.enter();assertFalse(resized.getAsBoolean());assertTrue(page.publication().getAsBoolean());}
    @Test void closedPageNeverBegins(){var page=new WorldPatchPageState();assertFalse(page.live());assertEquals(-1,page.begin());page.enter();page.leave();assertEquals(-1,page.begin());}
    @Test void onlyOneInFlightAndExactCompletionCanPublish(){var page=new WorldPatchPageState();page.enter();long ticket=page.begin();assertTrue(ticket>0);assertEquals(-1,page.begin());assertFalse(page.finish(ticket+1));assertFalse(page.available());assertTrue(page.finish(ticket));assertTrue(page.available());assertFalse(page.finish(ticket));}
    @Test void resizePreservesSingleFlightButRejectsLateUiPublication(){var page=new WorldPatchPageState();page.enter();long old=page.begin();page.enter();assertEquals(-1,page.begin());assertFalse(page.finish(old));assertTrue(page.available());long fresh=page.begin();assertFalse(page.finish(old));assertFalse(page.available());assertTrue(page.finish(fresh));}
    @Test void closeAndReentryCannotAdoptLateSendResult(){var page=new WorldPatchPageState();page.enter();long old=page.begin();page.leave();page.enter();assertEquals(-1,page.begin());assertFalse(page.finish(old));long fresh=page.begin();assertTrue(fresh>old);assertTrue(page.finish(fresh));}
    @Test void closeWhileQueryInFlightInvalidatesWithoutAuthorizingReplacement(){var page=new WorldPatchPageState();page.enter();long ticket=page.begin();page.leave();assertFalse(page.finish(ticket));assertEquals(-1,page.begin());assertFalse(page.available());}
}
