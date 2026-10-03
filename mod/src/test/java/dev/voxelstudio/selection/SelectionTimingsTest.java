package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class SelectionTimingsTest {
    @Test void completeSamplesHaveRealNearestRankPercentiles(){var t=new SelectionTimings();for(int i=100;i>=1;i--)t.record(i*1000000L);var r=t.finish();assertEquals(100,r.steps());assertTrue(r.complete());assertEquals(95,r.p95Millis());assertEquals(99,r.p99Millis());assertEquals(100,r.maxMillis());assertEquals(50.5,r.meanMillis());}
    @Test void capNeverPretendsPartialSamplesAreWholeScanQuantiles(){var t=new SelectionTimings(2);t.record(1000000);t.record(2000000);t.record(9000000);var r=t.finish();assertFalse(r.complete());assertEquals(3,r.steps());assertEquals(2,r.sampledSteps());assertEquals(9,r.maxMillis());assertEquals(4,r.meanMillis());}
    @Test void emptyInvalidAndRepeatedFinalizationRemainDataOnly(){var t=new SelectionTimings();assertEquals(0,t.finish().p99Millis());assertThrows(IllegalArgumentException.class,()->t.record(-1));t.record(1000);assertEquals(t.finish(),t.finish());}
}
