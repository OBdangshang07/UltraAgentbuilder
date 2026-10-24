package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Display-only epoch behavior, not server task cancellation. */
final class AssemblyPatchHudClearTest {
    private static AssemblyPatchHudState.Progress progress(){return new AssemblyPatchHudState.Progress("RUNNING","1/3","not physical-save proof");}
    @Test void clearingDisplayDropsSuppliersAndRejectsLateOldFamilyPublication(){
        var hud=new AssemblyPatchHudState();hud.scope(new Object(),UUID.randomUUID(),"minecraft:overworld");long old=hud.ticket();
        assertTrue(hud.showApply(old,"original",()->{fail("cleared display must not read supplier");return null;}));hud.clear();
        assertFalse(hud.hasProgress());assertNull(hud.view());assertFalse(hud.showApply(old,"late",AssemblyPatchHudClearTest::progress));
        assertFalse(hud.showUndo(old,"original",AssemblyPatchHudClearTest::progress));assertTrue(hud.showApply(hud.ticket(),"new",AssemblyPatchHudClearTest::progress));
    }
    @Test void clearingAnotherFamilyDoesNotInvalidateCurrentDisplayOrCreateAuthority(){
        var old=new AssemblyPatchHudState();var current=new AssemblyPatchHudState();var server=new Object();var user=UUID.randomUUID();
        old.scope(server,user,"minecraft:overworld");current.scope(server,user,"minecraft:overworld");
        assertTrue(current.showApply(current.ticket(),"coupled",AssemblyPatchHudClearTest::progress));old.clear();assertEquals("coupled",current.view().operationId());
        assertFalse(current.view().canAuthorizePlacement());assertFalse(current.view().worldDurabilityVerified());old.close();old.clear();assertFalse(old.hasProgress());
    }
}
