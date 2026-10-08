package dev.voxelstudio.client;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import dev.voxelstudio.*;
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

/** Real paired loopback HTTP and Asset import. All geometry, statuses and
 * image strings are synthetic; no game rendering, model or world writes. */
class NativeEvidenceTransportTest {
    @TempDir Path root;
    static final String JOB="01234567-89ab-cdef-0123-456789abcdef",ORIGINAL="a".repeat(64);
    HttpServer server;ExecutorService handlers;BridgeClient client;
    JsonObject manifest,request,status,upload,receipt;
    final byte[] cells={2,0};
    final List<String> routes=Collections.synchronizedList(new ArrayList<>());
    @BeforeAll static void bootstrap(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void setup()throws Exception{
        manifest=JsonParser.parseString("{\"id\":\"synthetic-native\",\"schemaVersion\":1,\"minecraft\":\"1.20.1\",\"dimensions\":{\"width\":1,\"height\":1,\"length\":1},\"palette\":[\"@keep\",\"minecraft:air\",\"minecraft:stone\"],\"setCount\":1,\"clearCount\":0,\"diagnosticOnly\":true}").getAsJsonObject();
        manifest.addProperty("cellsHash",Asset.sha(cells));var scene=new JsonObject();scene.addProperty("sourceHash","c".repeat(64));manifest.add("scene",scene);bind(manifest,"assetHash");
        request=new JsonObject();request.addProperty("format","NativeEvidenceRequest");request.addProperty("version",1);request.addProperty("renderer",NativeEvidenceRequest.RENDERER);
        for(var k:List.of("assetHash","cellsHash"))request.add(k,manifest.get(k));request.addProperty("sourceHash","c".repeat(64));request.add("dimensions",manifest.get("dimensions").deepCopy());request.addProperty("canAuthorizePlacement",false);
        var views=new JsonArray();for(int i=0;i<4;i++)views.add(JsonParser.parseString("{\"id\":\"view-"+i+"\",\"purpose\":\"exterior\",\"yaw\":-35,\"pitch\":25,\"min\":[0,0,0],\"max\":[1,1,1],\"width\":512,\"height\":512}"));request.add("views",views);bind(request,"requestHash");
        status=new JsonObject();status.addProperty("format","ReferenceWorldAssemblyRunnerStatus");status.addProperty("version",2);status.addProperty("purpose","reference-world-assembly");status.addProperty("id",JOB);status.addProperty("state","running");
        status.addProperty("stageEventsObserved",2);status.addProperty("reservedCalls",1);status.addProperty("maximumCalls",26);status.addProperty("tier","ultra");status.addProperty("preparationHash","d".repeat(64));status.addProperty("requestHash",ORIGINAL);status.add("candidate",JsonNull.INSTANCE);
        var evidence=new JsonObject();evidence.addProperty("id",request.get("requestHash").getAsString());evidence.addProperty("state","waiting");status.add("nativeEvidence",evidence);status.addProperty("originalLiveExecutionOnly",true);status.addProperty("automaticRetries",0);
        for(var k:List.of("providerReceiptsIndependentlyAudited","serverBaselineVerified","allowsNewModelCall","canAuthorizePlacement"))status.addProperty(k,false);status.addProperty("worldWrites",0);
        upload=new JsonObject();upload.add("requestHash",request.get("requestHash"));upload.addProperty("renderer",NativeEvidenceRequest.RENDERER);upload.add("views",new JsonArray());
        receipt=new JsonObject();receipt.addProperty("accepted",true);receipt.add("requestHash",request.get("requestHash"));receipt.addProperty("evidenceHash","e".repeat(64));receipt.addProperty("worldCaptured",false);receipt.addProperty("canAuthorizePlacement",false);
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(4);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,200,bytes("{\"protocol\":1}"),"application/json"));server.start();
        Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
    static void bind(JsonObject o,String field)throws Exception{o.remove(field);o.addProperty(field,Asset.sha(Asset.canonical(o).getBytes(StandardCharsets.UTF_8)));}
    NativeEvidenceTarget target(){return NativeEvidenceTarget.assembly(JOB,ORIGINAL,status);}
    void endpoint(String route,java.util.function.Function<HttpExchange,byte[]> response,String contentType){server.createContext(route,e->{
        assertEquals("Bearer "+"b".repeat(64),e.getRequestHeaders().getFirst("Authorization"));routes.add(e.getRequestMethod()+" "+e.getRequestURI());
        assertEquals(route,e.getRequestURI().getPath());assertNull(e.getRequestURI().getQuery());reply(e,200,response.apply(e),contentType);
    });}
    void reads(NativeEvidenceTarget t){
        endpoint(t.memberRoute("request"),e->bytes(request.toString()),"application/json; charset=utf-8");
        endpoint(t.memberRoute("manifest"),e->bytes(manifest.toString()),"application/json");
        endpoint(t.memberRoute("cells"),e->cells,"application/octet-stream");
    }
    static void reply(HttpExchange e,int code,byte[] b,String type)throws java.io.IOException{e.getResponseHeaders().set("Content-Type",type);e.sendResponseHeaders(code,b.length);try(var out=e.getResponseBody()){out.write(b);}}
    @AfterEach void close(){client.close();server.stop(0);handlers.shutdownNow();}
    @Test void idOnlyFullStatusDownloadsExactRequestManifestAndCellsWithoutLegacyAlias()throws Exception{
        var t=target();reads(t);assertFalse(status.getAsJsonObject("nativeEvidence").has("request"));
        var r=client.readEvidenceRequest(t).get(5,TimeUnit.SECONDS);var asset=client.loadEvidence(t,r).get(5,TimeUnit.SECONDS);
        assertEquals(request.get("requestHash").getAsString(),r.hash());assertEquals(manifest.get("assetHash").getAsString(),asset.hash);assertTrue(asset.diagnosticOnly);assertThrows(IllegalStateException.class,asset::requireBuildable);
        assertEquals(List.of("GET "+t.memberRoute("request"),"GET "+t.memberRoute("manifest"),"GET "+t.memberRoute("cells")),routes);
    }
    @Test void oldNativeTransportRetainsItsOwnNamespaceAndThreeFieldReceipt()throws Exception{
        var t=NativeEvidenceTarget.legacy(JOB,request.get("requestHash").getAsString());reads(t);
        var legacy=new JsonObject();legacy.addProperty("id",JOB);legacy.addProperty("state","running");legacy.add("nativeEvidence",status.get("nativeEvidence"));
        legacy.addProperty("syntheticHistory","x".repeat(32768)); // Legacy job histories are not the small v2 status contract.
        endpoint(t.jobRoute(),e->bytes(legacy.toString()),"application/json");var old=receipt.deepCopy();old.remove("worldCaptured");old.remove("canAuthorizePlacement");endpoint(t.memberRoute("upload"),e->bytes(old.toString()),"application/json");
        assertTrue(client.loadEvidence(JOB,NativeEvidenceRequest.parse(request)).get(5,TimeUnit.SECONDS).diagnosticOnly);
        assertEquals(old,client.uploadEvidence(t,upload).get(5,TimeUnit.SECONDS));assertTrue(routes.stream().allMatch(r->r.contains("/v1/jobs/")));
    }
    @Test void changedOriginalJobRequestOrPermissionCannotBecomeNativeTarget(){
        for(var key:List.of("id","requestHash","canAuthorizePlacement","allowsNewModelCall","serverBaselineVerified","worldWrites","version","maximumCalls","originalLiveExecutionOnly")){
            var changed=status.deepCopy();switch(key){case "id"->changed.addProperty(key,"fedcba98-7654-3210-fedc-ba9876543210");case "requestHash"->changed.addProperty(key,"f".repeat(64));case "version","worldWrites","maximumCalls"->changed.addProperty(key,99);case "originalLiveExecutionOnly"->changed.addProperty(key,false);default->changed.addProperty(key,true);}
            assertThrows(IllegalStateException.class,()->NativeEvidenceTarget.assembly(JOB,ORIGINAL,changed),key);
        }assertThrows(IllegalArgumentException.class,()->NativeEvidenceTarget.legacy("-".repeat(36),"a".repeat(64)));
        assertThrows(IllegalArgumentException.class,()->target().memberRoute("../../send"));assertEquals(List.of(),routes);
    }
    @Test void completeOrRetainedUnknownDoesNotRenderOrAdoptAndLegacyCannotAliasFull(){
        var t=target();var done=status.deepCopy();done.getAsJsonObject("nativeEvidence").addProperty("state","complete");done.getAsJsonObject("nativeEvidence").addProperty("evidenceHash","e".repeat(64));assertNull(NativeEvidenceTarget.assembly(JOB,ORIGINAL,done));assertFalse(t.stillWaiting(done));
        var history=status.deepCopy();history.addProperty("format","ReferenceWorldAssemblyRetainedJob");history.addProperty("state","unknown-needs-original-inspection");history.addProperty("originalLiveExecutionOnly",false);history.addProperty("originalHistoryOnly",true);history.addProperty("reservationInspectionOnly",true);history.addProperty("canResume",false);
        assertFalse(t.stillWaiting(history));assertThrows(IllegalStateException.class,()->NativeEvidenceTarget.legacy(JOB,t.evidenceId()).stillWaiting(status));
    }
    @Test void acceptedRunnerBeforeFirstReportedCallIsIdleNotARejectedTaskOrRenderPermission(){
        var initial=status.deepCopy();initial.add("nativeEvidence",JsonNull.INSTANCE);initial.add("reservedCalls",JsonNull.INSTANCE);initial.addProperty("stageEventsObserved",0);
        assertNull(NativeEvidenceTarget.assembly(JOB,ORIGINAL,initial));assertFalse(target().stillWaiting(initial));
        initial.add("nativeEvidence",status.get("nativeEvidence"));assertThrows(IllegalStateException.class,()->NativeEvidenceTarget.assembly(JOB,ORIGINAL,initial));assertEquals(List.of(),routes);
    }
    @Test void originalStatusCheckedBeforeUploadAndChangedPinStopsWithoutPost()throws Exception{
        var t=target();endpoint(t.jobRoute(),e->bytes(status.toString()),"application/json");endpoint(t.memberRoute("upload"),e->bytes(receipt.toString()),"application/json");
        assertEquals(receipt,client.uploadEvidence(t,upload).get(5,TimeUnit.SECONDS));assertEquals(List.of("GET "+t.jobRoute(),"POST "+t.memberRoute("upload")),routes);
        status.addProperty("requestHash","f".repeat(64));assertThrows(ExecutionException.class,()->client.uploadEvidence(t,upload).get(5,TimeUnit.SECONDS));assertEquals(3,routes.size());
    }
    @Test void lostUploadAckThenOriginalProgressMakesNextAttemptGetOnly()throws Exception{
        var t=target();endpoint(t.jobRoute(),e->bytes(status.toString()),"application/json");
        server.createContext(t.memberRoute("upload"),e->{routes.add("POST "+e.getRequestURI());e.getRequestBody().readAllBytes();status.getAsJsonObject("nativeEvidence").addProperty("state","complete");status.getAsJsonObject("nativeEvidence").addProperty("evidenceHash","e".repeat(64));e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(200,100);try(var out=e.getResponseBody()){out.write('{');}});
        assertThrows(ExecutionException.class,()->client.uploadEvidence(t,upload).get(5,TimeUnit.SECONDS));assertNull(client.uploadEvidence(t,upload).get(5,TimeUnit.SECONDS));
        assertEquals(List.of("GET "+t.jobRoute(),"POST "+t.memberRoute("upload"),"GET "+t.jobRoute()),routes);
    }
    @Test void staleRequestHashAndDuplicateOrInvalidUtf8NeverLoadAssetOrFallback()throws Exception{
        var t=target();var raw=new AtomicReference<>(bytes(request.toString()));endpoint(t.memberRoute("request"),e->raw.get(),"application/json");
        var stale=request.deepCopy();stale.addProperty("sourceHash","f".repeat(64));
        for(var bytes:List.of(bytes(stale.toString()),new byte[]{(byte)255},bytes("{\"version\":1,"+request.toString().substring(1)),new byte[1048577])){
            raw.set(bytes);assertThrows(ExecutionException.class,()->client.readEvidenceRequest(t).get(5,TimeUnit.SECONDS));
        }assertEquals(4,routes.size());assertTrue(routes.stream().allMatch(r->r.equals("GET "+t.memberRoute("request"))));
    }
    @Test void missingOriginalNativeRequestIsNotAReasonToReadLegacyOrCreateJob()throws Exception{
        var t=target();server.createContext(t.memberRoute("request"),e->{routes.add("GET "+e.getRequestURI());reply(e,404,bytes("{}"),"application/json");});
        assertThrows(ExecutionException.class,()->client.readEvidenceRequest(t).get(5,TimeUnit.SECONDS));assertEquals(List.of("GET "+t.memberRoute("request")),routes);
    }
    @Test void substitutedManifestOrCellsCannotCreateBuildableOrDiagnosticReplacement()throws Exception{
        var t=target();reads(t);var r=client.readEvidenceRequest(t).get(5,TimeUnit.SECONDS);
        manifest.addProperty("assetHash","f".repeat(64));assertThrows(ExecutionException.class,()->client.loadEvidence(t,r).get(5,TimeUnit.SECONDS));assertEquals(2,routes.size());
        manifest.addProperty("assetHash",r.assetHash());cells[0]=1;assertThrows(ExecutionException.class,()->client.loadEvidence(t,r).get(5,TimeUnit.SECONDS));assertEquals(4,routes.size());
    }
    @Test void receiptCannotAuthorizeWorldOrChangeRequestAndWrongUploadNeverUsesNetwork()throws Exception{
        var t=target();for(var k:List.of("worldCaptured","canAuthorizePlacement","requestHash","accepted")){
            var bad=receipt.deepCopy();if(k.equals("requestHash"))bad.addProperty(k,"f".repeat(64));else bad.addProperty(k,!k.equals("accepted"));assertThrows(IllegalStateException.class,()->t.verifyUploadReceipt(bad));
        }
        upload.addProperty("requestHash","f".repeat(64));assertThrows(ExecutionException.class,()->client.uploadEvidence(t,upload).get(5,TimeUnit.SECONDS));assertEquals(List.of(),routes);
    }
}
