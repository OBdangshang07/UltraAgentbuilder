package dev.voxelstudio.client;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

/** Real paired HTTP and original production whole-set fixture. All pixels,
 * responses/geometry are synthetic; no model dispatch or world API exists. */
class ReferenceWorldAssemblyCandidateTransportTest {
    @TempDir Path root;HttpServer server;ExecutorService handlers;BridgeClient client;JsonObject f,r;
    final List<String> routes=Collections.synchronizedList(new ArrayList<>());final AtomicBoolean live=new AtomicBoolean(true);
    String prefix,query;int failPart=-1;boolean swapFinal,cancelAtFirstPart;
    @BeforeAll static void boot(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void start()throws Exception{
        f=ReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(1);r=ReferenceWorldAssemblyReceiptTest.reference(f);
        prefix="/v1/reference-world-assembly/jobs/"+r.get("id").getAsString();query="candidateHash="+f.getAsJsonObject("status").getAsJsonObject("candidate").get("candidateHash").getAsString();
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(4);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,200,JsonParser.parseString("{\"protocol\":1}").getAsJsonObject()));
        server.createContext(prefix,e->{assertEquals("GET",e.getRequestMethod());assertEquals("Bearer "+"b".repeat(64),e.getRequestHeaders().getFirst("Authorization"));assertNull(e.getRequestHeaders().getFirst("Origin"));assertEquals(0,e.getRequestBody().readAllBytes().length);routes.add(e.getRequestMethod()+" "+e.getRequestURI());
            String route=e.getRequestURI().getPath().substring(prefix.length());
            if(route.equals("/candidate")){assertEquals(query,e.getRequestURI().getQuery());reply(e,200,f.getAsJsonObject("metadata"));}
            else if(route.startsWith("/parts/")){assertEquals(query,e.getRequestURI().getQuery());int index=Integer.parseInt(route.substring(7));if(index==failPart){reply(e,409,JsonParser.parseString("{\"error\":\"synthetic missing original part\"}").getAsJsonObject());return;}
                if(index==0&&cancelAtFirstPart)live.set(false);try{reply(e,200,ReferenceWorldAssemblyCandidateReceiptTest.partFixture(f,index));}catch(Exception error){throw new java.io.IOException(error);}}
            else{assertEquals("",route);assertNull(e.getRequestURI().getQuery());var status=f.getAsJsonObject("status").deepCopy();if(swapFinal)status.getAsJsonObject("candidate").addProperty("candidateHash","f".repeat(64));reply(e,200,status);}
        });server.start();Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    static void reply(HttpExchange e,int status,JsonObject value)throws java.io.IOException{byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");e.sendResponseHeaders(status,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}}
    CompletableFuture<ReferenceWorldAssemblyCandidateReceipt.Whole> read(){return client.readReferenceAssemblyCandidate(r,f.getAsJsonObject("status"),live::get);}
    @Test void wholeUltraUsesOnlyExactOrderedOriginalGetsAndRechecksFinalIdentity()throws Exception{
        var whole=read().get(45,TimeUnit.SECONDS);int count=f.getAsJsonArray("partFiles").size();assertEquals(count,whole.parts().size());var expected=new ArrayList<String>();expected.add("GET "+prefix+"/candidate?"+query);for(int i=0;i<count;i++)expected.add("GET "+prefix+"/parts/"+i+"?"+query);expected.add("GET "+prefix);assertEquals(expected,routes);assertFalse(whole.canAuthorizePlacement());assertTrue(whole.totalWrites()>8192);
    }
    @Test void missingLaterPartStopsWithoutReturningEarlierPartsOrReplayingAnyGet()throws Exception{
        failPart=1;assertThrows(ExecutionException.class,()->read().get(45,TimeUnit.SECONDS));assertEquals(List.of("GET "+prefix+"/candidate?"+query,"GET "+prefix+"/parts/0?"+query,"GET "+prefix+"/parts/1?"+query),routes);
    }
    @Test void normalWholeLoaderBuildsOneTypedCompletePreviewUsingOnlyOriginalGets()throws Exception{
        var candidate=client.loadReferenceAssemblyCandidate(r,f.getAsJsonObject("status"),live::get).get(45,TimeUnit.SECONDS);
        assertFalse(WorldPatchCheckedCandidate.class.isInstance(candidate));assertFalse(candidate.canAuthorizePlacement());assertFalse(candidate.currentWorldVerified());
        assertEquals(54406,candidate.preview().totalWrites());assertEquals(7,candidate.input().parts().size());assertEquals(r.get("requestHash").getAsString(),candidate.input().binding().requestHash());
        var expected=new ArrayList<String>();expected.add("GET "+prefix+"/candidate?"+query);for(int i=0;i<7;i++)expected.add("GET "+prefix+"/parts/"+i+"?"+query);expected.add("GET "+prefix);assertEquals(expected,routes);
    }
    @Test void originalFinalSwapAfterAllPartsRejectsTheEntireDownload()throws Exception{
        swapFinal=true;assertThrows(ExecutionException.class,()->read().get(45,TimeUnit.SECONDS));assertEquals(f.getAsJsonArray("partFiles").size()+2,routes.size());assertEquals("GET "+prefix,routes.get(routes.size()-1));
    }
    @Test void pageCancellationBeforeOrDuringDownloadCannotContinueWithPartialData()throws Exception{
        live.set(false);assertTrue(read().isCompletedExceptionally());assertTrue(routes.isEmpty());live.set(true);cancelAtFirstPart=true;assertThrows(ExecutionException.class,()->read().get(45,TimeUnit.SECONDS));assertEquals(2,routes.size());
    }
    @AfterEach void close(){if(client!=null)client.close();if(server!=null)server.stop(0);if(handlers!=null)handlers.shutdownNow();}
}
