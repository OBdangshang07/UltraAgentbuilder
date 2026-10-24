package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Exact runtime group gate only, not native/world execution or physics. */
final class CoupledNativeWriteGateTest {
    private static WorldPatchCompiler.Write row(int y){return new WorldPatchCompiler.Write(new SelectionRegion.Point(1,y,1),"minecraft:air","minecraft:stone","set","added");}
    @Test void unarmedReorderedAndRepeatedWritesAreRejected(){
        var lower=row(1);var upper=row(2);var pair=List.of(lower,upper);var gate=new CoupledNativeWriteGate(1,i->pair);
        assertFalse(gate.permits(lower));assertFalse(gate.arm(List.of(upper,lower)));assertTrue(gate.arm(pair));assertFalse(gate.arm(pair));
        assertFalse(gate.permits(upper));assertTrue(gate.permits(lower));gate.applied(lower);assertFalse(gate.permits(lower));assertTrue(gate.permits(upper));
        gate.applied(upper);assertFalse(gate.permits(upper));assertTrue(gate.fullyWritten(pair));assertEquals(2,gate.complete(pair));assertFalse(gate.arm(pair));
    }
    @Test void halfGroupCannotCloseAndPermanentlyRevokesThisSource(){
        var pair=List.of(row(1),row(2));var gate=new CoupledNativeWriteGate(1,i->pair);gate.arm(pair);gate.applied(pair.get(0));
        assertFalse(gate.fullyWritten(pair));assertThrows(IllegalStateException.class,()->gate.complete(pair));assertTrue(gate.broken());assertFalse(gate.arm(pair));assertFalse(gate.permits(pair.get(1)));
    }
    @Test void onlyNextOriginalGroupCanArmAndBadAppliedRowRevokes(){
        var groups=List.of(List.of(row(0)),List.of(row(1),row(2)));var gate=new CoupledNativeWriteGate(2,groups::get);
        assertFalse(gate.arm(groups.get(1)));assertTrue(gate.arm(groups.get(0)));gate.applied(groups.get(0).get(0));assertEquals(1,gate.complete(groups.get(0)));
        assertTrue(gate.arm(groups.get(1)));assertThrows(IllegalStateException.class,()->gate.applied(row(3)));assertTrue(gate.broken());
    }
    @Test void fullSchedulesAreNotExpandedOrReadAheadOnConstruction(){
        var reads=new AtomicInteger();var gate=new CoupledNativeWriteGate(1000,i->{reads.incrementAndGet();return List.of(row(i));});
        assertEquals(0,reads.get());assertTrue(gate.arm(List.of(row(0))));assertTrue(reads.get()<=2);assertEquals(0,gate.writtenInActiveGroup());
        gate.applied(row(0));assertEquals(1,gate.writtenInActiveGroup());gate.complete(List.of(row(0)));assertEquals(0,gate.writtenInActiveGroup());
    }
    @Test void malformedOriginalGroupsAndCallerMutationsDoNotBecomeAuthority(){
        var mutable=new ArrayList<>(List.of(row(1),row(2)));var gate=new CoupledNativeWriteGate(1,i->mutable);assertTrue(gate.arm(mutable));mutable.clear();
        assertTrue(gate.permits(row(1)));gate.revoke();assertFalse(gate.permits(row(1)));
        for(var invalid:List.of(List.<WorldPatchCompiler.Write>of(),List.of(row(1),row(1)),List.of(row(1),row(2),row(3)))){
            var rejected=new CoupledNativeWriteGate(1,i->invalid);assertThrows(IllegalStateException.class,()->rejected.arm(invalid));
        }
    }
}
