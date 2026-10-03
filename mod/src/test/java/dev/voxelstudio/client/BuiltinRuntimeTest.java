package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.io.CleanupMode;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

class BuiltinRuntimeTest {
    @TempDir(cleanup=CleanupMode.ON_SUCCESS) Path dir;
    @Test void builtinAloneStartsBridgeAndCompilesFreeSampleWithoutExternalCompanion()throws Exception{
        Assumptions.assumeTrue(System.getProperty("os.name").startsWith("Windows"));assertTrue(BuiltinCompanion.bundled());
        String expectedVersion=null;int ownMetadata=0;
        var metadata=BuiltinRuntimeTest.class.getClassLoader().getResources("fabric.mod.json");
        while(metadata.hasMoreElements())try(var stream=metadata.nextElement().openStream()){
            var value=JsonParser.parseString(new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            if(value.get("id").getAsString().equals("voxel_studio")){ownMetadata++;expectedVersion=value.get("version").getAsString();}
        }
        assertEquals(1,ownMetadata,"Select our mod metadata, not a dependency's same-named resource");
        Path root=dir.resolve("中文 single jar");BridgeClient client=new BridgeClient(root,true);ProcessHandle ownedProcess=null;
        try{
            var health=client.request("GET","/v1/health",null).get(30,TimeUnit.SECONDS);assertEquals(expectedVersion,health.get("version").getAsString());assertTrue(health.getAsJsonArray("capabilities").asList().stream().anyMatch(v->v.getAsString().equals("scene-spec-v1")));assertFalse(Files.exists(root.resolve("bridge/server.mjs")));assertFalse(Files.exists(root.resolve("runtime/node.exe")));
            long ownedPid=JsonParser.parseString(Files.readString(root.resolve("data/connection.json"))).getAsJsonObject().get("pid").getAsLong();ownedProcess=ProcessHandle.of(ownedPid).orElseThrow();
            assertTrue(client.request("GET","/v1/jobs",null).get(5,TimeUnit.SECONDS).getAsJsonArray("jobs").isEmpty());
            var req=new JsonObject();req.addProperty("key","builtin-free-fixture");req.addProperty("sample",true);String id=client.request("POST","/v1/jobs",req).get(5,TimeUnit.SECONDS).get("id").getAsString();
            JsonObject job=null;for(int i=0;i<100;i++){job=client.request("GET","/v1/jobs/"+id,null).get(5,TimeUnit.SECONDS);if(job.get("state").getAsString().equals("preview-ready"))break;if(job.get("state").getAsString().equals("failed"))fail(job.toString());Thread.sleep(50);}
            assertEquals("preview-ready",job.get("state").getAsString());assertEquals(1937,job.getAsJsonObject("manifest").get("setCount").getAsInt());
            var exported=client.request("POST","/v1/jobs/"+id+"/export",new JsonObject()).get(5,TimeUnit.SECONDS);assertTrue(Files.isRegularFile(Path.of(exported.get("file").getAsString())));
        }finally{client.close();if(ownedProcess!=null)ownedProcess.onExit().get(10,TimeUnit.SECONDS);}
        for(int i=0;i<100&&Files.exists(root.resolve("data/connection.json"));i++)Thread.sleep(50);
        assertFalse(Files.exists(root.resolve("data/connection.json")),"Owned Bridge should stop cleanly");
    }
}
