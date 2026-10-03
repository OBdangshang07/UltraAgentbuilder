package dev.voxelstudio.client;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class BridgeClientTest {
    @TempDir Path dir;
    HttpServer server;BridgeClient client;ExecutorService handlers;
    final CountDownLatch slowStarted=new CountDownLatch(1),releaseSlow=new CountDownLatch(1);
    @BeforeAll static void boot(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void start()throws Exception{
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(6);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,"{\"protocol\":1}"));
        server.createContext("/v1/agents",e->{slowStarted.countDown();try{releaseSlow.await(30,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}reply(e,"{\"models\":[]}");});
        server.createContext("/v1/jobs/test/cancel",e->reply(e,"{\"state\":\"cancelled\"}"));server.start();
        Files.createDirectories(dir.resolve("data"));Files.writeString(dir.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"a".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");
        client=new BridgeClient(dir);
    }
    static void reply(HttpExchange e,String text)throws java.io.IOException{byte[] b=text.getBytes(java.nio.charset.StandardCharsets.UTF_8);e.sendResponseHeaders(200,b.length);try(var out=e.getResponseBody()){out.write(b);}}
    @AfterEach void stop(){releaseSlow.countDown();client.close();server.stop(0);handlers.shutdownNow();}
    @Test void cancelBypassesBlockedDiscovery()throws Exception{
        var slow=client.request("GET","/v1/agents",null);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(slow.isDone());
        releaseSlow.countDown();slow.get(2,TimeUnit.SECONDS);
    }
    @Test void cancelBypassesContextUploadAndHashingLane()throws Exception{
        var cap=ContextPublicationTest.capture();server.createContext("/v1/world-contexts/"+cap.id()+"/capture",e->{e.getRequestBody().readAllBytes();slowStarted.countDown();try{releaseSlow.await(30,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}reply(e,"{}");});
        var upload=client.saveContext(cap);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(upload.isDone());releaseSlow.countDown();assertThrows(ExecutionException.class,()->upload.get(2,TimeUnit.SECONDS));
    }
    @Test void cancelBypassesIndependentReferenceLane()throws Exception{
        server.createContext("/v1/reference-generation-jobs/capabilities",e->{slowStarted.countDown();try{releaseSlow.await(30,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}reply(e,"{}");});
        var slow=client.referenceSendingEnabled();assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(slow.isDone());releaseSlow.countDown();assertThrows(ExecutionException.class,()->slow.get(2,TimeUnit.SECONDS));
    }
    @Test void pendingReferenceIntentIsAnOriginalReceiptNotPermissionToResend()throws Exception{
        var requests=new java.util.concurrent.atomic.AtomicInteger();server.createContext("/v1/jobs/by-key",e->{assertEquals("GET",e.getRequestMethod());requests.incrementAndGet();reply(e,"{\"job\":null,\"pendingReferenceSubmission\":true,\"error\":\"original SEND retained\"}");});
        var result=client.lookupOriginalTask("saved").get(2,TimeUnit.SECONDS);assertNull(result.job());assertTrue(result.pendingReferenceSubmission());assertEquals("original SEND retained",result.error());
        assertThrows(ExecutionException.class,()->client.lookupTask("saved").get(2,TimeUnit.SECONDS));assertEquals(2,requests.get());
    }
    @Test void referenceHistoryClientReadsOnlyExactOriginalGetRoutesAndNoSendOrConfirmation()throws Exception{
        var c=ReferenceJobHistoryReceiptTest.fixture();var original=c.getAsJsonObject("historyJob");String prefix="/v1/reference-generation-jobs/"+original.get("id").getAsString();
        var queries=new java.util.concurrent.atomic.AtomicInteger();var pictures=new java.util.concurrent.atomic.AtomicInteger();var mutations=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext(prefix+"/history",e->{assertEquals("GET",e.getRequestMethod());assertEquals(0,e.getRequestBody().readAllBytes().length);queries.incrementAndGet();reply(e,c.get("history").toString());});
        for(int i=0;i<2;i++){var record=c.getAsJsonObject("history").getAsJsonObject("manifest").getAsJsonArray("references").get(i).getAsJsonObject();var png=java.util.Base64.getDecoder().decode(c.getAsJsonArray("historyImages").get(i).getAsString());
            server.createContext(prefix+"/images/"+record.get("id").getAsString(),e->{assertEquals("GET",e.getRequestMethod());pictures.incrementAndGet();e.sendResponseHeaders(200,png.length);try(var out=e.getResponseBody()){out.write(png);}});
        }
        server.createContext("/v1/reference-generation-jobs",e->{mutations.incrementAndGet();reply(e,"{}");});
        var result=client.readReferenceHistory(original).get(8,TimeUnit.SECONDS);assertEquals(c.get("history"),result.history());assertEquals(2,result.images().size());assertEquals(1,queries.get());assertEquals(2,pictures.get());assertEquals(0,mutations.get());
        result.history().addProperty("state","external edit");assertEquals("queued",result.history().get("state").getAsString());
    }
    @Test void cancelBypassesSlowHistoryAndSubstitutedPixelsCannotAppearAsOriginal()throws Exception{
        var c=ReferenceJobHistoryReceiptTest.fixture();var original=c.getAsJsonObject("historyJob");String prefix="/v1/reference-generation-jobs/"+original.get("id").getAsString();
        server.createContext(prefix+"/history",e->{slowStarted.countDown();try{releaseSlow.await(30,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}reply(e,c.get("history").toString());});
        byte[] wrong=ReferenceImageDraftTest.png(3,2);server.createContext(prefix+"/images",e->{e.sendResponseHeaders(200,wrong.length);try(var out=e.getResponseBody()){out.write(wrong);}});
        var pending=client.readReferenceHistory(original);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(pending.isDone());releaseSlow.countDown();assertThrows(ExecutionException.class,()->pending.get(5,TimeUnit.SECONDS));
        var invalid=original.deepCopy();invalid.addProperty("id","../../another-job");assertThrows(ExecutionException.class,()->client.readReferenceHistory(invalid).get(2,TimeUnit.SECONDS));
    }
    @Test void actualReferenceClientUploadPixelReadbackAndFreeConfirmationUseOnlyExactLocalRoutes()throws Exception{
        var fixture=ReferencePreparationReceiptTest.fixtures();var c=fixture.getAsJsonArray("cases").get(0).getAsJsonObject();var p=c.getAsJsonObject("preparation");var snapshot=ReferencePreparationReceiptTest.snapshot(c);
        var uploads=new java.util.concurrent.atomic.AtomicInteger();var pictures=new java.util.concurrent.atomic.AtomicInteger();var consents=new java.util.concurrent.atomic.AtomicInteger();var sends=new java.util.concurrent.atomic.AtomicInteger();
        String route="/v1/reference-drafts/"+snapshot.ownerId();
        server.createContext(route+"/prepare",e->{assertEquals("POST",e.getRequestMethod());var input=com.google.gson.JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            assertEquals(c.get("generation"),input.get("generation"));assertEquals(2,input.get("version").getAsInt());assertEquals(snapshot.upload(),input.get("upload"));assertFalse(input.has("path"));uploads.incrementAndGet();reply(e,p.toString());});
        for(int i=0;i<snapshot.photos().size();i++){
            var r=p.getAsJsonArray("references").get(i).getAsJsonObject();byte[] actual=java.util.Base64.getDecoder().decode(c.getAsJsonObject("upload").getAsJsonArray("references").get(i).getAsJsonObject().get("png").getAsString());
            server.createContext(route+"/preparations/"+p.get("preparationHash").getAsString()+"/images/"+r.get("id").getAsString(),e->{assertEquals("GET",e.getRequestMethod());pictures.incrementAndGet();e.getResponseHeaders().add("Content-Type","image/png");e.sendResponseHeaders(200,actual.length);try(var out=e.getResponseBody()){out.write(actual);}});
        }
        server.createContext(route+"/preparations/"+p.get("preparationHash").getAsString()+"/confirm",e->{assertEquals("POST",e.getRequestMethod());var consent=com.google.gson.JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));assertEquals(ReferencePreparationReceipt.freeConfirmation(p),consent);consents.incrementAndGet();reply(e,c.get("receipt").toString());});
        server.createContext("/v1/reference-generation-jobs/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,fixture.get("disabledCapability").toString());});
        server.createContext("/v1/reference-generation-jobs",e->{sends.incrementAndGet();reply(e,"{}");});
        var result=client.prepareReference(snapshot,c.getAsJsonObject("generation"),c.getAsJsonObject("ordinaryPolicy")).get(8,TimeUnit.SECONDS);assertEquals(p,result.preparation());assertEquals(2,result.images().size());
        assertEquals(c.get("receipt"),client.confirmReference(result.preparation()).get(3,TimeUnit.SECONDS));assertFalse(client.referenceSendingEnabled().get(3,TimeUnit.SECONDS));assertEquals(1,uploads.get());assertEquals(2,pictures.get());assertEquals(1,consents.get());assertEquals(0,sends.get());
        result.preparation().addProperty("model","external change");assertEquals(p,result.preparation());
    }
    @Test void alteredPreparedPictureStopsBeforeConsentOrModelSend()throws Exception{
        var fixture=ReferencePreparationReceiptTest.fixtures();var c=fixture.getAsJsonArray("cases").get(0).getAsJsonObject();var p=c.getAsJsonObject("preparation");var snapshot=ReferencePreparationReceiptTest.snapshot(c);String route="/v1/reference-drafts/"+snapshot.ownerId();var calls=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext(route+"/prepare",e->{e.getRequestBody().readAllBytes();reply(e,p.toString());});
        byte[] wrong=ReferenceImageDraftTest.png(3,2);server.createContext(route+"/preparations/"+p.get("preparationHash").getAsString()+"/images",e->{e.sendResponseHeaders(200,wrong.length);try(var out=e.getResponseBody()){out.write(wrong);}});
        server.createContext("/v1/reference-generation-jobs",e->{calls.incrementAndGet();reply(e,"{}");});
        assertThrows(ExecutionException.class,()->client.prepareReference(snapshot,c.getAsJsonObject("generation"),c.getAsJsonObject("ordinaryPolicy")).get(8,TimeUnit.SECONDS));assertEquals(0,calls.get());
    }
    static void bytes(HttpExchange e,byte[] bytes)throws java.io.IOException{e.sendResponseHeaders(200,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}}
    @Test void exactImageRestoreClientOnlyGetsSelectedOriginalBytesAndRechecksOriginalScope()throws Exception{
        var c=ReferenceImageRestoreReceiptTest.fixture();var p=c.getAsJsonObject("preparation");var s=ReferenceImageRestoreReceiptTest.scope(c);
        String owner=p.get("ownerId").getAsString(),hash=p.get("preparationHash").getAsString(),prefix="/v1/reference-drafts/"+owner;
        var reads=new java.util.concurrent.atomic.AtomicInteger();var pictures=new java.util.concurrent.atomic.AtomicInteger();var forbidden=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/v1/reference-image-restore/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,ReferencePreparationReceiptTestUnchecked.restoreCapability());});
        server.createContext(prefix+"/archive",e->{assertEquals("GET",e.getRequestMethod());assertEquals(0,e.getRequestBody().readAllBytes().length);reads.incrementAndGet();reply(e,s.toString());});
        server.createContext(prefix+"/preparations/"+hash+"/record",e->{assertEquals("GET",e.getRequestMethod());bytes(e,ReferenceImageRestoreReceiptTest.raw(c));});
        for(int i=0;i<p.getAsJsonArray("references").size();i++){final int index=i;var r=p.getAsJsonArray("references").get(i).getAsJsonObject();
            server.createContext(prefix+"/preparations/"+hash+"/images/"+r.get("id").getAsString(),e->{assertEquals("GET",e.getRequestMethod());pictures.incrementAndGet();bytes(e,java.util.Base64.getDecoder().decode(c.getAsJsonObject("editorRestore").getAsJsonArray("images").get(index).getAsString()));});
        }
        server.createContext("/v1/reference-generation-jobs",e->{forbidden.incrementAndGet();reply(e,"{}");});
        server.createContext("/v1/jobs",e->{forbidden.incrementAndGet();reply(e,"{}");});
        var result=client.readReferenceImagesForNewDraft(s,hash).get(8,TimeUnit.SECONDS);assertEquals(p,result.preparation());assertEquals(2,result.photos().size());
        assertEquals(2,reads.get());assertEquals(2,pictures.get());assertEquals(0,forbidden.get());assertFalse(Files.exists(dir.resolve("data/client-state")));
        result.preparation().addProperty("model","outside edit");assertEquals(p,result.preparation());
    }
    private static final class ReferencePreparationReceiptTestUnchecked{
        static String restoreCapability()throws java.io.IOException{try{return ReferencePreparationReceiptTest.fixtures().get("imageRestoreCapability").toString();}catch(Exception e){throw new java.io.IOException(e);}}
    }
    @Test void imageRestoreRejectsInventoryChangeAfterPixelsAndNeverUsesReplacementScope()throws Exception{
        var c=ReferenceImageRestoreReceiptTest.fixture();var p=c.getAsJsonObject("preparation");var s=ReferenceImageRestoreReceiptTest.scope(c);
        String hash=p.get("preparationHash").getAsString(),prefix="/v1/reference-drafts/"+p.get("ownerId").getAsString();
        var reads=new java.util.concurrent.atomic.AtomicInteger();var changed=s.deepCopy();changed.getAsJsonArray("files").get(0).getAsJsonObject().addProperty("sha256","e".repeat(64));ReferencePreparationReceiptTest.rehash(changed,"snapshotHash");
        server.createContext("/v1/reference-image-restore/capabilities",e->reply(e,ReferencePreparationReceiptTestUnchecked.restoreCapability()));
        server.createContext(prefix+"/archive",e->reply(e,(reads.incrementAndGet()==1?s:changed).toString()));
        server.createContext(prefix+"/preparations/"+hash+"/record",e->bytes(e,ReferenceImageRestoreReceiptTest.raw(c)));
        for(int i=0;i<p.getAsJsonArray("references").size();i++){final int index=i;var r=p.getAsJsonArray("references").get(i).getAsJsonObject();
            server.createContext(prefix+"/preparations/"+hash+"/images/"+r.get("id").getAsString(),e->bytes(e,java.util.Base64.getDecoder().decode(c.getAsJsonObject("editorRestore").getAsJsonArray("images").get(index).getAsString())));
        }
        assertThrows(ExecutionException.class,()->client.readReferenceImagesForNewDraft(s,hash).get(8,TimeUnit.SECONDS));assertEquals(2,reads.get());
        assertFalse(Files.exists(dir.resolve("data/client-state")));
    }
    @Test void slowExactImageRecordCannotBlockCancelAndReconnectDiscardsItsOldResult()throws Exception{
        var c=ReferenceImageRestoreReceiptTest.fixture();var p=c.getAsJsonObject("preparation");var s=ReferenceImageRestoreReceiptTest.scope(c);
        String hash=p.get("preparationHash").getAsString(),prefix="/v1/reference-drafts/"+p.get("ownerId").getAsString();
        server.createContext("/v1/reference-image-restore/capabilities",e->reply(e,ReferencePreparationReceiptTestUnchecked.restoreCapability()));
        server.createContext(prefix+"/archive",e->reply(e,s.toString()));
        server.createContext(prefix+"/preparations/"+hash+"/record",e->{slowStarted.countDown();try{releaseSlow.await(15,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}bytes(e,ReferenceImageRestoreReceiptTest.raw(c));});
        var pending=client.readReferenceImagesForNewDraft(s,hash);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(pending.isDone());
        client.reconnect();releaseSlow.countDown();assertThrows(ExecutionException.class,()->pending.get(5,TimeUnit.SECONDS));
    }
    @Test void reconnectRejectsLateResponse()throws Exception{
        var slow=client.request("GET","/v1/agents",null);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));client.reconnect();
        assertEquals(1,client.request("GET","/v1/health",null).get(2,TimeUnit.SECONDS).get("protocol").getAsInt());releaseSlow.countDown();assertThrows(ExecutionException.class,()->slow.get(2,TimeUnit.SECONDS));
    }
    @Test void cancelBypassesHungBodyAndSupersededDownloadIsInterrupted()throws Exception{
        String id="11111111-1111-1111-1111-111111111111";
        server.createContext("/v1/jobs/"+id+"/manifest",e->reply(e,Files.readString(Path.of("build/test-fixtures/manifest.json"))));
        server.createContext("/v1/jobs/"+id+"/cells",e->{e.sendResponseHeaders(200,0);e.getResponseBody().write(new byte[]{0,0});e.getResponseBody().flush();slowStarted.countDown();try{releaseSlow.await(30,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}e.close();});
        var load=client.load(id);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS);client.cancelLoad();assertThrows(ExecutionException.class,()->load.get(2,TimeUnit.SECONDS));
    }
    @Test void boundedSubscriberRejectsOversize(){
        var body=new BridgeClient.LimitedBody(3);var cancelled=new java.util.concurrent.atomic.AtomicBoolean();body.onSubscribe(new Flow.Subscription(){public void request(long n){}public void cancel(){cancelled.set(true);}});
        body.onNext(java.util.List.of(java.nio.ByteBuffer.wrap(new byte[4])));assertTrue(cancelled.get());assertTrue(body.getBody().toCompletableFuture().isCompletedExceptionally());
    }
    @Test void recoveryUsesExactReadOnlyKeyAndRejectsMismatchedIdentity()throws Exception{
        var queries=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/v1/jobs/by-key",e->{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();String key=e.getRequestURI().getQuery().substring(4);reply(e,key.equals("missing")?"{\"job\":null}":"{\"job\":{\"id\":\"11111111-1111-1111-1111-111111111111\",\"key\":\"saved\"}}");});
        assertEquals("saved",client.lookupTask("saved").get(2,TimeUnit.SECONDS).get("key").getAsString());
        assertNull(client.lookupTask("missing").get(2,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.lookupTask("wrong").get(2,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.lookupTask("x&key=y").get(2,TimeUnit.SECONDS));assertEquals(3,queries.get());
    }
    @Test void closeIsNonBlockingAndDoesNotShutdownForeignBridge()throws Exception{
        client.request("GET","/v1/health",null).get(2,TimeUnit.SECONDS);long start=System.nanoTime();client.close();assertTrue(System.nanoTime()-start<100_000_000);assertTrue(server.getAddress().getPort()>0);
    }
    @Test void analysisRecoveryOnlyQueriesExactOriginalIdentity()throws Exception{
        var value=ContextAnalysisReceiptTest.cases().get(0).getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var status=value.getAsJsonObject("status");
        var queries=new java.util.concurrent.atomic.AtomicInteger();server.createContext("/v1/context-analysis/",e->{assertEquals("GET",e.getRequestMethod());assertEquals("/v1/context-analysis/"+reference.get("requestHash").getAsString(),e.getRequestURI().getPath());assertEquals(0,e.getRequestBody().readAllBytes().length);queries.incrementAndGet();reply(e,status.toString());});
        assertEquals(status,client.readContextAnalysis(reference).get(2,TimeUnit.SECONDS));assertEquals(status,client.readContextAnalysis(reference).get(2,TimeUnit.SECONDS));
        var invalid=reference.deepCopy();invalid.addProperty("requestHash","../../resubmit");assertThrows(ExecutionException.class,()->client.readContextAnalysis(invalid).get(2,TimeUnit.SECONDS));assertEquals(2,queries.get());
        assertThrows(ExecutionException.class,()->client.readContextAnalysis(null).get(2,TimeUnit.SECONDS));assertEquals(2,queries.get());
    }
    @Test void analysisQueryRejectsRebasedReceiptAndDoesNotRetry()throws Exception{
        var value=ContextAnalysisReceiptTest.cases().get(0).getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var status=value.getAsJsonObject("status").deepCopy();status.addProperty("snapshotHash","a".repeat(64));
        var queries=new java.util.concurrent.atomic.AtomicInteger();server.createContext("/v1/context-analysis/",e->{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,status.toString());});
        assertThrows(ExecutionException.class,()->client.readContextAnalysis(reference).get(2,TimeUnit.SECONDS));assertEquals(1,queries.get());
    }
    private String capabilities(boolean enabled){return "{\"format\":\"WorldContextAnalysisCapabilities\",\"version\":1,\"requestVersion\":2,\"enabled\":"+enabled+",\"maximumCalls\":1,\"automaticRetries\":0,\"canAuthorizePlacement\":false}";}
    @Test void unavailableAndMalformedCapabilitiesCannotSend()throws Exception{
        var reply=new java.util.concurrent.atomic.AtomicReference<>(capabilities(false));server.createContext("/v1/context-analysis/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,reply.get());});
        assertFalse(client.contextAnalysisEnabled().get(2,TimeUnit.SECONDS));
        for(var invalid:new String[]{capabilities(true).replace("\"version\":1","\"version\":\"1\""),capabilities(true).replace("\"enabled\":true","\"enabled\":\"true\""),capabilities(true).replace("\"canAuthorizePlacement\":false","\"canAuthorizePlacement\":true")}){
            reply.set(invalid);assertThrows(ExecutionException.class,()->client.contextAnalysisEnabled().get(2,TimeUnit.SECONDS));
        }
    }
    @Test void explicitAnalysisSendPersistsBeforePostAndRestartOnlyQueries()throws Exception{
        var fixture=ContextTaskReceiptTest.fixture();var capture=ContextTaskReceiptTest.capture(fixture);var example=ContextAnalysisReceiptTest.cases().get(0).getAsJsonObject();
        var prepared=example.getAsJsonObject("prepared");var consent=example.getAsJsonObject("consent");var reference=ContextAnalysisReceipt.reference(prepared);var status=example.getAsJsonObject("status");
        var posts=new java.util.concurrent.atomic.AtomicInteger();var queries=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/v1/context-analysis/capabilities",e->reply(e,capabilities(true)));
        server.createContext("/v1/world-contexts/"+capture.id()+"/record",e->{assertEquals("GET",e.getRequestMethod());reply(e,fixture.getAsJsonObject("saved").toString());});
        server.createContext("/v1/world-contexts/"+capture.id()+"/send-analysis",e->{assertEquals("POST",e.getRequestMethod());
            assertEquals(reference,new ContextAnalysisReferences(dir.resolve("data")).read(reference.get("requestHash").getAsString()));
            var input=com.google.gson.JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            assertTrue(input.get("explicitSend").getAsBoolean());assertEquals(prepared.get("requestHash"),input.get("requestHash"));assertEquals(consent.get("id"),input.get("consentId"));
            assertEquals(prepared.getAsJsonObject("request").get("intent"),input.get("intent"));assertFalse(input.has("snapshot"));posts.incrementAndGet();reply(e,status.toString());});
        server.createContext("/v1/context-analysis/"+reference.get("requestHash").getAsString(),e->{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();reply(e,status.toString());});
        assertEquals(status,client.sendContextAnalysis(()->CompletableFuture.completedFuture(capture),prepared,consent,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());
        client.close();client=new BridgeClient(dir);
        assertEquals(status,client.sendContextAnalysis(()->CompletableFuture.completedFuture(capture),prepared,consent,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());assertEquals(1,queries.get());
        assertEquals(java.util.List.of(reference),client.contextAnalysisHistory().get(2,TimeUnit.SECONDS));
    }
    @Test void closedDuringFinalCheckPreservesReferenceButNeverPosts()throws Exception{
        var fixture=ContextTaskReceiptTest.fixture();var capture=ContextTaskReceiptTest.capture(fixture);var example=ContextAnalysisReceiptTest.cases().get(0).getAsJsonObject();
        var prepared=example.getAsJsonObject("prepared");var consent=example.getAsJsonObject("consent");var reference=ContextAnalysisReceipt.reference(prepared);
        var reads=new java.util.concurrent.atomic.AtomicInteger();var posts=new java.util.concurrent.atomic.AtomicInteger();var live=new java.util.concurrent.atomic.AtomicBoolean(true);
        server.createContext("/v1/context-analysis/capabilities",e->reply(e,capabilities(true)));
        server.createContext("/v1/world-contexts/"+capture.id()+"/record",e->{if(reads.incrementAndGet()==2){slowStarted.countDown();try{releaseSlow.await(5,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}}reply(e,fixture.getAsJsonObject("saved").toString());});
        server.createContext("/v1/world-contexts/"+capture.id()+"/send-analysis",e->{posts.incrementAndGet();reply(e,"{}");});
        var pending=client.sendContextAnalysis(()->CompletableFuture.completedFuture(capture),prepared,consent,live::get);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));live.set(false);releaseSlow.countDown();
        assertThrows(ExecutionException.class,()->pending.get(2,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals(reference,new ContextAnalysisReferences(dir.resolve("data")).read(reference.get("requestHash").getAsString()));
    }
    @Test void observationNeedsAnUnknownOriginalAndNeverSubmitsGeneration()throws Exception{
        var example=ContextAnalysisReceiptTest.cases().get(3).getAsJsonObject();var reference=ContextAnalysisReceipt.reference(example.getAsJsonObject("prepared"));var status=example.getAsJsonObject("status");
        var observed=new java.util.concurrent.atomic.AtomicInteger();server.createContext("/v1/context-analysis/"+reference.get("requestHash").getAsString(),e->{
            if(e.getRequestURI().getPath().endsWith("/observe-original")){assertEquals("POST",e.getRequestMethod());assertEquals("{\"confirmed\":true}",new String(e.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));observed.incrementAndGet();}
            else assertEquals("GET",e.getRequestMethod());reply(e,status.toString());});
        assertEquals(status,client.observeContextAnalysis(reference,()->true).get(3,TimeUnit.SECONDS));assertEquals(1,observed.get());
        assertThrows(CancellationException.class,()->client.observeContextAnalysis(reference,()->false).get(2,TimeUnit.SECONDS));assertEquals(1,observed.get());
    }
    @Test void archiveReadersUseExactReadOnlyRoutesAndBindActualWorkerRecordsWithoutPostOrGeneration()throws Exception{
        var fixtures=ReferencePreparationReceiptTest.fixtures();var f=fixtures.getAsJsonArray("archiveCases").get(0).getAsJsonObject();
        var snapshot=f.getAsJsonObject("snapshot");String owner=snapshot.get("ownerId").getAsString(),action=f.getAsJsonObject("confirmation").get("actionId").getAsString(),hash=snapshot.get("snapshotHash").getAsString();
        String prefix="/v1/reference-drafts/"+owner+"/archive";var reads=new java.util.concurrent.atomic.AtomicInteger();var forbidden=new java.util.concurrent.atomic.AtomicInteger();
        var responses=new java.util.HashMap<String,String>();responses.put("/v1/reference-archives/capabilities",fixtures.get("archiveCapability").toString());
        responses.put("/v1/reference-drafts",fixtures.get("archiveListing").toString());responses.put(prefix,snapshot.toString());responses.put(prefix+"/"+action+"/record",f.get("recordArchived").toString());
        responses.put(prefix+"/"+action+"/restore",f.get("maintenanceSnapshot").toString());
        server.createContext("/v1/reference-",e->{if(!e.getRequestMethod().equals("GET")){forbidden.incrementAndGet();reply(e,"{}");return;}
            assertEquals(0,e.getRequestBody().readAllBytes().length);assertNull(e.getRequestURI().getQuery());reads.incrementAndGet();String r=responses.get(e.getRequestURI().getPath());assertNotNull(r);reply(e,r);});
        server.createContext("/v1/jobs",e->{forbidden.incrementAndGet();reply(e,"{}");});
        assertEquals(fixtures.get("archiveCapability"),client.referenceArchiveCapabilities().get(3,TimeUnit.SECONDS));
        assertEquals(fixtures.get("archiveListing"),client.referenceDraftArchives().get(3,TimeUnit.SECONDS));
        assertEquals(snapshot,client.referenceArchiveSnapshot(owner).get(3,TimeUnit.SECONDS));
        var record=client.referenceArchiveRecord(owner,action,hash).get(3,TimeUnit.SECONDS);assertEquals(f.get("recordArchived"),record);
        assertEquals(f.get("maintenanceSnapshot"),client.referenceArchiveMaintenanceSnapshot(record,"restore").get(3,TimeUnit.SECONDS));assertEquals(5,reads.get());assertEquals(0,forbidden.get());
        for(String invalid:new String[]{"../../world",owner+"?key=other",null})assertThrows(ExecutionException.class,()->client.referenceArchiveSnapshot(invalid).get(2,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.referenceArchiveRecord(owner,"../../action",hash).get(2,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.referenceArchiveRecord(owner,action,"bad-hash").get(2,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.referenceArchiveMaintenanceSnapshot(record,"delete-all").get(2,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.referenceArchiveMaintenanceSnapshot(f.getAsJsonObject("recordFinal"),"restore").get(2,TimeUnit.SECONDS));
        assertEquals(5,reads.get());assertEquals(0,forbidden.get());
    }
    @Test void archiveRecordErrorsCorruptionOversizeAndDuplicateJsonNeverTriggerRetriesOrNewActions()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var s=f.getAsJsonObject("snapshot");String owner=s.get("ownerId").getAsString(),action=f.getAsJsonObject("confirmation").get("actionId").getAsString(),hash=s.get("snapshotHash").getAsString();
        var reply=new java.util.concurrent.atomic.AtomicReference<>(f.get("recordArchived").toString());var count=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/v1/reference-drafts/"+owner+"/archive/"+action+"/record",e->{assertEquals("GET",e.getRequestMethod());count.incrementAndGet();reply(e,reply.get());});
        var bad=f.getAsJsonObject("recordArchived").deepCopy();bad.addProperty("canAuthorizePlacement",true);ReferenceArchiveReceiptTest.rehash(bad,"recordHash");
        for(var text:java.util.List.of(bad.toString(),"{\"format\":\"a\",\"format\":\"b\"}","x".repeat(131073),"{\"error\":\"original record unavailable\"}")){
            reply.set(text);assertThrows(ExecutionException.class,()->client.referenceArchiveRecord(owner,action,hash).get(3,TimeUnit.SECONDS));
        }assertEquals(4,count.get());
    }
    @Test void blockedArchiveQueryDoesNotDelayCancelAndReconnectRejectsItsOriginalLateReply()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var s=f.getAsJsonObject("snapshot");String owner=s.get("ownerId").getAsString(),action=f.getAsJsonObject("confirmation").get("actionId").getAsString(),hash=s.get("snapshotHash").getAsString();
        server.createContext("/v1/reference-drafts/"+owner+"/archive/"+action+"/record",e->{assertEquals("GET",e.getRequestMethod());slowStarted.countDown();try{releaseSlow.await(20,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}reply(e,f.get("recordArchived").toString());});
        var original=client.referenceArchiveRecord(owner,action,hash);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(original.isDone());
        client.reconnect();releaseSlow.countDown();assertThrows(ExecutionException.class,()->original.get(3,TimeUnit.SECONDS));
    }
    private com.google.gson.JsonObject archiveReference(com.google.gson.JsonObject f,boolean maintenance){
        return ReferenceArchiveReceipt.actionReference(maintenance?f.getAsJsonObject("recordFinal").getAsJsonObject("originalIntent"):null,
            f.getAsJsonObject(maintenance?"maintenanceSnapshot":"snapshot"),f.getAsJsonObject(maintenance?"maintenanceConfirmation":"confirmation"));
    }
    private String archiveRoute(com.google.gson.JsonObject r){
        String prefix="/v1/reference-drafts/"+r.get("ownerId").getAsString()+"/archive";
        return r.get("purpose").getAsString().equals("archive")?prefix:prefix+"/"+r.get("archiveActionId").getAsString()+"/"+r.get("purpose").getAsString();
    }
    private void archiveCapability()throws Exception{String capability=ReferencePreparationReceiptTest.fixtures().get("archiveCapability").toString();server.createContext("/v1/reference-archives/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,capability);});}
    private void expectArchivePost(HttpExchange e,com.google.gson.JsonObject r)throws Exception{
        assertEquals("POST",e.getRequestMethod());assertEquals(archiveRoute(r),e.getRequestURI().getPath());assertNull(e.getRequestURI().getQuery());
        assertEquals(r,new ReferenceArchiveActions(dir.resolve("data")).read(r.get("actionId").getAsString()));
        assertEquals(ContextReceipt.canonicalJson(r.getAsJsonObject("confirmation")),new String(e.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
    }
    @Test void archiveFirstPostPublishesExactReferenceBeforeExchangeAndRestartOnlyReads()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=archiveReference(f,false);archiveCapability();
        var posts=new java.util.concurrent.atomic.AtomicInteger();var gets=new java.util.concurrent.atomic.AtomicInteger();var forbidden=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext(archiveRoute(r),e->{try{
            if(e.getRequestMethod().equals("POST")){expectArchivePost(e,r);posts.incrementAndGet();reply(e,f.get("receipt").toString());}
            else{assertEquals("GET",e.getRequestMethod());assertEquals(archiveRoute(r)+"/"+r.get("actionId").getAsString()+"/record",e.getRequestURI().getPath());gets.incrementAndGet();reply(e,f.get("recordArchived").toString());}
        }catch(Exception error){throw new java.io.IOException(error);}});
        server.createContext("/v1/jobs",e->{forbidden.incrementAndGet();reply(e,"{}");});
        assertEquals(f.get("receipt"),client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());
        client.close();client=new BridgeClient(dir);
        assertEquals(f.get("receipt"),client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));
        assertEquals(f.get("receipt"),client.readReferenceArchiveAction(r).get(3,TimeUnit.SECONDS));
        assertEquals(1,posts.get());assertEquals(2,gets.get());assertEquals(0,forbidden.get());assertEquals(java.util.List.of(r),client.referenceArchiveActions().get(2,TimeUnit.SECONDS));
    }
    @Test void rejectedOrMissingArchiveReplyRetainsExactOriginalAndNeverAutomaticallyPostsAgain()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=archiveReference(f,false);archiveCapability();
        var posts=new java.util.concurrent.atomic.AtomicInteger();var gets=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext(archiveRoute(r),e->{try{
            if(e.getRequestMethod().equals("POST")){expectArchivePost(e,r);posts.incrementAndGet();reply(e,"{\"error\":\"original outcome unavailable\"}");}
            else{assertEquals("GET",e.getRequestMethod());gets.incrementAndGet();reply(e,f.get("recordPending").toString());}
        }catch(Exception error){throw new java.io.IOException(error);}});
        assertThrows(ExecutionException.class,()->client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));
        var expected=f.getAsJsonObject("recordPending").get("status");assertEquals(expected,client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));
        client.close();client=new BridgeClient(dir);assertEquals(expected,client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));
        assertEquals(1,posts.get());assertEquals(2,gets.get());assertEquals(java.util.List.of(r),client.referenceArchiveActions().get(2,TimeUnit.SECONDS));
    }
    @Test void finalArchiveScreenCheckAfterPublicationCancelsWithoutPostButKeepsOriginal()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=archiveReference(f,false);archiveCapability();var posts=new java.util.concurrent.atomic.AtomicInteger();
        Path saved=dir.resolve("data/client-state/reference-archive-actions-v1/"+r.get("actionId").getAsString()+".json");
        server.createContext(archiveRoute(r),e->{posts.incrementAndGet();reply(e,f.get("receipt").toString());});
        var pending=client.startReferenceArchiveAction(r,()->!Files.exists(saved));var stopped=assertThrows(Exception.class,()->pending.get(5,TimeUnit.SECONDS));
        assertTrue(stopped instanceof CancellationException||stopped.getCause() instanceof CancellationException);
        assertTrue(Files.exists(saved));assertEquals(r,new ReferenceArchiveActions(dir.resolve("data")).read(r.get("actionId").getAsString()));assertEquals(0,posts.get());
        assertThrows(CancellationException.class,()->client.continueReferenceArchiveAction(r,()->false).get(2,TimeUnit.SECONDS));assertEquals(0,posts.get());
    }
    @Test void explicitMaintenanceContinuationPostsOnlySameRestoreOrPurgeBodyAndIds()throws Exception{
        archiveCapability();var forbidden=new java.util.concurrent.atomic.AtomicInteger();server.createContext("/v1/jobs",e->{forbidden.incrementAndGet();reply(e,"{}");});
        for(var example:ReferenceArchiveReceiptTest.cases()){
            var f=example.getAsJsonObject();var r=archiveReference(f,true);var posts=new java.util.concurrent.atomic.AtomicInteger();var gets=new java.util.concurrent.atomic.AtomicInteger();
            server.createContext(archiveRoute(r),e->{try{
                if(e.getRequestMethod().equals("POST")){expectArchivePost(e,r);posts.incrementAndGet();reply(e,f.get("maintenanceReceipt").toString());}
                else{assertEquals("GET",e.getRequestMethod());assertEquals(archiveRoute(r)+"/"+r.get("actionId").getAsString(),e.getRequestURI().getPath());gets.incrementAndGet();reply(e,f.get("maintenanceReceipt").toString());}
            }catch(Exception error){throw new java.io.IOException(error);}});
            assertEquals(f.get("maintenanceReceipt"),client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));
            assertEquals(f.get("maintenanceReceipt"),client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());assertEquals(1,gets.get());
            assertEquals(f.get("maintenanceReceipt"),client.continueReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(2,posts.get());
            assertEquals(r,new ReferenceArchiveActions(dir.resolve("data")).read(r.get("actionId").getAsString()));
        }assertEquals(0,forbidden.get());
    }
    @Test void foreignLocalArchiveFileBlocksPublicationAndContinuationWithoutFallbackId()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=archiveReference(f,false);archiveCapability();var posts=new java.util.concurrent.atomic.AtomicInteger();
        Path folder=dir.resolve("data/client-state/reference-archive-actions-v1");Files.createDirectories(folder);Path foreign=folder.resolve("unknown.txt");Files.writeString(foreign,"must remain");
        server.createContext(archiveRoute(r),e->{posts.incrementAndGet();reply(e,f.get("receipt").toString());});
        assertThrows(ExecutionException.class,()->client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->client.continueReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(0,posts.get());assertEquals("must remain",Files.readString(foreign));
        try(var files=Files.list(folder)){assertEquals(java.util.List.of(foreign),files.toList());}
    }
    @Test void droppedArchivePostConnectionKeepsOriginalAndOnlyExplicitSameActionCanContinue()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=archiveReference(f,false);archiveCapability();
        var posts=new java.util.concurrent.atomic.AtomicInteger();var gets=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext(archiveRoute(r),e->{try{
            if(e.getRequestMethod().equals("POST")){expectArchivePost(e,r);if(posts.incrementAndGet()==1)e.close();else reply(e,f.get("receipt").toString());}
            else{assertEquals("GET",e.getRequestMethod());assertEquals(archiveRoute(r)+"/"+r.get("actionId").getAsString()+"/record",e.getRequestURI().getPath());gets.incrementAndGet();reply(e,f.get("recordPending").toString());}
        }catch(Exception error){throw new java.io.IOException(error);}});
        assertThrows(ExecutionException.class,()->client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());
        assertEquals(f.getAsJsonObject("recordPending").get("status"),client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,gets.get());assertEquals(1,posts.get());
        assertEquals(f.get("receipt"),client.continueReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(2,posts.get());
        assertEquals(java.util.List.of(r),client.referenceArchiveActions().get(2,TimeUnit.SECONDS));
    }
    @Test void inFlightArchivePostDoesNotDelayCancelAndReconnectRejectsLateReceiptWithoutRepeatingPost()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=archiveReference(f,false);archiveCapability();var posts=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext(archiveRoute(r),e->{try{
            if(e.getRequestMethod().equals("POST")){expectArchivePost(e,r);posts.incrementAndGet();slowStarted.countDown();releaseSlow.await(15,TimeUnit.SECONDS);reply(e,f.get("receipt").toString());}
            else{assertEquals("GET",e.getRequestMethod());reply(e,f.get("recordArchived").toString());}
        }catch(Exception error){throw new java.io.IOException(error);}});
        var original=client.startReferenceArchiveAction(r,()->true);assertTrue(slowStarted.await(5,TimeUnit.SECONDS));
        assertEquals("cancelled",client.request("POST","/v1/jobs/test/cancel",null).get(1,TimeUnit.SECONDS).get("state").getAsString());assertFalse(original.isDone());
        client.reconnect();releaseSlow.countDown();assertThrows(ExecutionException.class,()->original.get(3,TimeUnit.SECONDS));
        assertEquals(f.get("receipt"),client.startReferenceArchiveAction(r,()->true).get(5,TimeUnit.SECONDS));assertEquals(1,posts.get());
        assertEquals(java.util.List.of(r),client.referenceArchiveActions().get(2,TimeUnit.SECONDS));
    }
}
