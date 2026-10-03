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
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

/** Production Java methods against a loopback-only free HTTP fixture. All
 * pins and receipts originate in the production Node Java fixture builder;
 * no adapter, external network, client UI or world is opened. */
final class WorldPatchBridgeClientTest {
    @TempDir Path root;
    private HttpServer server;private ExecutorService handlers;private BridgeClient client;
    private JsonObject fixture,reference;private SelectionReadService.Capture capture;
    private final AtomicInteger retained=new AtomicInteger(),retentionChecks=new AtomicInteger(),dispatchAttempted=new AtomicInteger(),abandoned=new AtomicInteger();
    private final CountDownLatch acquisition=new CountDownLatch(1);
    private CompletableFuture<Void> retentionFence=CompletableFuture.completedFuture(null);
    @BeforeAll static void boot(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void start()throws Exception{
        fixture=WorldPatchTaskReceiptTest.fixture();capture=ContextTaskReceiptTest.capture(fixture);
        reference=WorldPatchJobReceipt.reference(capture,fixture.getAsJsonObject("prepared"),fixture.getAsJsonObject("frozen"),fixture.get("runtimeHash").getAsString());
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(4);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,"{\"protocol\":1}"));server.start();
        Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    private static void reply(HttpExchange e,String json)throws java.io.IOException{byte[] bytes=json.getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}}
    private static JsonObject body(HttpExchange e)throws java.io.IOException{return JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();}
    private JsonObject capabilities(boolean enabled){return fixture.getAsJsonObject(enabled?"sendingCapabilities":"disabledSendingCapabilities").deepCopy();}
    private void ordinaryEndpoints(){
        server.createContext("/v2/world-patch/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,capabilities(true).toString());});
        server.createContext("/v1/world-contexts/"+capture.id()+"/record",e->{assertEquals("GET",e.getRequestMethod());reply(e,fixture.getAsJsonObject("saved").toString());});
    }
    private String job(){return "/v2/world-patch/jobs/"+reference.get("capsuleId").getAsString();}
    private CompletableFuture<SelectionReadService.PatchRetention> retention(SelectionReadService.Capture original,JsonObject pin){
        try{assertSame(capture,original);assertEquals(reference,pin);assertEquals(pin,new WorldPatchReferences(root.resolve("data")).read(pin.get("capsuleId").getAsString()));retained.incrementAndGet();
            var attempted=new AtomicBoolean(false);var result=new SelectionReadService.PatchRetention(){
                public CompletableFuture<Void> checkedBeforeDispatch(){retentionChecks.incrementAndGet();return retentionFence;}
                public void markDispatchAttempted(){assertTrue(attempted.compareAndSet(false,true));dispatchAttempted.incrementAndGet();}
                public void releaseIfNotDispatched(){if(!attempted.get())abandoned.incrementAndGet();}
            };acquisition.countDown();return CompletableFuture.completedFuture(result);
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
    }
    private CompletableFuture<WorldPatchSubmission> send(java.util.function.BooleanSupplier live){return client.sendPatch(()->CompletableFuture.completedFuture(capture),fixture.getAsJsonObject("prepared"),fixture.getAsJsonObject("frozen"),fixture.get("runtimeHash").getAsString(),live,this::retention);}
    @AfterEach void stop(){client.close();server.stop(0);handlers.shutdownNow();}
    @Test void prepareAndFreezePreserveExactIntentAndNeverDispatchSend()throws Exception{
        ordinaryEndpoints();var prepares=new AtomicInteger();var freezes=new AtomicInteger();
        server.createContext("/v1/world-contexts/"+capture.id()+"/patch-task-disclosure",e->{assertEquals("POST",e.getRequestMethod());assertEquals(fixture.get("intent"),body(e));prepares.incrementAndGet();reply(e,fixture.getAsJsonObject("prepared").toString());});
        server.createContext("/v1/world-contexts/"+capture.id()+"/patch-freeze-task",e->{assertEquals("POST",e.getRequestMethod());var input=body(e);assertEquals(java.util.Set.of("intent","confirmation"),input.keySet());assertEquals(fixture.get("intent"),input.get("intent"));assertEquals(fixture.get("confirmation"),input.get("confirmation"));freezes.incrementAndGet();reply(e,fixture.getAsJsonObject("frozen").toString());});
        var prepared=client.preparePatchTask(capture,fixture.getAsJsonObject("intent")).get(5,TimeUnit.SECONDS);assertEquals(fixture.get("prepared"),prepared);
        assertEquals(fixture.get("frozen"),client.freezePatchTask(capture,prepared).get(5,TimeUnit.SECONDS));assertEquals(1,prepares.get());assertEquals(1,freezes.get());assertEquals(java.util.List.of(),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void explicitSendPublishesReferenceBeforeExactPostAndRestartOnlyQueries()throws Exception{
        ordinaryEndpoints();var posts=new AtomicInteger();var queries=new AtomicInteger();
        server.createContext(job(),e->{if(e.getRequestURI().getPath().endsWith("/send")){assertEquals("POST",e.getRequestMethod());assertEquals(reference,new WorldPatchReferences(root.resolve("data")).read(reference.get("capsuleId").getAsString()));assertEquals(reference.get("send"),body(e));posts.incrementAndGet();}else{assertEquals("GET",e.getRequestMethod());assertEquals(0,e.getRequestBody().readAllBytes().length);queries.incrementAndGet();}reply(e,fixture.getAsJsonObject("status").toString());});
        var result=send(()->true).get(5,TimeUnit.SECONDS);assertEquals(reference,result.reference());assertEquals(fixture.get("status"),result.status());assertEquals(1,posts.get());
        client.close();client=new BridgeClient(root);assertEquals(reference,send(()->true).get(5,TimeUnit.SECONDS).reference());assertEquals(1,posts.get());assertEquals(1,queries.get());assertEquals(java.util.List.of(reference),client.patchHistory().get(2,TimeUnit.SECONDS));
        assertEquals(1,retained.get());assertEquals(1,retentionChecks.get());assertEquals(1,dispatchAttempted.get());assertEquals(0,abandoned.get());
    }
    @Test void closedDuringFinalServerFenceRetainsClaimAndNeverPosts()throws Exception{
        var live=new AtomicBoolean(true);var reads=new AtomicInteger();var posts=new AtomicInteger();server.createContext("/v2/world-patch/capabilities",e->reply(e,capabilities(true).toString()));
        server.createContext("/v1/world-contexts/"+capture.id()+"/record",e->{if(reads.incrementAndGet()==2)live.set(false);reply(e,fixture.getAsJsonObject("saved").toString());});server.createContext(job(),e->{posts.incrementAndGet();reply(e,fixture.getAsJsonObject("status").toString());});
        assertThrows(ExecutionException.class,()->send(live::get).get(5,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals(2,reads.get());assertEquals(java.util.List.of(reference),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void referencePublicationFailureCannotFallBackToPost()throws Exception{
        ordinaryEndpoints();Files.writeString(root.resolve("data/world-patch-references"),"preserve-wrong-type");var posts=new AtomicInteger();server.createContext(job(),e->{posts.incrementAndGet();reply(e,"{}");});
        assertThrows(ExecutionException.class,()->send(()->true).get(5,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals("preserve-wrong-type",Files.readString(root.resolve("data/world-patch-references")));
    }
    @Test void samePageReentryCannotReactivateOriginalQueuedSend()throws Exception{
        var page=new WorldPatchPageState();page.enter();var originalClick=page.publication();var reads=new AtomicInteger();var posts=new AtomicInteger();server.createContext("/v2/world-patch/capabilities",e->reply(e,capabilities(true).toString()));
        server.createContext("/v1/world-contexts/"+capture.id()+"/record",e->{if(reads.incrementAndGet()==2){page.leave();page.enter();assertTrue(page.live());assertFalse(originalClick.getAsBoolean());}reply(e,fixture.getAsJsonObject("saved").toString());});server.createContext(job(),e->{posts.incrementAndGet();reply(e,fixture.getAsJsonObject("status").toString());});
        assertThrows(ExecutionException.class,()->send(originalClick).get(5,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals(java.util.List.of(reference),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void incompleteHttpResponseCannotCauseSecondSendAfterReconnection()throws Exception{
        ordinaryEndpoints();var posts=new AtomicInteger();var queries=new AtomicInteger();server.createContext(job(),e->{if(e.getRequestURI().getPath().endsWith("/send")){posts.incrementAndGet();body(e);e.sendResponseHeaders(200,100);try(var out=e.getResponseBody()){out.write('{');}}else{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,fixture.getAsJsonObject("status").toString());}});
        assertThrows(ExecutionException.class,()->send(()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());assertEquals(java.util.List.of(reference),client.patchHistory().get(2,TimeUnit.SECONDS));
        assertEquals(fixture.get("status"),send(()->true).get(5,TimeUnit.SECONDS).status());assertEquals(1,posts.get());assertEquals(1,queries.get());
        assertEquals(1,retained.get());assertEquals(1,dispatchAttempted.get());assertEquals(0,abandoned.get());
    }
    @Test void failedOriginalRetentionCannotDispatchOrQuerySubstitute()throws Exception{
        ordinaryEndpoints();retentionFence=CompletableFuture.failedFuture(new IllegalStateException("Original server capture changed"));var posts=new AtomicInteger();server.createContext(job(),e->{posts.incrementAndGet();reply(e,fixture.getAsJsonObject("status").toString());});
        assertThrows(ExecutionException.class,()->send(()->true).get(5,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals(1,retained.get());assertEquals(0,dispatchAttempted.get());assertEquals(1,abandoned.get());assertEquals(java.util.List.of(reference),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void closingDuringRetentionFenceAbandonsWithoutRenewingOrPosting()throws Exception{
        ordinaryEndpoints();retentionFence=new CompletableFuture<>();var live=new AtomicBoolean(true);var posts=new AtomicInteger();server.createContext(job(),e->{posts.incrementAndGet();reply(e,fixture.getAsJsonObject("status").toString());});
        var pending=send(live::get);assertTrue(acquisition.await(3,TimeUnit.SECONDS));live.set(false);retentionFence.complete(null);
        assertThrows(ExecutionException.class,()->pending.get(5,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals(0,dispatchAttempted.get());assertEquals(1,abandoned.get());
    }
    @Test void closingAfterActualPostRetainsOriginalAndDoesNotRetry()throws Exception{
        ordinaryEndpoints();var live=new AtomicBoolean(true);var posts=new AtomicInteger();server.createContext(job(),e->{if(e.getRequestURI().getPath().endsWith("/send")){posts.incrementAndGet();live.set(false);assertEquals(1,dispatchAttempted.get());}reply(e,fixture.getAsJsonObject("status").toString());});
        assertEquals(fixture.get("status"),send(live::get).get(5,TimeUnit.SECONDS).status());assertEquals(1,posts.get());assertEquals(0,abandoned.get());assertEquals(1,retained.get());
    }
    @Test void disabledChangedRuntimeOrForgedAuthorityCannotSend()throws Exception{
        var value=new AtomicReference<>(capabilities(false));var posts=new AtomicInteger();server.createContext("/v2/world-patch/capabilities",e->reply(e,value.get().toString()));server.createContext(job(),e->{posts.incrementAndGet();reply(e,"{}");});
        assertNull(client.patchRuntime().get(2,TimeUnit.SECONDS));assertThrows(ExecutionException.class,()->send(()->true).get(3,TimeUnit.SECONDS));
        var changed=capabilities(true);changed.addProperty("runtimeHash","f".repeat(64));value.set(changed);assertThrows(ExecutionException.class,()->send(()->true).get(3,TimeUnit.SECONDS));
        for(var key:java.util.List.of("placementImplemented","serverBaselineVerified","canAuthorizePlacement","summaryConsentTransferable")){changed=capabilities(true);changed.addProperty(key,true);value.set(changed);assertThrows(ExecutionException.class,()->client.patchRuntime().get(2,TimeUnit.SECONDS));}
        changed=capabilities(true);changed.addProperty("sendingImplemented",false);value.set(changed);assertThrows(ExecutionException.class,()->client.patchRuntime().get(2,TimeUnit.SECONDS));
        assertEquals(0,posts.get());assertEquals(java.util.List.of(),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void unsupportedOrLegacyCapabilityCannotFallBackToV1Send()throws Exception{
        var legacyCalls=new AtomicInteger();server.createContext("/v1/world-patch",e->{legacyCalls.incrementAndGet();reply(e,capabilities(true).toString());});
        var value=new AtomicReference<>(capabilities(true));server.createContext("/v2/world-patch/capabilities",e->reply(e,value.get().toString()));
        for(int version:java.util.List.of(1,3)){var invalid=capabilities(true);invalid.addProperty("version",version);value.set(invalid);assertThrows(ExecutionException.class,()->send(()->true).get(3,TimeUnit.SECONDS));}
        var invalid=capabilities(true);invalid.addProperty("preparationEnabled",false);value.set(invalid);assertThrows(ExecutionException.class,()->send(()->true).get(3,TimeUnit.SECONDS));
        invalid=capabilities(true);invalid.addProperty("runtimeHash",(String)null);value.set(invalid);assertThrows(ExecutionException.class,()->send(()->true).get(3,TimeUnit.SECONDS));
        assertEquals(0,legacyCalls.get());assertEquals(java.util.List.of(),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void productionRouteWhitelistDoesNotOpenOtherProtocolsOrRedirects()throws Exception{
        for(var route:java.util.List.of("/v2/config","/v3/world-patch/capabilities","https://example.com/v2/world-patch/capabilities","/v2/world-patch/jobs/../send","/v2/world-patch/capabilities#send","/v2/world-patch/capabilities?allowWorldWrites=true")){
            assertThrows(ExecutionException.class,()->client.request("GET",route,null).get(2,TimeUnit.SECONDS));
        }
    }
    @Test void localRecheckHasIndependentAcknowledgementAndNoSubstituteContent()throws Exception{
        var retained=fixture.getAsJsonObject("status").deepCopy();retained.addProperty("state","response-retained");retained.add("responseCheck",JsonNull.INSTANCE);retained.add("candidateHash",JsonNull.INSTANCE);retained.addProperty("candidatePublished",false);var posts=new AtomicInteger();var queries=new AtomicInteger();
        server.createContext(job(),e->{if(e.getRequestMethod().equals("GET")){queries.incrementAndGet();reply(e,retained.toString());}else{assertEquals(job()+"/recheck-response",e.getRequestURI().getPath());assertEquals(JsonParser.parseString("{\"confirmed\":true}"),body(e));posts.incrementAndGet();reply(e,fixture.getAsJsonObject("status").toString());}});
        assertEquals(fixture.get("status"),client.recoverPatch(reference,false,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());assertEquals(1,queries.get());
        assertThrows(java.util.concurrent.CancellationException.class,()->client.recoverPatch(reference,false,()->false));assertEquals(1,posts.get());
    }
    @Test void observingWithoutOriginalTurnBindingCannotPostOrGenerate()throws Exception{
        var status=fixture.getAsJsonObject("status");var posts=new AtomicInteger();var queries=new AtomicInteger();server.createContext(job(),e->{if(e.getRequestMethod().equals("POST"))posts.incrementAndGet();else queries.incrementAndGet();reply(e,status.toString());});
        assertThrows(ExecutionException.class,()->client.recoverPatch(reference,true,()->true).get(3,TimeUnit.SECONDS));assertEquals(1,queries.get());assertEquals(0,posts.get());
    }
    @Test void previewDownloadUsesOriginalPinsAndNeverSendOrRecheckRoute()throws Exception{
        var pin=WorldPatchJobReceipt.candidate(reference,fixture.getAsJsonObject("status"));var reads=new AtomicInteger();byte[] bytes=Files.readAllBytes(Path.of("build/test-fixtures/world-patch-preview-download.json"));
        server.createContext(job(),e->{assertEquals("GET",e.getRequestMethod());assertEquals(job()+"/preview",e.getRequestURI().getPath());assertEquals("candidateHash="+pin.candidateHash(),e.getRequestURI().getQuery());reads.incrementAndGet();reply(e,new String(bytes,StandardCharsets.UTF_8));});
        var download=client.loadPatchPreview(pin,()->false).get(5,TimeUnit.SECONDS);assertEquals(pin,download.reference());assertEquals(1,download.preview().totalWrites());assertFalse(download.canAuthorizePlacement());assertEquals(1,reads.get());
        assertThrows(ExecutionException.class,()->client.loadPatchPreview(pin,()->true).get(3,TimeUnit.SECONDS));assertEquals(1,reads.get());
    }
}
