package dev.voxelstudio.client;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import dev.voxelstudio.selection.SelectionReadService;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual production Java lifecycle against paired synthetic loopback HTTP.
 * Node generated the original receipts; no actual model/game/world is opened. */
final class ReferenceWorldPatchBridgeClientTest {
    @TempDir Path root;
    private HttpServer server;private ExecutorService handlers;private BridgeClient client;
    private JsonObject f,r;private SelectionReadService.Capture capture;
    private final AtomicInteger images=new AtomicInteger(),sends=new AtomicInteger(),queries=new AtomicInteger(),checks=new AtomicInteger(),attempted=new AtomicInteger(),abandoned=new AtomicInteger();
    private final AtomicBoolean live=new AtomicBoolean(true);
    private final AtomicReference<CompletableFuture<Void>> fence=new AtomicReference<>(CompletableFuture.completedFuture(null));
    private final CountDownLatch acquisition=new CountDownLatch(1);
    @BeforeAll static void boot(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void start()throws Exception{
        f=ReferenceWorldPatchReferencesTest.fixture();r=ReferenceWorldPatchReferencesTest.reference(f);capture=ReferenceWorldPatchReferencesTest.capture(f);
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(4);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,200,"{\"protocol\":1}".getBytes(StandardCharsets.UTF_8)));server.start();
        Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    private static void reply(HttpExchange e,int status,byte[] bytes)throws java.io.IOException{e.sendResponseHeaders(status,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}}
    private static void reply(HttpExchange e,JsonElement value)throws java.io.IOException{reply(e,200,value.toString().getBytes(StandardCharsets.UTF_8));}
    private static JsonObject body(HttpExchange e)throws java.io.IOException{return JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();}
    private String job(){return "/v1/reference-world-patch/jobs/"+r.get("capsuleId").getAsString();}
    private String imageRoute(){return "/v1/reference-world-patch/tasks/"+r.get("capsuleId").getAsString()+"/images";}
    private void ordinary(){
        server.createContext("/v1/reference-world-patch/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,f.get("capabilities"));});
        server.createContext("/v1/world-contexts/"+capture.id()+"/record",e->{assertEquals("GET",e.getRequestMethod());reply(e,f.get("saved"));});
    }
    private void imageEndpoint(java.util.function.Consumer<JsonObject> mutate){server.createContext(imageRoute(),e->{
        assertEquals("POST",e.getRequestMethod());assertEquals(r.get("send"),body(e));assertEquals(r,new ReferenceWorldPatchReferences(root.resolve("data")).read(r.get("capsuleId").getAsString()));
        images.incrementAndGet();var receipt=f.getAsJsonObject("imageFreeze").deepCopy();mutate.accept(receipt);reply(e,receipt);
    });}
    private void jobEndpoint(){server.createContext(job(),e->{
        if(e.getRequestURI().getPath().equals(job()+"/send")){assertEquals("POST",e.getRequestMethod());assertEquals(r.get("send"),body(e));assertEquals(1,attempted.get());sends.incrementAndGet();}
        else {assertEquals(job(),e.getRequestURI().getPath());assertEquals("GET",e.getRequestMethod());assertEquals(0,e.getRequestBody().readAllBytes().length);queries.incrementAndGet();}reply(e,f.get("status"));
    });}
    private CompletableFuture<SelectionReadService.PatchRetention> retention(SelectionReadService.Capture original,JsonObject pin){
        try{assertSame(capture,original);assertEquals(r,pin);assertEquals(r,new ReferenceWorldPatchReferences(root.resolve("data")).read(r.get("capsuleId").getAsString()));
            var dispatched=new AtomicBoolean(false);var lease=new SelectionReadService.PatchRetention(){
                public CompletableFuture<Void> checkedBeforeDispatch(){checks.incrementAndGet();return fence.get();}
                public void markDispatchAttempted(){assertTrue(dispatched.compareAndSet(false,true));attempted.incrementAndGet();}
                public void releaseIfNotDispatched(){if(!dispatched.get())abandoned.incrementAndGet();}
            };acquisition.countDown();return CompletableFuture.completedFuture(lease);
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
    }
    private CompletableFuture<ReferenceWorldPatchSubmission> send(){return client.sendReferencePatch(()->CompletableFuture.completedFuture(capture),f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("frozen").get("runtimeHash").getAsString(),live::get,this::retention);}
    @AfterEach void stop(){client.close();server.stop(0);handlers.shutdownNow();}
    @Test void prepareFreezeVerifyOriginalPixelsCapabilityAndIndependentConfirmationWithoutSend()throws Exception{
        ordinary();var prepares=new AtomicInteger();var freezes=new AtomicInteger();String context="/v1/reference-world-patch/contexts/"+capture.id();
        server.createContext(context+"/disclosure",e->{assertEquals("POST",e.getRequestMethod());var b=body(e);assertEquals(Set.of("intent"),b.keySet());assertEquals(f.get("intent"),b.get("intent"));prepares.incrementAndGet();reply(e,f.get("prepared"));});
        server.createContext(context+"/freeze",e->{assertEquals("POST",e.getRequestMethod());var b=body(e);assertEquals(Set.of("intent","confirmation"),b.keySet());assertEquals(f.get("intent"),b.get("intent"));assertEquals(f.get("confirmation"),b.get("confirmation"));freezes.incrementAndGet();reply(e,f.get("frozen"));});
        var p=client.prepareReferencePatchTask(capture,f.getAsJsonObject("intent"),f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),live::get).get(5,TimeUnit.SECONDS);
        assertEquals(f.get("prepared"),p);assertEquals(f.get("frozen"),client.freezeReferencePatchTask(capture,p,f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),live::get).get(5,TimeUnit.SECONDS));
        assertEquals(1,prepares.get());assertEquals(1,freezes.get());assertEquals(List.of(),client.referencePatchHistory().get(2,TimeUnit.SECONDS));assertEquals(0,sends.get());
    }
    @Test void soleSendFollowsDurableClaimExactImageFreezeAndTwoServerFencesRestartOnlyGets()throws Exception{
        ordinary();imageEndpoint(v->{});jobEndpoint();var submission=send().get(5,TimeUnit.SECONDS);assertEquals(r,submission.reference());assertEquals(f.get("status"),submission.status());
        assertEquals(1,images.get());assertEquals(1,sends.get());assertEquals(2,checks.get());assertEquals(1,attempted.get());assertEquals(0,abandoned.get());
        client.close();client=new BridgeClient(root);assertEquals(List.of(r),client.referencePatchHistory().get(2,TimeUnit.SECONDS));assertEquals(f.get("status"),send().get(5,TimeUnit.SECONDS).status());
        assertEquals(1,images.get());assertEquals(1,sends.get());assertEquals(1,queries.get());assertEquals(List.of(),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void mismatchedImageHashesStopBeforeSendAndKeepOriginalClaim()throws Exception{
        ordinary();imageEndpoint(v->v.getAsJsonArray("imageHashes").set(0,new JsonPrimitive("f".repeat(64))));jobEndpoint();
        assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(1,images.get());assertEquals(0,sends.get());assertEquals(0,attempted.get());assertEquals(1,abandoned.get());assertEquals(List.of(r),client.referencePatchHistory().get(2,TimeUnit.SECONDS));
        assertEquals(f.get("status"),send().get(5,TimeUnit.SECONDS).status());assertEquals(1,images.get());assertEquals(0,sends.get());assertEquals(1,queries.get());
    }
    @Test void closedBetweenImageFreezeAndDispatchCannotSendOrReactivatePage()throws Exception{
        ordinary();imageEndpoint(v->live.set(false));jobEndpoint();assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));
        assertEquals(1,images.get());assertEquals(0,sends.get());assertEquals(0,attempted.get());assertEquals(1,abandoned.get());assertEquals(List.of(r),client.referencePatchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void failedOriginalServerFenceCannotFreezeImagesOrSend()throws Exception{
        ordinary();imageEndpoint(v->{});jobEndpoint();fence.set(CompletableFuture.failedFuture(new IllegalStateException("original capture changed")));
        assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(0,images.get());assertEquals(0,sends.get());assertEquals(1,abandoned.get());assertEquals(List.of(r),client.referencePatchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void changedServerFenceAfterImagesStillStopsSoleModelSend()throws Exception{
        ordinary();imageEndpoint(v->fence.set(CompletableFuture.failedFuture(new IllegalStateException("changed after image freeze"))));jobEndpoint();
        assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(1,images.get());assertEquals(2,checks.get());assertEquals(0,sends.get());assertEquals(0,attempted.get());assertEquals(1,abandoned.get());
    }
    @Test void closingDuringRetentionFenceNeverDispatchesAndKeepsClaim()throws Exception{
        ordinary();imageEndpoint(v->{});jobEndpoint();var pendingFence=new CompletableFuture<Void>();fence.set(pendingFence);var pending=send();assertTrue(acquisition.await(3,TimeUnit.SECONDS));live.set(false);pendingFence.complete(null);
        assertThrows(ExecutionException.class,()->pending.get(5,TimeUnit.SECONDS));assertEquals(0,images.get());assertEquals(0,sends.get());assertEquals(1,abandoned.get());assertEquals(List.of(r),client.referencePatchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void lostSendReplyCannotFreezeOrSendAgainAfterReconnect()throws Exception{
        ordinary();imageEndpoint(v->{});server.createContext(job(),e->{if(e.getRequestURI().getPath().endsWith("/send")){
            assertEquals("POST",e.getRequestMethod());body(e);sends.incrementAndGet();e.sendResponseHeaders(200,100);try(var out=e.getResponseBody()){out.write('{');}
        }else{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,f.get("status"));}});
        assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(List.of(r),client.referencePatchHistory().get(2,TimeUnit.SECONDS));
        assertEquals(f.get("status"),send().get(5,TimeUnit.SECONDS).status());assertEquals(1,images.get());assertEquals(1,sends.get());assertEquals(1,queries.get());assertEquals(0,abandoned.get());
    }
    @Test void originalPostCanClosePanelWithoutDiscardingReturnedReceiptOrResending()throws Exception{
        ordinary();imageEndpoint(v->{});server.createContext(job()+"/send",e->{assertEquals("POST",e.getRequestMethod());assertEquals(r.get("send"),body(e));sends.incrementAndGet();live.set(false);reply(e,f.get("status"));});
        assertEquals(f.get("status"),send().get(5,TimeUnit.SECONDS).status());assertEquals(1,sends.get());assertEquals(1,attempted.get());assertEquals(0,abandoned.get());
    }
    @Test void localPublicationFailureNeverFallsBackToImagesSendOrLegacy()throws Exception{
        ordinary();imageEndpoint(v->{});jobEndpoint();Files.writeString(root.resolve("data/reference-world-patch-references"),"preserve");
        assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(0,images.get());assertEquals(0,sends.get());assertEquals("preserve",Files.readString(root.resolve("data/reference-world-patch-references")));
    }
    @Test void disabledOrChangedRuntimeCannotClaimOrSend()throws Exception{
        var value=new AtomicReference<>(f.getAsJsonObject("capabilities").deepCopy());server.createContext("/v1/reference-world-patch/capabilities",e->reply(e,value.get()));imageEndpoint(v->{});jobEndpoint();
        value.get().addProperty("sendingEnabled",false);assertNull(client.referencePatchRuntime().get(2,TimeUnit.SECONDS));assertThrows(ExecutionException.class,()->send().get(3,TimeUnit.SECONDS));
        value.set(f.getAsJsonObject("capabilities").deepCopy());value.get().addProperty("runtimeHash","f".repeat(64));assertThrows(ExecutionException.class,()->send().get(3,TimeUnit.SECONDS));assertEquals(List.of(),client.referencePatchHistory().get(2,TimeUnit.SECONDS));assertEquals(0,images.get());assertEquals(0,sends.get());
    }
    @Test void boundedFatalUtf8DuplicateAndWrongPinsStatusNeverFallBackToOtherRequests()throws Exception{
        var raw=new AtomicReference<>(f.get("status").toString().getBytes(StandardCharsets.UTF_8));server.createContext(job(),e->{assertEquals(job(),e.getRequestURI().getPath());assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,200,raw.get());});
        assertEquals(f.get("status"),client.readReferencePatchJob(r).get(3,TimeUnit.SECONDS));
        var changed=f.getAsJsonObject("status").deepCopy();changed.addProperty("submissionHash","f".repeat(64));String original=f.get("status").toString();
        for(var bytes:List.of(new byte[]{(byte)255},("{\"version\":1,"+original.substring(1)).getBytes(StandardCharsets.UTF_8),changed.toString().getBytes(StandardCharsets.UTF_8),new byte[16385])){
            raw.set(bytes);assertThrows(ExecutionException.class,()->client.readReferencePatchJob(r).get(3,TimeUnit.SECONDS));
        }assertEquals(5,queries.get());assertEquals(0,sends.get());assertEquals(0,images.get());
    }
    @Test void missingOriginalDoesNotCreateClaimSendOrSubstitute()throws Exception{
        server.createContext(job(),e->{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,404,"{\"error\":\"original absent\"}".getBytes(StandardCharsets.UTF_8));});
        assertThrows(ExecutionException.class,()->client.readReferencePatchJob(r).get(3,TimeUnit.SECONDS));assertEquals(1,queries.get());assertEquals(List.of(),client.referencePatchHistory().get(2,TimeUnit.SECONDS));assertEquals(0,sends.get());
    }
    @Test void independentOriginalObservationUsesExactConfirmedPostNoSendOrRecheck()throws Exception{
        var status=f.getAsJsonObject("status").deepCopy();status.addProperty("state","unknown");status.addProperty("canObserveOriginal",true);status.add("responseCheck",JsonNull.INSTANCE);status.add("candidateHash",JsonNull.INSTANCE);status.addProperty("candidatePublished",false);var observations=new AtomicInteger();
        server.createContext(job(),e->{if(e.getRequestMethod().equals("GET")){assertEquals(job(),e.getRequestURI().getPath());queries.incrementAndGet();reply(e,status);}
            else{assertEquals(job()+"/observe-original",e.getRequestURI().getPath());assertEquals(JsonParser.parseString("{\"confirmed\":true}"),body(e));observations.incrementAndGet();reply(e,f.get("status"));}});
        assertEquals(f.get("status"),client.observeReferencePatch(r,live::get).get(3,TimeUnit.SECONDS));assertEquals(1,queries.get());assertEquals(1,observations.get());
        live.set(false);assertThrows(CancellationException.class,()->client.observeReferencePatch(r,live::get).get(3,TimeUnit.SECONDS));assertEquals(1,observations.get());assertEquals(0,sends.get());assertEquals(List.of(),client.referencePatchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void completedOrUnboundUnknownCannotInvokeOriginalObservation()throws Exception{
        var status=new AtomicReference<>(f.getAsJsonObject("status").deepCopy());server.createContext(job(),e->{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,status.get());});
        assertThrows(ExecutionException.class,()->client.observeReferencePatch(r,live::get).get(3,TimeUnit.SECONDS));var unknown=status.get();unknown.addProperty("state","unknown");unknown.add("responseCheck",JsonNull.INSTANCE);unknown.add("candidateHash",JsonNull.INSTANCE);unknown.addProperty("candidatePublished",false);
        assertThrows(ExecutionException.class,()->client.observeReferencePatch(r,live::get).get(3,TimeUnit.SECONDS));assertEquals(2,queries.get());assertEquals(0,sends.get());
    }
}
