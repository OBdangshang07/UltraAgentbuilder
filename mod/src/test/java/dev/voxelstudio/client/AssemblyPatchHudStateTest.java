package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AssemblyPatchHudStateTest {
    private static final UUID USER=UUID.fromString("12345678-1234-1234-1234-123456789abc");
    private static AssemblyPatchHudState.Progress progress(int n){return new AssemblyPatchHudState.Progress("RUNNING",n+"/54406","未证明落盘");}
    @Test void noCurrentIntegratedOwnerCannotPublishAnOperation(){
        var hud=new AssemblyPatchHudState();assertNull(hud.view());assertFalse(hud.hasProgress());
        assertFalse(hud.showApply(hud.ticket(),"original",()->progress(0)));
        hud.scope(new Object(),null,"minecraft:overworld");assertFalse(hud.showApply(hud.ticket(),"original",()->progress(0)));
    }
    @Test void closingScreensDoesNotFreezeProgressOrGrantConsent(){
        var hud=new AssemblyPatchHudState();Object owner=new Object();hud.scope(owner,USER,"minecraft:overworld");
        var live=new AtomicReference<>(progress(0));assertTrue(hud.showApply(hud.ticket(),"original",live::get));
        hud.scope(owner,USER,"minecraft:overworld");live.set(progress(54406));
        assertEquals("54406/54406",hud.view().apply().counts());assertEquals("original",hud.view().operationId());
        assertFalse(hud.view().canAuthorizePlacement());assertFalse(hud.view().worldDurabilityVerified());
    }
    @Test void changingDimensionClearsDisplayAndRejectsLateAcceptance(){
        var hud=new AssemblyPatchHudState();Object owner=new Object();hud.scope(owner,USER,"minecraft:overworld");long old=hud.ticket();
        assertTrue(hud.showApply(old,"original",()->progress(7)));hud.scope(owner,USER,"minecraft:the_nether");
        assertFalse(hud.hasProgress());assertNull(hud.view());assertFalse(hud.showApply(old,"late",()->progress(9)));
        hud.scope(owner,USER,"minecraft:overworld");assertNull(hud.view());assertFalse(hud.showApply(old,"resumed",()->progress(11)));
    }
    @Test void serverIdentityAndPlayerChangesCannotRebindOldDisplay(){
        var hud=new AssemblyPatchHudState();Object owner=new Object();hud.scope(owner,USER,"minecraft:overworld");long old=hud.ticket();
        hud.scope(new Object(),USER,"minecraft:overworld");assertFalse(hud.showApply(old,"wrong server",()->progress(0)));
        long next=hud.ticket();hud.scope(owner,UUID.randomUUID(),"minecraft:overworld");assertFalse(hud.showApply(next,"wrong user",()->progress(0)));
    }
    @Test void undoMustBelongToTheSameOriginalLiveApplyAndNewApplyClearsIt(){
        var hud=new AssemblyPatchHudState();hud.scope(new Object(),USER,"minecraft:overworld");long ticket=hud.ticket();
        assertFalse(hud.showUndo(ticket,"missing",()->progress(0)));assertTrue(hud.showApply(ticket,"apply-1",()->progress(12)));
        assertFalse(hud.showUndo(ticket,"apply-2",()->progress(0)));assertTrue(hud.showUndo(ticket,"apply-1",()->progress(12)));
        assertNotNull(hud.view().undo());assertTrue(hud.showApply(ticket,"apply-2",()->progress(0)));assertNull(hud.view().undo());
        assertFalse(hud.showUndo(ticket,"apply-1",()->progress(12)));
    }
    @Test void leavingWorldDropsSuppliersWithoutReadingThem(){
        var hud=new AssemblyPatchHudState();hud.scope(new Object(),USER,"minecraft:overworld");long old=hud.ticket();
        assertTrue(hud.showApply(old,"original",()->{fail("invalidated supplier was read");return null;}));
        hud.scope(null,null,null);assertNull(hud.view());assertFalse(hud.showApply(old,"late",()->progress(0)));
    }
    @Test void shutdownNeverRestoresDisplayOrAcceptsLateCompletion(){
        var hud=new AssemblyPatchHudState();Object owner=new Object();hud.scope(owner,USER,"minecraft:overworld");long old=hud.ticket();
        assertTrue(hud.showApply(old,"original",()->progress(0)));hud.close();hud.scope(owner,USER,"minecraft:overworld");
        assertNull(hud.view());assertFalse(hud.showApply(old,"late",()->progress(0)));assertFalse(hud.hasProgress());
    }
}
