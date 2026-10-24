package dev.voxelstudio.client;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import net.minecraft.SharedConstants;
import net.minecraft.Bootstrap;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual paired HTTP downloads of production Node registered complete tasks.
 * Reference pixels, provider answers and native uploads all synthetic. */
class CoupledReferenceWorldAssemblyCandidateTransportTest {
    @TempDir Path root;HttpServer server;ExecutorService handlers;BridgeClient client;
    JsonObject f;String base,query;final List<String> routes=Collections.synchronizedList(new ArrayList<>());
    final AtomicBoolean live=new AtomicBoolean(true);final AtomicInteger metadataReads=new AtomicInteger();
    int missing=-1,corrupt=-1,cancel=-1;boolean corruptFinal;String contentType="application/json; charset=utf-8";
    @BeforeAll static void boot(){SharedConstants.createGameVersion();Bootstrap.initialize();}
    @BeforeEach void start()throws Exception{
        f=CoupledReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(0);
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);handlers=Executors.newFixedThreadPool(3);server.setExecutor(handlers);
        server.createContext("/v1/health",e->reply(e,200,"{\"protocol\":1}".getBytes(StandardCharsets.UTF_8),"application/json"));server.start();
        Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/connection.json"),"{\"protocol\":1,\"port\":"+server.getAddress().getPort()+",\"token\":\""+"b".repeat(64)+"\",\"pid\":"+ProcessHandle.current().pid()+"}");client=new BridgeClient(root);
    }
    static void reply(HttpExchange e,int status,byte[] bytes,String type)throws java.io.IOException{e.getResponseHeaders().set("Content-Type",type);e.sendResponseHeaders(status,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}}
    void routes(){
        base="/v1/coupled-reference-world-assembly/jobs/"+f.getAsJsonObject("prepared").get("jobId").getAsString();query="candidateHash="+f.getAsJsonObject("status").getAsJsonObject("candidate").get("candidateHash").getAsString();
        server.createContext(base,e->{
            try{
                assertEquals("GET",e.getRequestMethod());assertEquals("Bearer "+"b".repeat(64),e.getRequestHeaders().getFirst("Authorization"));assertNull(e.getRequestHeaders().getFirst("Origin"));assertEquals(0,e.getRequestBody().readAllBytes().length);routes.add("GET "+e.getRequestURI());
                String path=e.getRequestURI().getPath();JsonObject value;
                if(path.equals(base)){assertNull(e.getRequestURI().getRawQuery());value=f.getAsJsonObject("status");}
                else{
                    assertEquals(query,e.getRequestURI().getRawQuery());
                    if(path.equals(base+"/candidate")){value=f.getAsJsonObject("metadata").deepCopy();if(metadataReads.incrementAndGet()==2&&corruptFinal)value.addProperty("candidateHash","f".repeat(64));}
                    else if(path.equals(base+"/native-cells"))value=f.getAsJsonObject("cells");
                    else{
                        assertTrue(path.startsWith(base+"/parts/"));int index=Integer.parseInt(path.substring((base+"/parts/").length()));
                        if(index==missing){reply(e,404,"{}".getBytes(StandardCharsets.UTF_8),"application/json");return;}
                        value=CoupledReferenceWorldAssemblyCandidateReceiptTest.partFixture(f,index);
                        if(index==corrupt)value.getAsJsonArray("files").get(0).getAsJsonObject().addProperty("data","{}");
                        if(index==cancel)live.set(false);
                    }
                }
                reply(e,200,value.toString().getBytes(StandardCharsets.UTF_8),contentType);
            }catch(Throwable error){reply(e,500,"{\"error\":\"synthetic fixture assertion\"}".getBytes(StandardCharsets.UTF_8),"application/json");}
        });
    }
    CompletableFuture<CoupledReferenceWorldAssemblyCandidateReceipt.Whole> read(){return client.readCoupledAssemblyCandidate(CoupledReferenceWorldAssemblyCandidateReceiptTest.reference(f),f.getAsJsonObject("status"),live::get);}
    @AfterEach void close(){client.close();server.stop(0);handlers.shutdownNow();}
    @Test void liteAndUltraCompleteOnlyAfterExactNativeAllPartsFinalFullCheckAndStatus()throws Exception{
        for(int index=0;index<2;index++){
            f=CoupledReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(index);routes();var whole=read().get(60,TimeUnit.SECONDS);
            assertFalse(whole.canAuthorizePlacement());assertFalse(whole.currentWorldVerified());assertTrue(whole.completeSetTransport());assertEquals(f.getAsJsonObject("status").getAsJsonObject("candidate").get("operationCount").getAsInt(),whole.worldInput().binding().totalWrites());
            int parts=f.getAsJsonArray("partFiles").size();assertEquals(parts+4,routes.size());assertEquals(2,metadataReads.get());assertEquals("GET "+base,routes.get(routes.size()-1));
            assertEquals("GET "+base+"/candidate?"+query,routes.get(0));assertEquals("GET "+base+"/native-cells?"+query,routes.get(1));assertEquals("GET "+base+"/candidate?"+query,routes.get(routes.size()-2));
            server.removeContext(base);routes.clear();metadataReads.set(0);
        }
    }
    @Test void absentOrCorruptMiddlePartStopsBeforeFinalAndNeverPostsAReplacement()throws Exception{
        f=CoupledReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(1);missing=1;routes();assertThrows(ExecutionException.class,()->read().get(60,TimeUnit.SECONDS));assertEquals(4,routes.size());assertEquals(1,metadataReads.get());
        server.removeContext(base);routes.clear();metadataReads.set(0);missing=-1;corrupt=1;routes();assertThrows(ExecutionException.class,()->read().get(60,TimeUnit.SECONDS));assertEquals(4,routes.size());assertTrue(routes.stream().allMatch(r->r.startsWith("GET "+base)));
    }
    @Test void lateFullMetadataChangeCannotPromoteAnAlreadyDownloadedWhole()throws Exception{
        corruptFinal=true;routes();assertThrows(ExecutionException.class,()->read().get(60,TimeUnit.SECONDS));assertEquals(2,metadataReads.get());assertEquals(4,routes.size());assertFalse(routes.get(routes.size()-1).equals("GET "+base));
    }
    @Test void cancellationAfterAResponseDoesNotAdoptCompletedPartialData()throws Exception{
        cancel=0;routes();assertThrows(Exception.class,()->read().get(60,TimeUnit.SECONDS));assertEquals(3,routes.size());assertEquals(1,metadataReads.get());
    }
    @Test void nonJsonReadIsRejectedBeforeCellsOrAnyFallback()throws Exception{
        contentType="text/html";routes();assertThrows(ExecutionException.class,()->read().get(60,TimeUnit.SECONDS));assertEquals(1,routes.size());assertTrue(routes.get(0).contains("/coupled-reference-world-assembly/"));
    }
}
