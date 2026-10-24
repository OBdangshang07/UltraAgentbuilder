package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Original-object lifetime and independent protocol tests. All native
 * inputs are synthetic; no server world, model or placement is created. */
class CoupledAssemblyRetentionTest {
    private final Object original=new Object();private final UUID player=UUID.randomUUID();
    private CoupledAssemblyBinding candidate()throws Exception{
        var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-coupled-transport.json"))).getAsJsonObject().getAsJsonArray("cases").get(0).getAsJsonObject();
        return CoupledAssemblyTestFixtures.input(f).binding();
    }
    private CoupledAssemblySendBinding sent(CoupledAssemblyBinding b){return new CoupledAssemblySendBinding(b.captureId(),b.jobId(),b.snapshotHash(),b.selectionHash(),b.contextRevision(),b.preparationHash(),b.contextRecordHash(),b.requestHash(),b.runtimeHash(),b.worldContextHash(),b.referenceSetHash(),b.referenceBindingHash(),"a".repeat(64),b.couplingPolicyHash());}
    private SelectionReadService.PatchSendBinding legacy(CoupledAssemblyBinding b){return new SelectionReadService.PatchSendBinding(b.captureId(),b.snapshotHash(),b.selectionHash(),b.contextRevision(),b.preparationHash(),b.contextRecordHash(),b.requestHash(),b.runtimeHash(),"a".repeat(64));}
    private SelectionCaptureLifetime<Object> life(){return new SelectionCaptureLifetime<>(original,player,0);}
    @Test void explicitNewSendRetainsTheSameObjectBeyondIdleWithoutWriteAuthority()throws Exception{
        var b=candidate();var pin=sent(b);var life=life();life.reserve(original,player,pin,1);life.beforeDispatch(original,player,pin,2);life.attempted(original,player,pin,3);
        assertFalse(life.expired(48*60*60_000_000_000L));assertDoesNotThrow(()->life.checkedCoupled(original,player,b));assertFalse(pin.canAuthorizePlacement());assertFalse(life.canAuthorizePlacement());
    }
    @Test void oldAndNewBindingsWithIdenticalSharedPinsCannotAdoptEachOther()throws Exception{
        var b=candidate();var pin=sent(b);var old=legacy(b);
        for(boolean newFirst:new boolean[]{false,true}){
            var life=life();if(newFirst){life.reserve(original,player,pin,1);assertThrows(IllegalStateException.class,()->life.reserve(original,player,old,2));assertThrows(IllegalStateException.class,()->life.attempted(original,player,old,2));life.attempted(original,player,pin,3);}
            else{life.reserve(original,player,old,1);assertThrows(IllegalStateException.class,()->life.reserve(original,player,pin,2));assertThrows(IllegalStateException.class,()->life.attempted(original,player,pin,2));life.attempted(original,player,old,3);assertThrows(IllegalStateException.class,()->life.checkedCoupled(original,player,b));}
        }
    }
    @Test void onlyTheOriginalObjectAndPlayerCanRetainOrReadTheNewTask()throws Exception{
        var b=candidate();var pin=sent(b);var life=life();assertThrows(IllegalStateException.class,()->life.reserve(new Object(),player,pin,1));assertThrows(IllegalStateException.class,()->life.reserve(original,UUID.randomUUID(),pin,1));
        life.reserve(original,player,pin,1);life.attempted(original,player,pin,2);assertThrows(IllegalStateException.class,()->life.checkedCoupled(new Object(),player,b));assertThrows(IllegalStateException.class,()->life.checkedCoupled(original,UUID.randomUUID(),b));
    }
    @Test void copiedCandidateCannotChangeOriginalScopeRuntimeImagesOrTaskPins()throws Exception{
        var b=candidate();var life=life();life.reserve(original,player,sent(b),1);life.attempted(original,player,sent(b),2);
        for(var key:List.of("worldContextHash","preparationHash","requestHash","runtimeHash","referenceSetHash","contextRecordHash","referenceBindingHash","couplingPolicyHash")){
            var changed=b.json();changed.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->life.checkedCoupled(original,player,CoupledAssemblyBinding.parse(changed)),key);
        }
        var relabelled=b.json();relabelled.addProperty("jobId","ffffffff-ffff-4fff-8fff-ffffffffffff");
        var copied=CoupledAssemblyBinding.parse(relabelled);assertEquals(b.requestHash(),copied.requestHash());assertEquals(b.candidateHash(),copied.candidateHash());
        assertThrows(IllegalStateException.class,()->life.checkedCoupled(original,player,copied));
    }
    @Test void preparationAndIdleExpiryCannotBeRefreshedByPollingOrReentry()throws Exception{
        var pin=sent(candidate());var idle=life();assertThrows(IllegalStateException.class,()->idle.reserve(original,player,pin,SelectionCaptureLifetime.IDLE_NANOS));
        var life=life();long start=SelectionCaptureLifetime.IDLE_NANOS-10;life.reserve(original,player,pin,start);life.reserve(original,player,pin,start+20);
        assertTrue(life.expired(start+SelectionCaptureLifetime.DISPATCH_PREPARATION_NANOS));assertThrows(IllegalStateException.class,()->life.attempted(original,player,pin,start+SelectionCaptureLifetime.DISPATCH_PREPARATION_NANOS));
    }
    @Test void lostAcknowledgementDoesNotReleaseOrPermitASecondDispatch()throws Exception{
        var pin=sent(candidate());var life=life();life.reserve(original,player,pin,1);life.attempted(original,player,pin,2);life.releaseIfNotDispatched(original,player,pin);
        assertFalse(life.expired(SelectionCaptureLifetime.IDLE_NANOS*100));assertThrows(IllegalStateException.class,()->life.attempted(original,player,pin,3));assertThrows(IllegalStateException.class,()->life.reserve(original,player,pin,3));
    }
    @Test void changedWorldSelectionEnvironmentAndExplicitCancellationStayRevoked()throws Exception{
        var b=candidate();var pin=sent(b);for(boolean sent:new boolean[]{false,true}){
            var life=life();life.reserve(original,player,pin,1);if(sent)life.attempted(original,player,pin,2);life.revoke();assertTrue(life.expired(3));
            assertThrows(IllegalStateException.class,()->life.checkedCoupled(original,player,b));assertThrows(IllegalStateException.class,()->life.reserve(original,player,pin,3));assertThrows(IllegalStateException.class,()->life.attempted(original,player,pin,3));
        }
    }
    @Test void fixedPolicyAndAllNewHashesAreMandatory()throws Exception{
        var p=sent(candidate());assertEquals(CoupledAssemblySendBinding.policyHash(),p.couplingPolicyHash());
        assertThrows(IllegalArgumentException.class,()->new CoupledAssemblySendBinding(p.contextId(),p.jobId(),p.snapshotHash(),p.selectionHash(),p.contextRevision(),p.preparationHash(),p.contextRecordHash(),p.requestHash(),p.runtimeHash(),p.worldContextHash(),p.referenceSetHash(),p.referenceBindingHash(),p.generationProtocolHash(),"f".repeat(64)));
        assertThrows(IllegalArgumentException.class,()->new CoupledAssemblySendBinding(p.contextId(),p.jobId(),p.snapshotHash(),p.selectionHash(),p.contextRevision(),p.preparationHash(),p.contextRecordHash(),p.requestHash(),p.runtimeHash(),p.worldContextHash(),p.referenceSetHash(),p.referenceBindingHash(),null,p.couplingPolicyHash()));
    }
}
