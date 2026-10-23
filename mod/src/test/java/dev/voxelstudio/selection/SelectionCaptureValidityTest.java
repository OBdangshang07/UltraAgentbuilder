package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class SelectionCaptureValidityTest {
    @Test void allBooleanCombinationsRetainOriginalAcceptanceAndFirstFailure(){
        for(boolean watch:new boolean[]{false,true})for(boolean chunks:new boolean[]{false,true})for(boolean lifetime:new boolean[]{false,true}){
            var actual=SelectionCaptureValidity.check(watch,()->chunks,()->lifetime);
            assertEquals(watch&&chunks&&lifetime,actual==SelectionCaptureValidity.CURRENT);
            assertEquals(!watch?SelectionCaptureValidity.WATCH_CHANGED:!chunks?SelectionCaptureValidity.CHUNK_FENCE_CHANGED:!lifetime?SelectionCaptureValidity.LIFETIME_INVALID:SelectionCaptureValidity.CURRENT,actual);
        }
    }
    @Test void changedWatchDoesNotReadChunksOrClock(){
        assertEquals(SelectionCaptureValidity.WATCH_CHANGED,SelectionCaptureValidity.check(false,()->{throw new AssertionError("No chunk read after original watch rejection");},()->{throw new AssertionError("No clock read after original watch rejection");}));
    }
    @Test void changedChunkFenceDoesNotReadClock(){
        var calls=new ArrayList<String>();
        assertEquals(SelectionCaptureValidity.CHUNK_FENCE_CHANGED,SelectionCaptureValidity.check(true,()->{calls.add("chunks");return false;},()->{throw new AssertionError("No clock read after original chunk rejection");}));
        assertEquals(List.of("chunks"),calls);
    }
    @Test void validChecksReadChunkAndLifetimeExactlyOnceInOriginalOrder(){
        var calls=new ArrayList<String>();
        assertEquals(SelectionCaptureValidity.CURRENT,SelectionCaptureValidity.check(true,()->{calls.add("chunks");return true;},()->{calls.add("lifetime");return true;}));
        assertEquals(List.of("chunks","lifetime"),calls);
    }
    @Test void queryFailurePropagatesWithoutReadingAnotherSourceOrClaimingAbsence(){
        var failure=new IllegalStateException("synthetic query failure");
        assertSame(failure,assertThrows(IllegalStateException.class,()->SelectionCaptureValidity.check(true,()->{throw failure;},()->{throw new AssertionError("No fallback after failed query");})));
        assertSame(failure,assertThrows(IllegalStateException.class,()->SelectionCaptureValidity.check(true,()->true,()->{throw failure;})));
    }
    @Test void diagnosticMessagesHaveDistinctFixedCodesWithoutClaimingTheOnlyOrFirstHistoricalCause(){
        var codes=new HashSet<String>();
        for(var value:SelectionCaptureValidity.values()){
            if(value==SelectionCaptureValidity.CURRENT){assertEquals("",value.message());continue;}
            assertTrue(value.message().matches("^\\[selection-[a-z-]+\\] .+"));
            assertTrue(codes.add(value.message().substring(0,value.message().indexOf(']')+1)));
            assertFalse(value.message().contains("分钟"));assertFalse(value.message().contains("自动恢复"));
        }
        assertEquals(3,codes.size());
    }
    private SelectionReadService.PatchSendBinding binding(){return new SelectionReadService.PatchSendBinding("00000000-0000-0000-0000-000000000000","a".repeat(64),"b".repeat(64),0,"c".repeat(64),"d".repeat(64),"e".repeat(64),"1".repeat(64),"f".repeat(64));}
    @Test void longOriginalDispatchIsNotReportedAsLifetimeExpiryButChangedEnvironmentStillRejects(){
        var original=new Object();var player=UUID.randomUUID();var life=new SelectionCaptureLifetime<>(original,player,0);var binding=binding();
        life.reserve(original,player,binding,1);life.attempted(original,player,binding,2);long later=48*60*60_000_000_000L;
        assertEquals(SelectionCaptureValidity.CURRENT,SelectionCaptureValidity.check(true,()->true,()->!life.expired(later)));
        assertEquals(SelectionCaptureValidity.WATCH_CHANGED,SelectionCaptureValidity.check(false,()->true,()->!life.expired(later)));
        assertEquals(SelectionCaptureValidity.CHUNK_FENCE_CHANGED,SelectionCaptureValidity.check(true,()->false,()->!life.expired(later)));
        assertEquals(SelectionCaptureLifetime.Phase.POSSIBLY_SENT,life.phase());assertFalse(life.canAuthorizePlacement());
    }
    @Test void idleAndAbandonedPreparationStillExpireAndCannotBeResurrected(){
        var original=new Object();var player=UUID.randomUUID();var life=new SelectionCaptureLifetime<>(original,player,0);
        assertEquals(SelectionCaptureValidity.LIFETIME_INVALID,SelectionCaptureValidity.check(true,()->true,()->!life.expired(SelectionCaptureLifetime.IDLE_NANOS)));
        assertThrows(IllegalStateException.class,()->life.reserve(original,player,binding(),SelectionCaptureLifetime.IDLE_NANOS));
        var abandoned=new SelectionCaptureLifetime<>(original,player,0);var binding=binding();abandoned.reserve(original,player,binding,1);abandoned.releaseIfNotDispatched(original,player,binding);
        assertEquals(SelectionCaptureValidity.LIFETIME_INVALID,SelectionCaptureValidity.check(true,()->true,()->!abandoned.expired(SelectionCaptureLifetime.IDLE_NANOS)));
        assertThrows(IllegalStateException.class,()->abandoned.attempted(original,player,binding,2));
    }
}
