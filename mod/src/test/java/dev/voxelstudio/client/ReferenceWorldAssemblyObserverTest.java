package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Production Node preparations, synthetic statuses and deterministic ticks.
 * No screen, account, real renderer, model call or world-write evidence. */
class ReferenceWorldAssemblyObserverTest {
    static JsonObject fixture()throws Exception{return ReferenceWorldAssemblyReceiptTest.fixtures().get(0);}
    static JsonObject reference(JsonObject f){return ReferenceWorldAssemblyReceiptTest.reference(f);}
    static JsonObject waiting(JsonObject f){var s=ReferenceWorldAssemblyReceiptTest.running(f);s.addProperty("reservedCalls",1);s.addProperty("stageEventsObserved",1);var e=new JsonObject();e.addProperty("id","a".repeat(64));e.addProperty("state","waiting");s.add("nativeEvidence",e);return s;}
    static JsonObject ready(JsonObject f){var s=ReferenceWorldAssemblyReceiptTest.running(f);s.addProperty("state","preview-ready");s.addProperty("reservedCalls",8);s.addProperty("stageEventsObserved",9);
        var c=new JsonObject();c.addProperty("candidateHash","a".repeat(64));c.addProperty("patchSetHash","b".repeat(64));c.addProperty("partCount",2);c.addProperty("operationCount",9000);c.addProperty("canAuthorizePlacement",false);c.addProperty("partIsApplyScope",false);s.add("candidate",c);return s;}
    static void tick(ReferenceWorldAssemblyObserver observer,int count){for(int i=0;i<count;i++)observer.tick();}
    @Test void clientTicksAdvanceOriginalNativeHookAndStopAtFinalWithoutAnyScreen()throws Exception{
        var f=fixture();var r=reference(f);var answers=new ArrayDeque<>(List.of(ReferenceWorldAssemblyReceiptTest.running(f),waiting(f),ready(f)));var queries=new AtomicInteger();var targets=new ArrayList<NativeEvidenceTarget>();
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of(r)),input->{assertEquals(r,input);queries.incrementAndGet();return CompletableFuture.completedFuture(answers.remove());},Runnable::run,
            (original,status)->targets.add(NativeEvidenceTarget.assembly(original.get("id").getAsString(),original.get("requestHash").getAsString(),status)));
        observer.tick();assertEquals(1,queries.get());assertNull(targets.get(0));tick(observer,39);assertEquals(1,queries.get());observer.tick();assertEquals(NativeEvidenceTarget.Namespace.FULL_ASSEMBLY,targets.get(1).namespace());
        tick(observer,40);assertEquals(ready(f),observer.view(r).status());tick(observer,400);assertEquals(3,queries.get());assertNull(targets.get(2));assertFalse(observer.view(r).reading());
    }
    @Test void unknownAndRestartedReferencesOnlyReadOriginalAndCannotResumeOrRender()throws Exception{
        var f=fixture();var r=reference(f);var retained=f.getAsJsonObject("retained").deepCopy();retained.addProperty("state","unknown-needs-original-inspection");retained.addProperty("reservedCalls",1);retained.addProperty("pendingCalls",1);retained.addProperty("originalDispatchRetained",true);var queries=new AtomicInteger();
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of(r)),original->{assertEquals(r,original);queries.incrementAndGet();return CompletableFuture.completedFuture(retained);},Runnable::run,
            (original,status)->assertNull(NativeEvidenceTarget.assembly(original.get("id").getAsString(),original.get("requestHash").getAsString(),status)));
        observer.tick();tick(observer,500);assertEquals(1,queries.get());assertFalse(observer.view(r).status().get("canResume").getAsBoolean());observer.refresh(r);observer.tick();assertEquals(2,queries.get());
    }
    @Test void lostGetRetriesSameImmutableOriginalWithBoundedBackoffAndNoNewHandle()throws Exception{
        var f=fixture();var r=reference(f);var calls=new AtomicInteger();var hooks=new AtomicInteger();
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of(r)),original->{assertEquals(r,original);return calls.incrementAndGet()==1?CompletableFuture.failedFuture(new IllegalStateException("synthetic lost GET")):CompletableFuture.completedFuture(waiting(f));},Runnable::run,(a,b)->hooks.incrementAndGet());
        observer.tick();assertNull(observer.view(r).status());assertTrue(observer.view(r).message().contains("不重发"));tick(observer,79);assertEquals(1,calls.get());observer.tick();assertEquals(2,calls.get());assertEquals(1,hooks.get());
    }
    @Test void singleFlightCompletionRunsOnClientExecutorAndKeepsOtherOriginals()throws Exception{
        var fs=ReferenceWorldAssemblyReceiptTest.fixtures();var refs=fs.stream().map(ReferenceWorldAssemblyObserverTest::reference).toList();var pending=new CompletableFuture<JsonObject>();var callbacks=new ArrayDeque<Runnable>();var calls=new ArrayList<JsonObject>();var hooks=new AtomicInteger();
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of()),r->{calls.add(r);return pending;},callbacks::add,(a,b)->hooks.incrementAndGet());
        for(var r:refs)observer.watch(r,null);observer.tick();callbacks.remove().run();tick(observer,100);assertEquals(1,calls.size());assertTrue(observer.view(refs.get(0)).reading());pending.complete(waiting(fs.get(0)));assertEquals(0,hooks.get());assertNull(observer.view(refs.get(0)).status());callbacks.remove().run();assertEquals(1,hooks.get());
    }
    @Test void shutdownRejectsLateOriginalQueryAndHistoryWithoutAdoptingOrReplacing()throws Exception{
        var f=fixture();var r=reference(f);var pending=new CompletableFuture<JsonObject>();var hooks=new AtomicInteger();
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of(r)),input->pending,Runnable::run,(a,b)->hooks.incrementAndGet());observer.tick();observer.close();pending.complete(waiting(f));tick(observer,300);assertEquals(0,hooks.get());assertNull(observer.view(r).status());
        var history=new CompletableFuture<List<JsonObject>>();var second=new ReferenceWorldAssemblyObserver(()->history,input->{fail("Closed history cannot cause GET");return null;},Runnable::run,(a,b)->fail("Closed history cannot render"));var load=second.reloadHistory();second.close();history.complete(List.of(r));assertTrue(load.isCompletedExceptionally());second.tick();
    }
    @Test void corruptDuplicateAndOverQuotaHistoryAreRejectedAtomicallyAndPreserved()throws Exception{
        var f=fixture();var r=reference(f);var bad=r.deepCopy();bad.addProperty("requestHash","f".repeat(64));
        for(var values:List.of(List.of(r,bad),List.of(r,r),Collections.nCopies(9,r))){var calls=new AtomicInteger();var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(values),input->{calls.incrementAndGet();return CompletableFuture.completedFuture(waiting(f));},Runnable::run,(a,b)->fail("Rejected history cannot render"));
            assertTrue(observer.reloadHistory().isCompletedExceptionally());tick(observer,300);assertEquals(0,calls.get());assertThrows(RuntimeException.class,()->observer.view(r));assertEquals("f".repeat(64),bad.get("requestHash").getAsString());}
    }
    @Test void changedOriginalStatusCannotReachNativeHookOrReplaceLastVerifiedResult()throws Exception{
        var f=fixture();var r=reference(f);var changed=waiting(f);changed.addProperty("requestHash","f".repeat(64));var hooks=new AtomicInteger();
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of(r)),input->CompletableFuture.completedFuture(changed),Runnable::run,(a,b)->hooks.incrementAndGet());observer.watch(r,ReferenceWorldAssemblyReceiptTest.running(f));tick(observer,40);assertEquals(1,hooks.get());assertEquals(ReferenceWorldAssemblyReceiptTest.running(f),observer.view(r).status());
        observer.watch(r,ready(f));assertThrows(RuntimeException.class,()->observer.watch(r,waiting(f)));var swapped=ready(f);swapped.getAsJsonObject("candidate").addProperty("candidateHash","c".repeat(64));assertThrows(RuntimeException.class,()->observer.watch(r,swapped));assertEquals(ready(f),observer.view(r).status());
    }
    @Test void inputsViewsAndNativeCallbacksCannotMutateOriginalPins()throws Exception{
        var f=fixture();var r=reference(f);var input=r.deepCopy();var status=waiting(f);
        var observer=new ReferenceWorldAssemblyObserver(()->CompletableFuture.completedFuture(List.of()),original->CompletableFuture.completedFuture(waiting(f)),Runnable::run,(a,b)->{a.addProperty("canAuthorizePlacement",true);b.addProperty("requestHash","f".repeat(64));});observer.watch(input,status);
        input.addProperty("canAuthorizePlacement",true);status.addProperty("requestHash","f".repeat(64));var view=observer.view(r);view.reference().addProperty("canAuthorizePlacement",true);view.status().addProperty("requestHash","f".repeat(64));assertEquals(r,observer.view(r).reference());assertEquals(waiting(f),observer.view(r).status());
    }
    @Test void disclosureSeparatesUnreportedCallsStageEventsAndWholeCandidateAuthority()throws Exception{
        var f=fixture();var r=reference(f);var unreported=ReferenceWorldAssemblyReceipt.observationDetails(r,ReferenceWorldAssemblyReceiptTest.running(f));assertTrue(unreported.contains("不等于 0"));assertTrue(unreported.contains("不是调用或成功次数"));
        var complete=ReferenceWorldAssemblyReceipt.observationDetails(r,ready(f));assertTrue(complete.contains("不可单片建造"));assertTrue(complete.contains("fresh BEFORE"));assertTrue(complete.contains("一次最终确认"));assertTrue(complete.contains("仍需游戏验收"));assertTrue(complete.contains("本页不授予写入权限"));assertTrue(ReferenceWorldAssemblyReceipt.observationDetails(r,null).contains("不证明模型未调用"));
    }
}
