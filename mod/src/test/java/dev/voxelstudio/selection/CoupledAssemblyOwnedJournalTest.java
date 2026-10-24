package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic source identities only, not a server-owned lease or live write. */
final class CoupledAssemblyOwnedJournalTest {
    @TempDir Path temp;
    @Test void ownedPreparationRetainsExactOriginalCompiledAndBaselineObjects()throws Exception{
        var f=CoupledAssemblyTestFixtures.fixture("complete-new-door");var input=CoupledAssemblyTestFixtures.input(f);var original=CoupledAssemblyTestFixtures.capture(f,input);
        var baseline=SelectionBaseline.fromSealedCapture(input.binding().selection(),f.getAsJsonObject("capture"),()->false);
        var compiled=AssemblyCoupledCompiler.read(baseline,input,()->false);var plan=CoupledAssemblyJournal.prepareOwned(original,input,compiled,UUID.randomUUID(),()->false);
        assertSame(compiled,plan.compiled());assertSame(baseline,plan.compiled().baseline());assertTrue(plan.compiled().fromOriginalInput(input));assertFalse(plan.canAuthorizePlacement());
        assertEquals(compiled.writes(),plan.packet(0).writes());
    }
    @Test void equalCopiedInputCannotReplaceOriginalInputIdentity()throws Exception{
        var f=CoupledAssemblyTestFixtures.fixture("complete-new-door");var input=CoupledAssemblyTestFixtures.input(f);var copy=CoupledAssemblyTestFixtures.input(f);
        var baseline=SelectionBaseline.fromSealedCapture(input.binding().selection(),f.getAsJsonObject("capture"),()->false);var compiled=AssemblyCoupledCompiler.read(baseline,input,()->false);
        assertEquals(input.binding(),copy.binding());assertThrows(IllegalArgumentException.class,()->CoupledAssemblyJournal.prepareOwned(CoupledAssemblyTestFixtures.capture(f,copy),copy,compiled,UUID.randomUUID(),()->false));
    }
    @Test void nullOrCancelledOwnedPreparationCannotCreateAPlan()throws Exception{
        var f=CoupledAssemblyTestFixtures.fixture("complete-new-door");var input=CoupledAssemblyTestFixtures.input(f);var original=CoupledAssemblyTestFixtures.capture(f,input);
        var baseline=SelectionBaseline.fromSealedCapture(input.binding().selection(),f.getAsJsonObject("capture"),()->false);var compiled=AssemblyCoupledCompiler.read(baseline,input,()->false);
        assertThrows(NullPointerException.class,()->CoupledAssemblyJournal.prepareOwned(original,input,null,UUID.randomUUID(),()->false));
        assertThrows(java.util.concurrent.CancellationException.class,()->CoupledAssemblyJournal.prepareOwned(original,input,compiled,UUID.randomUUID(),()->true));
    }
    @Test void ownedArchiveReinspectionCannotAdoptOriginalServerAuthority()throws Exception{
        var f=CoupledAssemblyTestFixtures.fixture("complete-new-door");var input=CoupledAssemblyTestFixtures.input(f);var original=CoupledAssemblyTestFixtures.capture(f,input);
        var baseline=SelectionBaseline.fromSealedCapture(input.binding().selection(),f.getAsJsonObject("capture"),()->false);var compiled=AssemblyCoupledCompiler.read(baseline,input,()->false);
        var plan=CoupledAssemblyJournal.prepareOwned(original,input,compiled,UUID.randomUUID(),()->false);var live=CoupledAssemblyJournal.create(temp,plan);var intent=live.intent();
        live.applied(intent,intent.packet().writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);
        var review=CoupledAssemblyJournal.inspect(live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(3,review.confirmed().size());
        assertFalse(review.canAuthorizePlacement());assertFalse(review.worldDurabilityVerified());assertSame(compiled,plan.compiled());assertSame(baseline,plan.compiled().baseline());
    }
}
