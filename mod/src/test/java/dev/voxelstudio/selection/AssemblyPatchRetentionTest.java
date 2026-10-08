package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class AssemblyPatchRetentionTest {
    private SelectionReadService.PatchSendBinding sent(AssemblyPatchBinding b){return new SelectionReadService.PatchSendBinding(b.captureId(),b.snapshotHash(),b.selectionHash(),b.contextRevision(),b.preparationHash(),b.contextRecordHash(),b.requestHash(),b.runtimeHash(),"a".repeat(64));}
    @Test void onlyOriginalObjectPlayerAndOneActuallyAttemptedFullSendRemainEligible()throws Exception{
        var binding=AssemblyPatchFixtures.binding(AssemblyPatchFixtures.header("lite"));var original=new Object();var player=UUID.randomUUID();var pin=sent(binding);var lifetime=new SelectionCaptureLifetime<>(original,player,0);
        assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(original,player,binding));lifetime.reserve(original,player,pin,1);
        assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(original,player,binding));lifetime.attempted(original,player,pin,2);
        assertDoesNotThrow(()->lifetime.checkedAssembly(original,player,binding));assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(new Object(),player,binding));assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(original,UUID.randomUUID(),binding));
        assertFalse(lifetime.expired(Long.MAX_VALUE/2));assertFalse(lifetime.canAuthorizePlacement());lifetime.revoke();assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(original,player,binding));
    }
    @Test void preparationRuntimeRequestAndRecordCannotBeSwappedWithMatchingSnapshot()throws Exception{
        var f=AssemblyPatchFixtures.header("lite");var binding=AssemblyPatchFixtures.binding(f);var original=new Object();var player=UUID.randomUUID();var pin=sent(binding);var lifetime=new SelectionCaptureLifetime<>(original,player,0);lifetime.reserve(original,player,pin,1);lifetime.attempted(original,player,pin,2);
        for(String key:List.of("preparationHash","runtimeHash","requestHash","recordHash")){
            var changed=f.deepCopy();if(key.equals("recordHash"))changed.getAsJsonObject("prepared").addProperty(key,"f".repeat(64));
            else if(key.equals("requestHash"))changed.getAsJsonObject("status").addProperty(key,"f".repeat(64));
            else changed.getAsJsonObject("metadata").getAsJsonObject("candidate").addProperty(key,"f".repeat(64));
            var other=AssemblyPatchFixtures.binding(changed);assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(original,player,other),key);
        }
        assertDoesNotThrow(()->lifetime.checkedAssembly(original,player,binding));
    }
    @Test void abandonedOrExpiredPreparationCannotBeUsedAsSuccessfulWholeDispatch()throws Exception{
        var binding=AssemblyPatchFixtures.binding(AssemblyPatchFixtures.header("lite"));var original=new Object();var player=UUID.randomUUID();var pin=sent(binding);
        var lifetime=new SelectionCaptureLifetime<>(original,player,0);lifetime.reserve(original,player,pin,1);lifetime.releaseIfNotDispatched(original,player,pin);assertThrows(IllegalStateException.class,()->lifetime.checkedAssembly(original,player,binding));
        var expired=new SelectionCaptureLifetime<>(original,player,0);expired.reserve(original,player,pin,1);assertThrows(IllegalStateException.class,()->expired.attempted(original,player,pin,SelectionCaptureLifetime.DISPATCH_PREPARATION_NANOS+1));assertThrows(IllegalStateException.class,()->expired.checkedAssembly(original,player,binding));
    }
}
