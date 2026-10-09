package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.io.CleanupMode;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.nio.file.*;
import java.util.List;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

class BuiltinRuntimeTest {
    @TempDir(cleanup=CleanupMode.ON_SUCCESS) Path dir;
    @ParameterizedTest @ValueSource(booleans={false,true})
    void builtinAloneStartsBridgeAndCompilesFreeSampleWithoutExternalCompanion(boolean longInstance)throws Exception{
        Assumptions.assumeTrue(System.getProperty("os.name").startsWith("Windows"));assertTrue(BuiltinCompanion.bundled());
        String expectedVersion=null;int ownMetadata=0;
        var metadata=BuiltinRuntimeTest.class.getClassLoader().getResources("fabric.mod.json");
        while(metadata.hasMoreElements())try(var stream=metadata.nextElement().openStream()){
            var value=JsonParser.parseString(new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            if(value.get("id").getAsString().equals("voxel_studio")){ownMetadata++;expectedVersion=value.get("version").getAsString();}
        }
        assertEquals(1,ownMetadata,"Select our mod metadata, not a dependency's same-named resource");
        Path parent=dir;
        if(longInstance)while(parent.toAbsolutePath().toString().length()<230)parent=Files.createDirectory(parent.resolve("long-instance-path"));
        Path root=parent.resolve("中文 single jar");BridgeClient client=new BridgeClient(root,true);ProcessHandle ownedProcess=null;
        try{
            var health=client.request("GET","/v1/health",null).get(30,TimeUnit.SECONDS);assertEquals(expectedVersion,health.get("version").getAsString());assertTrue(health.getAsJsonArray("capabilities").asList().stream().anyMatch(v->v.getAsString().equals("scene-spec-v1")));assertFalse(Files.exists(root.resolve("bridge/server.mjs")));assertFalse(Files.exists(root.resolve("runtime/node.exe")));
            try(var stream=BuiltinRuntimeTest.class.getResourceAsStream("/voxelstudio-bundle/manifest.json")){
                assertNotNull(stream);String expectedHash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(stream.readAllBytes()));
                assertEquals(expectedHash,health.get("builtinBundleHash").getAsString(),"Actual packaged startup must bind the original manifest even with long-path cache");
            }
            assertEquals(root.toAbsolutePath().normalize().resolve("data"),client.dataDirectory());
            long ownedPid=JsonParser.parseString(Files.readString(root.resolve("data/connection.json"))).getAsJsonObject().get("pid").getAsLong();ownedProcess=ProcessHandle.of(ownedPid).orElseThrow();
            // Actual Java extraction and ordinary packaged CLI, not an
            // imported server with test-only opt-ins or provider adapters.
            var joint=client.request("GET","/v1/reference-world-assembly/capabilities",null).get(10,TimeUnit.SECONDS);
            assertEquals("ReferenceWorldAssemblyCapabilities",joint.get("format").getAsString());
            assertEquals(2,joint.get("version").getAsInt());
            assertTrue(joint.get("preparationEnabled").getAsBoolean());assertTrue(joint.get("sendingEnabled").getAsBoolean());
            assertTrue(joint.get("runtimeHash").getAsString().matches("[a-f0-9]{64}"));
            assertTrue(joint.get("independentJointConfirmationRequired").getAsBoolean());
            for(String key:List.of("nativeRendererReady","legacyConsentTransferable","serverBaselineVerified","canAuthorizePlacement"))assertFalse(joint.get(key).getAsBoolean(),key);
            assertEquals(0,joint.get("automaticRetries").getAsInt());
            assertFalse(client.request("GET","/v1/reference-world-patch/capabilities",null).get(5,TimeUnit.SECONDS).get("sendingEnabled").getAsBoolean());
            var history=client.request("GET","/v1/reference-world-assembly/jobs",null).get(10,TimeUnit.SECONDS);
            assertTrue(history.getAsJsonArray("jobs").isEmpty());assertFalse(history.get("allowsNewModelCall").getAsBoolean());assertFalse(history.get("canAuthorizePlacement").getAsBoolean());
            if(longInstance){
                assertFalse(Files.exists(root.resolve("bundles")),"Long-path startup must not publish an unlaunchable runtime in the instance");
                Path cache=Path.of(System.getenv("LOCALAPPDATA")).resolve("UltraAgentbuilder/builtin-companion");
                assertTrue(client.localDiagnostics().get(5,TimeUnit.SECONDS).contains("运行目录："+cache.toAbsolutePath().normalize()));
            }
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
