package dev.voxelstudio.selection;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.atomic.AtomicInteger;
class SelectionChunkFenceTest {
    @Test void knownChunkUnloadFailsEvenWithoutAnEventRevision(){var f=new SelectionChunkFence();var chunk=new Object();assertTrue(f.observe(-1,0,chunk));assertFalse(f.stable(1,(x,z)->null));}
    @Test void unknownChunkLoadingCannotMasqueradeAsSameSnapshot(){var f=new SelectionChunkFence();assertTrue(f.observe(-1,-1,null));assertTrue(f.stable(1,(x,z)->null));assertFalse(f.stable(1,(x,z)->new Object()));}
    @Test void sameCoordinatesWithReplacementInstanceAreNotSameSource(){var f=new SelectionChunkFence();var chunk=new Object();assertTrue(f.observe(0,0,chunk));assertFalse(f.observe(0,0,new Object()));assertTrue(f.stable(1,(x,z)->chunk));}
    @Test void freshQueriesAreRequiredForEachWitnessAndMissingCoverageFails(){var f=new SelectionChunkFence();var chunk=new Object();f.observe(-2,1,chunk);f.observe(2,-1,null);var count=new AtomicInteger();assertTrue(f.stable(2,(x,z)->{count.incrementAndGet();return x==-2?chunk:null;}));assertEquals(2,count.get());assertFalse(f.stable(3,(x,z)->chunk));}
    @Test void boundedFreeRestartDropsOldIdentities(){var f=new SelectionChunkFence();var a=new Object();var b=new Object();f.observe(0,0,a);f.reset();assertTrue(f.observe(0,0,b));assertTrue(f.stable(1,(x,z)->b));}
}
