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

/** Actual paired HTTP, production Node fixtures and client disk claims.
 * Synthetic server fences, no live game, paid model or world write. */
class ReferenceWorldAssemblyBridgeClientTest {
    @TempDir Path root;
    HttpServer server;ExecutorService handlers;BridgeClient client;
    JsonObject f,r,caps;ReferenceWorldAssemblyPlan plan;SelectionReadService.Capture capture;
    final List<String> routes=Collections.synchronizedList(new ArrayList<>());
    final AtomicInteger sends=new AtomicInteger(),queries=new AtomicInteger(),fences=new AtomicInteger(),attempts=new AtomicInteger(),released=new AtomicInteger();
    final AtomicBoolean live=new AtomicBoolean(true),drop=new AtomicBoolean(false);
    final AtomicReference<CompletableFuture<Void>> fence=new AtomicReference<>(CompletableFuture.completedFuture(null));
    final CountDownLatch acquired=new CountDownLatch(1);
    @BeforeAll static void boot(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void start()throws Exception{
        f=ReferenceWorldAssemblyReceiptTest.fixtures().get(0);r=ReferenceWorldAssemblyReceiptTest.reference(f);plan=ReferenceWorldAssemblyReceiptTest.plan(f);capture=ReferenceWorldAssemblyReceiptTest.capture(f);caps=f.getAsJsonObject("capabilities").deepCopy();
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(4);server.setExecutor(handlers);server.createContext("/v1/health",e->reply(e,200,bytes("{\"protocol\":1}")));server.start();
        Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    static byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
    static void reply(HttpExchange e,int status,byte[] value)throws java.io.IOException{e.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");e.sendResponseHeaders(status,value.length);try(var out=e.getResponseBody()){out.write(value);}}
    void record(HttpExchange e){assertEquals("Bearer "+"b".repeat(64),e.getRequestHeaders().getFirst("Authorization"));assertNull(e.getRequestHeaders().getFirst("Origin"));routes.add(e.getRequestMethod()+" "+e.getRequestURI());}
    void read(String path,java.util.function.Supplier<JsonObject> value){server.createContext(path,e->{record(e);assertEquals("GET",e.getRequestMethod());assertEquals(path,e.getRequestURI().toString());assertEquals(0,e.getRequestBody().readAllBytes().length);reply(e,200,bytes(value.get().toString()));});}
    void freeReads(){
        read("/v1/reference-world-assembly/capabilities",()->caps);
        read("/v1/world-contexts/"+capture.id()+"/record",()->f.getAsJsonObject("saved"));
        var models=new JsonObject();var list=new JsonArray();var model=new JsonObject();model.addProperty("id",f.getAsJsonObject("generation").get("model").getAsString());model.addProperty("supportsImages",true);model.add("efforts",f.getAsJsonObject("capability").get("efforts"));list.add(model);models.add("models",list);
        read("/v1/agents/codex/models",()->models);
    }
    void jobs(){server.createContext("/v1/reference-world-assembly/jobs",e->{
        record(e);if(e.getRequestURI().getPath().equals("/v1/reference-world-assembly/jobs")){
            assertEquals("POST",e.getRequestMethod());assertEquals(r.get("request"),JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)));
            assertEquals(r,new ReferenceWorldAssemblyReferences(root.resolve("data")).read(r.get("preparationHash").getAsString()));assertEquals(1,attempts.get());sends.incrementAndGet();
            if(drop.get()){e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(202,100);try(var out=e.getResponseBody()){out.write('{');}return;}
            reply(e,202,bytes(ReferenceWorldAssemblyReceiptTest.running(f).toString()));
        }else{assertEquals("GET",e.getRequestMethod());assertEquals("/v1/reference-world-assembly/jobs/"+r.get("id").getAsString(),e.getRequestURI().toString());assertEquals(0,e.getRequestBody().readAllBytes().length);queries.incrementAndGet();reply(e,200,bytes(f.get("retained").toString()));}
    });}
    CompletableFuture<SelectionReadService.PatchRetention> retain(SelectionReadService.Capture original,JsonObject reference){
        try{assertSame(capture,original);assertEquals(r,reference);assertFalse(ReferenceWorldAssemblyReceipt.retentionBinding(original,reference).canAuthorizePlacement());assertEquals(r,new ReferenceWorldAssemblyReferences(root.resolve("data")).read(r.get("preparationHash").getAsString()));
            var attempted=new AtomicBoolean(false);var lease=new SelectionReadService.PatchRetention(){public CompletableFuture<Void> checkedBeforeDispatch(){fences.incrementAndGet();return fence.get();}public void markDispatchAttempted(){assertTrue(attempted.compareAndSet(false,true));attempts.incrementAndGet();}public void releaseIfNotDispatched(){if(!attempted.get())released.incrementAndGet();}};acquired.countDown();return CompletableFuture.completedFuture(lease);
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
    }
    CompletableFuture<JsonObject> send(){return client.sendReferenceAssembly(()->CompletableFuture.completedFuture(capture),plan,live::get,this::retain);}
    @AfterEach void stop(){client.close();server.stop(0);handlers.shutdownNow();}
    @Test void fullPreparationUsesPureDraftAndOriginalModelWithoutOrdinaryOrOneCallConsent()throws Exception{
        freeReads();server.createContext("/v1/reference-world-assembly/contexts/"+capture.id()+"/prepare",e->{record(e);assertEquals("POST",e.getRequestMethod());var value=JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();assertEquals(Set.of("referenceOwnerId","referenceSetHash","generation"),value.keySet());assertEquals(f.get("generation"),value.get("generation"));assertEquals(f.getAsJsonObject("manifest").get("setHash"),value.get("referenceSetHash"));reply(e,200,bytes(f.get("prepared").toString()));});
        var result=client.prepareReferenceAssembly(capture,f.getAsJsonObject("generation"),f.getAsJsonObject("manifest"),live::get).get(10,TimeUnit.SECONDS);assertEquals(r,result.reference());assertEquals(List.of(),client.referenceAssemblyHistory().get(2,TimeUnit.SECONDS));assertEquals(0,sends.get());assertTrue(routes.stream().noneMatch(p->p.contains("reference-world-patch/")||p.contains("reference-generation")||p.endsWith("/confirm")));
    }
    @Test void durableFullClaimFencedOnceAndRestartOnlyGetsEvenWhenRuntimeDisabled()throws Exception{
        freeReads();jobs();assertEquals(ReferenceWorldAssemblyReceiptTest.running(f),send().get(10,TimeUnit.SECONDS));assertEquals(1,sends.get());assertEquals(1,fences.get());assertEquals(1,attempts.get());
        client.close();client=new BridgeClient(root);caps.addProperty("sendingEnabled",false);caps.addProperty("runtimeHash","f".repeat(64));routes.clear();assertEquals(f.get("retained"),send().get(5,TimeUnit.SECONDS));assertEquals(1,sends.get());assertEquals(1,queries.get());assertEquals(List.of("GET /v1/reference-world-assembly/jobs/"+r.get("id").getAsString()),routes);
        assertEquals(List.of(r),client.referenceAssemblyHistory().get(2,TimeUnit.SECONDS));assertEquals(List.of(),client.referencePatchHistory().get(2,TimeUnit.SECONDS));assertEquals(List.of(),client.patchHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void lostAckDoesNotPostAgainAndOriginalClaimRemainsReadable()throws Exception{
        freeReads();jobs();drop.set(true);assertThrows(ExecutionException.class,()->send().get(10,TimeUnit.SECONDS));assertEquals(List.of(r),client.referenceAssemblyHistory().get(2,TimeUnit.SECONDS));routes.clear();assertEquals(f.get("retained"),send().get(5,TimeUnit.SECONDS));assertEquals(1,sends.get());assertEquals(1,queries.get());assertEquals(1,attempts.get());assertTrue(routes.stream().allMatch(p->p.startsWith("GET ")));
    }
    @Test void changedRuntimeRejectsFreshSendKeepsClaimAndSubsequentAttemptOnlyQueries()throws Exception{
        freeReads();jobs();caps.addProperty("runtimeHash","f".repeat(64));assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(0,sends.get());assertEquals(0,attempts.get());assertEquals(List.of(r),client.referenceAssemblyHistory().get(2,TimeUnit.SECONDS));assertEquals(f.get("retained"),send().get(5,TimeUnit.SECONDS));assertEquals(1,queries.get());
    }
    @Test void closingBeforeDispatchReleasesFenceAndNeverResendsConsumedClaim()throws Exception{
        freeReads();jobs();var blocked=new CompletableFuture<Void>();fence.set(blocked);var pending=send();assertTrue(acquired.await(5,TimeUnit.SECONDS));live.set(false);blocked.complete(null);assertThrows(Exception.class,()->pending.get(5,TimeUnit.SECONDS));assertEquals(0,sends.get());assertEquals(0,attempts.get());assertEquals(1,released.get());live.set(true);assertEquals(f.get("retained"),send().get(5,TimeUnit.SECONDS));assertEquals(0,sends.get());
    }
    @Test void failedServerFenceCannotGrantSendOrWorldRights()throws Exception{
        freeReads();jobs();fence.set(CompletableFuture.failedFuture(new IllegalStateException("synthetic changed world")));assertThrows(ExecutionException.class,()->send().get(5,TimeUnit.SECONDS));assertEquals(0,sends.get());assertEquals(0,attempts.get());assertEquals(1,released.get());assertEquals(List.of(r),client.referenceAssemblyHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void mismatchedOriginalStatusIsRejectedWithoutLegacyFallbackOrPost()throws Exception{
        jobs();f.getAsJsonObject("retained").addProperty("requestHash","f".repeat(64));assertThrows(ExecutionException.class,()->client.readReferenceAssemblyJob(r).get(5,TimeUnit.SECONDS));assertEquals(0,sends.get());assertEquals(1,queries.get());assertEquals(1,routes.size());assertTrue(routes.get(0).startsWith("GET /v1/reference-world-assembly/"));
    }
    @Test void nonJsonReceiptCannotBecomeAPlanOrDispatch()throws Exception{
        server.createContext("/v1/reference-world-assembly/capabilities",e->{record(e);e.getResponseHeaders().set("Content-Type","text/html");var bytes=bytes(caps.toString());e.sendResponseHeaders(200,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}});
        assertThrows(ExecutionException.class,()->client.prepareReferenceAssembly(capture,f.getAsJsonObject("generation"),f.getAsJsonObject("manifest"),live::get).get(5,TimeUnit.SECONDS));assertEquals(1,routes.size());assertEquals(List.of(),client.referenceAssemblyHistory().get(2,TimeUnit.SECONDS));
    }
}
