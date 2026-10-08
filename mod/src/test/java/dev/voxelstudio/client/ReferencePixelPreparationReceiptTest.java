package dev.voxelstudio.client;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

/** Production Java pixel lane using paired synthetic HTTP and independently
 * generated Node records. No provider, game, real image or world is opened. */
final class ReferencePixelPreparationReceiptTest {
    @TempDir Path root;
    private HttpServer server;private ExecutorService handlers;private BridgeClient client;
    private ReferenceImageDraft.Snapshot snapshot;private JsonObject manifest;private List<byte[]> images;
    private final AtomicInteger posts=new AtomicInteger(),reads=new AtomicInteger(),manifests=new AtomicInteger();
    private final AtomicBoolean live=new AtomicBoolean(true);
    private static JsonObject capability(){return JsonParser.parseString("{\"format\":\"ReferencePixelPreparationCapabilities\",\"version\":1,\"pixelPreparationImplemented\":true,\"modelDiscovery\":false,\"modelCalls\":0,\"worldWrites\":0,\"generationAuthorityTransferred\":false,\"canAuthorizePlacement\":false,\"limits\":{\"inputBytes\":33619968,\"maximumImages\":4,\"lanes\":1}}").getAsJsonObject();}
    private static JsonObject manifest(JsonObject c){
        var p=c.getAsJsonObject("preparation");var m=new JsonObject();m.addProperty("format","UserReferenceSet");m.addProperty("version",1);m.add("ownerId",p.get("ownerId"));m.add("mode",p.get("referenceMode"));m.add("references",p.get("references").deepCopy());
        long bytes=0,pixels=0;for(var value:m.getAsJsonArray("references")){var r=value.getAsJsonObject();bytes+=r.get("bytes").getAsLong();pixels+=r.get("width").getAsLong()*r.get("height").getAsLong();}
        m.addProperty("pixels",pixels);m.addProperty("bytes",bytes);m.addProperty("metadataRemoved",true);m.addProperty("untrustedData",true);m.addProperty("worldCaptured",false);m.addProperty("canAuthorizePlacement",false);m.add("setHash",p.get("referenceSetHash"));return m;
    }
    @BeforeEach void start()throws Exception{
        var c=ReferencePreparationReceiptTest.fixtures().getAsJsonArray("cases").get(0).getAsJsonObject();snapshot=ReferencePreparationReceiptTest.snapshot(c);manifest=manifest(c);images=new ArrayList<>();
        for(var image:c.getAsJsonObject("upload").getAsJsonArray("references"))images.add(Base64.getDecoder().decode(image.getAsJsonObject().get("png").getAsString()));
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(2);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,200,"{\"protocol\":1}".getBytes(StandardCharsets.UTF_8)));server.start();
        Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    @AfterEach void stop(){client.close();server.stop(0);handlers.shutdownNow();}
    private static void reply(HttpExchange e,int status,byte[] bytes)throws java.io.IOException{e.sendResponseHeaders(status,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}}
    private static void reply(HttpExchange e,JsonObject value)throws java.io.IOException{reply(e,200,value.toString().getBytes(StandardCharsets.UTF_8));}
    private String prefix(){return "/v1/reference-drafts/"+snapshot.ownerId();}
    private void endpoints(java.util.function.Consumer<JsonObject> beforePost,java.util.function.Consumer<JsonObject> reread){
        server.createContext("/v1/reference-pixels/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,capability());});
        server.createContext(prefix()+"/pixels",e->{assertEquals("POST",e.getRequestMethod());assertEquals(ReferencePixelPreparationReceipt.request(snapshot),JsonParser.parseString(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)));posts.incrementAndGet();beforePost.accept(manifest);reply(e,manifest);});
        server.createContext(prefix()+"/sets/",e->{assertEquals("GET",e.getRequestMethod());assertEquals(0,e.getRequestBody().readAllBytes().length);String route=e.getRequestURI().getPath();
            if(!route.contains("/images/")){manifests.incrementAndGet();var m=manifest.deepCopy();reread.accept(m);reply(e,m);return;}
            reads.incrementAndGet();var records=manifest.getAsJsonArray("references");for(int i=0;i<records.size();i++)if(route.endsWith(records.get(i).getAsJsonObject().get("id").getAsString())){reply(e,200,images.get(i));return;}
            reply(e,404,new byte[]{1});
        });
    }
    @Test void pureRequestAndOriginalManifestsAcrossAllTenOrdinaryFixturesCarryNoTaskAuthority()throws Exception{
        for(var value:ReferencePreparationReceiptTest.fixtures().getAsJsonArray("cases")){var c=value.getAsJsonObject();var s=ReferencePreparationReceiptTest.snapshot(c);var m=manifest(c);
            assertEquals(m,ReferencePixelPreparationReceipt.verify(s,m));var request=ReferencePixelPreparationReceipt.request(s);assertEquals(Set.of("format","version","upload"),request.keySet());assertEquals(s.upload(),request.get("upload"));
            assertEquals(c.getAsJsonObject("upload").get("mode"),request.getAsJsonObject("upload").get("mode"));
            for(int n=0;n<s.photos().size();n++){var original=c.getAsJsonObject("upload").getAsJsonArray("references").get(n).getAsJsonObject();var sent=request.getAsJsonObject("upload").getAsJsonArray("references").get(n).getAsJsonObject();
                assertEquals(original.get("annotation"),sent.get("annotation"));assertNotNull(ReferencePreparationReceipt.pixels(s.photos().get(n),m.getAsJsonArray("references").get(n).getAsJsonObject(),Base64.getDecoder().decode(original.get("png").getAsString())));
            }
        }
    }
    @Test void actualProductionBridgeVerifiesManifestEveryOriginalImageAndFinalRereadWithoutOrdinaryPreparation()throws Exception{
        endpoints(m->{},m->{});var prepared=client.prepareReferencePixels(snapshot,live::get).get(10,TimeUnit.SECONDS);
        assertEquals(manifest,prepared.manifest());assertEquals(snapshot.photos().size(),prepared.images().size());assertEquals(1,posts.get());assertEquals(snapshot.photos().size(),reads.get());assertEquals(1,manifests.get());
        var changed=prepared.manifest();changed.addProperty("worldCaptured",true);assertFalse(prepared.manifest().get("worldCaptured").getAsBoolean());try(var files=Files.list(root.resolve("data"))){assertEquals(List.of("connection.json"),files.map(p->p.getFileName().toString()).sorted().toList());}
    }
    @Test void capabilityClaimsCannotGrantDiscoveryCallsWritesOrConfirmationTransfer(){
        ReferencePixelPreparationReceipt.capabilities(capability());
        for(String field:List.of("modelDiscovery","generationAuthorityTransferred","canAuthorizePlacement")){var c=capability();c.addProperty(field,true);assertThrows(RuntimeException.class,()->ReferencePixelPreparationReceipt.capabilities(c));}
        for(String field:List.of("modelCalls","worldWrites")){var c=capability();c.addProperty(field,1);assertThrows(RuntimeException.class,()->ReferencePixelPreparationReceipt.capabilities(c));}
    }
    @Test void rehashedOwnerModeAnnotationTotalsAndAuthorityClaimsCannotReplaceLocalEdits(){
        for(String field:List.of("ownerId","mode","annotation","pixels","bytes","worldCaptured","extra")){var m=manifest.deepCopy();switch(field){
            case "ownerId"->m.addProperty(field,UUID.randomUUID().toString());case "mode"->m.addProperty(field,"inspire");case "annotation"->{var r=m.getAsJsonArray("references").get(0).getAsJsonObject();r.getAsJsonObject("annotation").addProperty("caption","changed");ReferencePreparationReceiptTest.rehash(r,"id");}
            case "worldCaptured"->m.addProperty(field,true);case "extra"->m.addProperty("generationSubmitted",false);default->m.addProperty(field,1.5);
        }ReferencePreparationReceiptTest.rehash(m,"setHash");assertThrows(RuntimeException.class,()->ReferencePixelPreparationReceipt.verify(snapshot,m),field);}
    }
    @Test void changedFinalManifestDoesNotReturnPixelsOrResend(){
        endpoints(m->{},m->{m.addProperty("worldCaptured",true);ReferencePreparationReceiptTest.rehash(m,"setHash");});
        assertThrows(ExecutionException.class,()->client.prepareReferencePixels(snapshot,live::get).get(10,TimeUnit.SECONDS));assertEquals(1,posts.get());assertEquals(snapshot.photos().size(),reads.get());
    }
    @Test void cancelledBeforePostDoesNotPublishOrDiscover(){
        endpoints(m->{},m->{});live.set(false);var error=assertThrows(ExecutionException.class,()->client.prepareReferencePixels(snapshot,live::get).get(10,TimeUnit.SECONDS));assertInstanceOf(CancellationException.class,error.getCause());assertEquals(0,posts.get());assertEquals(0,reads.get());
    }
    @Test void changedSourceAfterPostStopsBeforeImageReadsAndKeepsOneOriginalPost(){
        endpoints(m->live.set(false),m->{});var error=assertThrows(ExecutionException.class,()->client.prepareReferencePixels(snapshot,live::get).get(10,TimeUnit.SECONDS));assertInstanceOf(CancellationException.class,error.getCause());assertEquals(1,posts.get());assertEquals(0,reads.get());
    }
    @Test void rehashedDifferentPixelsAreRejectedNotAcceptedFromManifestAssertions(){
        endpoints(m->{try{var different=ReferenceImageDraftTest.png(snapshot.photos().get(0).output().width(),snapshot.photos().get(0).output().height());images.set(0,different);var r=m.getAsJsonArray("references").get(0).getAsJsonObject();long old=r.get("bytes").getAsLong();r.addProperty("sha256",ContextReceipt.sha256(different));r.addProperty("bytes",different.length);ReferencePreparationReceiptTest.rehash(r,"id");m.addProperty("bytes",m.get("bytes").getAsLong()-old+different.length);ReferencePreparationReceiptTest.rehash(m,"setHash");}catch(Exception e){throw new RuntimeException(e);}},m->{});
        assertThrows(ExecutionException.class,()->client.prepareReferencePixels(snapshot,live::get).get(10,TimeUnit.SECONDS));assertEquals(1,posts.get());assertEquals(1,reads.get());assertEquals(0,manifests.get());
    }
    @Test void fatalUtf8AndDuplicateJsonRepliesCannotBePromotedToASet(){
        for(byte[] invalid:List.of(new byte[]{(byte)0xff},"{\"format\":\"one\",\"format\":\"two\"}".getBytes(StandardCharsets.UTF_8))){
            server.createContext("/v1/reference-pixels/capabilities",e->reply(e,200,invalid));assertThrows(ExecutionException.class,()->client.prepareReferencePixels(snapshot,live::get).get(10,TimeUnit.SECONDS));server.removeContext("/v1/reference-pixels/capabilities");
        }assertEquals(0,posts.get());
    }
    @Test void modelAdvertisementSupportsExactStringOrObjectEffortsButRejectsUnsupportedOrDuplicateModels(){
        var selected=JsonParser.parseString("{\"agent\":\"codex\",\"model\":\"gpt-6.1-sol\",\"effort\":\"max\"}").getAsJsonObject();
        for(String efforts:List.of("[\"high\",\"max\"]","[{\"reasoningEffort\":\"high\"},{\"reasoningEffort\":\"max\"}]")){
            var models=JsonParser.parseString("{\"models\":[{\"id\":\"gpt-6.1-sol\",\"supportsImages\":true,\"efforts\":"+efforts+"}]}").getAsJsonObject();
            assertEquals("max",ReferenceWorldPatchTaskReceipt.advertisedCapability(selected,models,"a".repeat(64)).get("effort").getAsString());
            var duplicate=models.deepCopy();duplicate.getAsJsonArray("models").add(duplicate.getAsJsonArray("models").get(0).deepCopy());assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.advertisedCapability(selected,duplicate,"a".repeat(64)));
            var missing=models.deepCopy();missing.getAsJsonArray("models").get(0).getAsJsonObject().remove("efforts");assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.advertisedCapability(selected,missing,"a".repeat(64)));
            var other=models.deepCopy();other.getAsJsonArray("models").get(0).getAsJsonObject().add("efforts",JsonParser.parseString("[\"high\"]"));assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.advertisedCapability(selected,other,"a".repeat(64)));
            models.getAsJsonArray("models").get(0).getAsJsonObject().addProperty("supportsImages",false);assertThrows(RuntimeException.class,()->ReferenceWorldPatchTaskReceipt.advertisedCapability(selected,models,"a".repeat(64)));
        }
    }
    @Test void actualJointModelDiscoveryRetainsIndependentRuntimeAndSelectedImageEffortWithoutAPost()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var selected=f.getAsJsonObject("frozen").getAsJsonObject("recipient");var queries=new AtomicInteger();
        server.createContext("/v1/reference-world-patch/capabilities",e->{assertEquals("GET",e.getRequestMethod());reply(e,f.getAsJsonObject("capabilities"));});
        server.createContext("/v1/agents/codex/models",e->{assertEquals("GET",e.getRequestMethod());queries.incrementAndGet();var model=new JsonObject();model.add("id",selected.get("model"));model.addProperty("supportsImages",true);model.add("efforts",JsonParser.parseString("[{\"reasoningEffort\":\"high\"},{\"reasoningEffort\":\"max\"}]"));var models=new JsonArray();models.add(model);var r=new JsonObject();r.add("models",models);reply(e,r);});
        assertEquals(f.get("capability"),client.referencePatchModel(selected).get(10,TimeUnit.SECONDS));assertEquals(1,queries.get());assertEquals(0,posts.get());
    }
    @Test void disabledJointProtocolNeverDiscoversAReplacementModel()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var cap=f.getAsJsonObject("capabilities").deepCopy();cap.addProperty("preparationEnabled",false);cap.addProperty("sendingEnabled",false);cap.add("runtimeHash",JsonNull.INSTANCE);var queries=new AtomicInteger();
        server.createContext("/v1/reference-world-patch/capabilities",e->reply(e,cap));server.createContext("/v1/agents/codex/models",e->{queries.incrementAndGet();reply(e,new JsonObject());});
        assertThrows(ExecutionException.class,()->client.referencePatchModel(f.getAsJsonObject("frozen").getAsJsonObject("recipient")).get(10,TimeUnit.SECONDS));assertEquals(0,queries.get());assertEquals(0,posts.get());
    }
}
