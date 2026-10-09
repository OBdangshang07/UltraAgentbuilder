package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class BuiltinCompanionTest {
    @TempDir Path dir;
    Map<String,byte[]> files(){return new LinkedHashMap<>(Map.of("runtime/node.exe","fixture-node".getBytes(),"bridge/server.mjs","fixture-server".getBytes(),"package.json","{}".getBytes(),".agents/skills/voxel-studio/SKILL.md","fixture-skill".getBytes()));}
    byte[] manifest(Map<String,byte[]> files,String version)throws Exception{
        var m=new JsonObject();m.addProperty("schemaVersion",1);m.addProperty("version",version);m.addProperty("platform","windows-x64");var entries=new JsonArray();
        for(var f:files.entrySet()){var e=new JsonObject();e.addProperty("path",f.getKey());e.addProperty("bytes",f.getValue().length);e.addProperty("sha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(f.getValue())));entries.add(e);}m.add("files",entries);return m.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }
    BuiltinCompanion.Runtime install(Path root,Map<String,byte[]> f,String version)throws Exception{return BuiltinCompanion.install(root,manifest(f,version),name->new ByteArrayInputStream(f.get(name)),s->{});}
    @Test void cleanInstallIsReusableAndKeepsPrivateAndLegacyFiles()throws Exception{
        Path root=dir.resolve("中文 instance");Files.createDirectory(root);Files.createDirectories(root.resolve("data"));Files.writeString(root.resolve("data/private.json"),"preserved");Files.writeString(root.resolve("legacy.txt"),"legacy");var f=files();
        var first=install(root,f,"0.1.4-alpha");var again=BuiltinCompanion.install(root,manifest(f,"0.1.4-alpha"),name->{throw new AssertionError("Reuse must not extract again");},s->{});
        assertEquals(first,again);assertTrue(Files.exists(first.directory().resolve(".agents/skills/voxel-studio/SKILL.md")));assertEquals("preserved",Files.readString(root.resolve("data/private.json")));assertEquals("legacy",Files.readString(root.resolve("legacy.txt")));
    }
    @Test void newVersionCoexistsWithOldRuntime()throws Exception{var f=files();var a=install(dir,f,"0.1.3-alpha");var b=install(dir,f,"0.1.4-alpha");assertNotEquals(a.directory(),b.directory());assertTrue(Files.exists(a.directory().resolve("runtime/node.exe")));}
    @Test void exactManifestIdentitySurvivesReuseAndSameVersionDifferentBundlesCoexist()throws Exception{
        var f=files();var original=install(dir,f,"0.1.4-alpha");
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(manifest(f,"0.1.4-alpha"))),original.manifestHash());
        assertEquals(original,install(dir,f,"0.1.4-alpha"));
        var changed=new LinkedHashMap<>(f);changed.put("bridge/server.mjs","different-synthetic-server".getBytes());var other=install(dir,changed,"0.1.4-alpha");
        assertEquals(original.version(),other.version());assertNotEquals(original.manifestHash(),other.manifestHash());assertNotEquals(original.directory(),other.directory());
        assertArrayEquals(f.get("bridge/server.mjs"),Files.readAllBytes(original.directory().resolve("bridge/server.mjs")));
    }
    @Test void corruptExistingRuntimeFailsWithoutOverwriting()throws Exception{var f=files();var a=install(dir,f,"0.1.4-alpha");Files.writeString(a.directory().resolve("bridge/server.mjs"),"modified");assertThrows(IOException.class,()->install(dir,f,"0.1.4-alpha"));assertEquals("modified",Files.readString(a.directory().resolve("bridge/server.mjs")));}
    @Test void corruptArchiveNeverPublishesRunnableTarget()throws Exception{var f=files();assertThrows(IOException.class,()->BuiltinCompanion.install(dir,manifest(f,"0.1.4-alpha"),name->new ByteArrayInputStream("incorrect".getBytes()),s->{}));try(var paths=Files.list(dir.resolve("bundles"))){assertFalse(paths.anyMatch(p->Files.isDirectory(p)&&p.getFileName().toString().startsWith("0.1.4")));}}
    @Test void unsafePathsAndDuplicateCaseAreRejectedBeforeWriting()throws Exception{
        for(String bad:List.of("bridge/../../escaped","/absolute","bridge\\escaped","bridge/file:stream","bridge/NUL","bridge/file. ","data/private.json")){var f=files();f.put(bad,new byte[]{1});assertThrows(IOException.class,()->install(dir.resolve("not-created"),f,"0.1.4-alpha"));assertFalse(Files.exists(dir.resolve("not-created")));}
        var f=files();f.put("BRIDGE/server.mjs",new byte[]{1});assertThrows(IOException.class,()->install(dir,f,"0.1.4-alpha"));
    }
    @Test void concurrentPreparationUsesOneVerifiedTarget()throws Exception{var pool=Executors.newFixedThreadPool(2);try{var f=files();var a=pool.submit(()->install(dir.resolve("shared"),f,"0.1.4-alpha"));var b=pool.submit(()->install(dir.resolve("shared"),f,"0.1.4-alpha"));assertEquals(a.get(5,TimeUnit.SECONDS),b.get(5,TimeUnit.SECONDS));}finally{pool.shutdownNow();}}
    @Test void transientPublishDenialRetriesOnlyTheSamePreparedDirectory()throws Exception{
        Path stage=Files.createDirectory(dir.resolve("stage")),target=dir.resolve("target");Files.writeString(stage.resolve("evidence"),"unchanged");int[] calls={0};List<Long> waits=new ArrayList<>();
        BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->{assertEquals(stage,from);assertEquals(target,to);if(++calls[0]<3)throw new AccessDeniedException(from.toString());Files.move(from,to);},waits::add);
        assertEquals(3,calls[0]);assertEquals(List.of(50L,100L),waits);assertFalse(Files.exists(stage));assertEquals("unchanged",Files.readString(target.resolve("evidence")));
    }
    @Test void permanentPublishDenialIsBoundedAndPreservesPreparedFiles()throws Exception{
        Path stage=Files.createDirectory(dir.resolve("stage")),target=dir.resolve("target");Files.writeString(stage.resolve("evidence"),"unchanged");int[] calls={0};List<Long> waits=new ArrayList<>();
        assertThrows(AccessDeniedException.class,()->BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->{calls[0]++;throw new AccessDeniedException(from.toString());},waits::add));
        assertEquals(8,calls[0]);assertEquals(7,waits.size());assertEquals(1950L,waits.stream().mapToLong(Long::longValue).sum());assertFalse(Files.exists(target));assertEquals("unchanged",Files.readString(stage.resolve("evidence")));
    }
    @Test void publicationCannotOverwriteAnExistingOrNewlyAppearingTarget()throws Exception{
        Path stage=Files.createDirectory(dir.resolve("stage")),target=dir.resolve("target");int[] calls={0};
        assertThrows(FileAlreadyExistsException.class,()->BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->{calls[0]++;Files.createDirectory(target);Files.writeString(target.resolve("owner"),"other");throw new AccessDeniedException(from.toString());},millis->{}));
        assertEquals(1,calls[0]);assertEquals("other",Files.readString(target.resolve("owner")));assertTrue(Files.isDirectory(stage));
        assertThrows(FileAlreadyExistsException.class,()->BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->fail("Must not replace target"),millis->fail("Must not wait")));
    }
    @Test void publicationDoesNotRetryOtherFailuresOrSwallowCancellation()throws Exception{
        Path stage=Files.createDirectory(dir.resolve("stage")),target=dir.resolve("target");
        assertThrows(IOException.class,()->BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->{throw new IOException("not transient");},millis->fail("Must not retry")));
        assertThrows(InterruptedException.class,()->BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->{throw new AccessDeniedException(from.toString());},millis->{throw new InterruptedException("cancelled");}));
        assertTrue(Files.isDirectory(stage));assertFalse(Files.exists(target));
        Files.delete(stage);
        assertThrows(NoSuchFileException.class,()->BuiltinCompanion.publishPreparedDirectory(stage,target,(from,to)->fail("Must not recreate missing prepared data"),millis->fail("Must not wait")));
        assertFalse(Files.exists(stage));assertFalse(Files.exists(target));
    }
    @Test void quotaAndMissingRequiredEntriesAreRejected()throws Exception{var f=files();f.remove("runtime/node.exe");assertThrows(IOException.class,()->install(dir,f,"0.1.4-alpha"));var m=JsonParser.parseString(new String(manifest(files(),"0.1.4-alpha"))).getAsJsonObject();m.getAsJsonArray("files").get(0).getAsJsonObject().addProperty("bytes",300L*1024*1024);assertThrows(IOException.class,()->BuiltinCompanion.install(dir,m.toString().getBytes(),name->null,s->{}));}
}
