package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic publication failures; no executable, model, or world is used. */
class BuiltinPublicationTest {
    @TempDir(cleanup=CleanupMode.ON_SUCCESS) Path dir;
    final BuiltinCompanionTest fixture=new BuiltinCompanionTest();
    final Map<String,byte[]> files=fixture.files();
    byte[] metadata()throws Exception{return fixture.manifest(files,"0.1.4-alpha");}
    JsonArray entries(byte[] metadata){return JsonParser.parseString(new String(metadata,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject().getAsJsonArray("files");}
    Path stage(String name,byte[] metadata)throws Exception{
        Path root=Files.createDirectory(dir.resolve(name));
        for(var file:files.entrySet()){Path target=root.resolve(file.getKey());Files.createDirectories(target.getParent());Files.write(target,file.getValue(),StandardOpenOption.CREATE_NEW);}
        Files.write(root.resolve("bundle-manifest.json"),metadata,StandardOpenOption.CREATE_NEW);return root;
    }
    void publish(Path stage,Path target,byte[] metadata,BuiltinCompanion.DirectoryMove move)throws Exception{
        BuiltinCompanion.publishVerifiedDirectory(stage,target,metadata,entries(metadata),move,millis->fail("This failure must not be retried"));
    }
    @Test void unsupportedSourceRenameCopiesOnlyVerifiedEntriesAndRetainsPreparedSource()throws Exception{
        byte[] metadata=metadata();int index=0;
        for(boolean atomic:List.of(false,true)){
            Path stage=stage("stage-"+index,metadata),target=dir.resolve("target-"+index++);Files.writeString(stage.resolve("not-in-manifest"),"must not copy");int[] calls={0};
            publish(stage,target,metadata,(from,to)->{calls[0]++;if(atomic)throw new AtomicMoveNotSupportedException(from.toString(),to.toString(),"synthetic");throw new DirectoryNotEmptyException(from.toString());});
            assertEquals(1,calls[0]);assertTrue(Files.isDirectory(stage));assertFalse(Files.exists(target.resolve("not-in-manifest")));
            assertArrayEquals(metadata,Files.readAllBytes(target.resolve("bundle-manifest.json")));
            for(var entry:files.entrySet())assertArrayEquals(entry.getValue(),Files.readAllBytes(target.resolve(entry.getKey())));
        }
    }
    @Test void targetSideNonemptyFailureDoesNotTriggerCopy()throws Exception{
        byte[] metadata=metadata();Path stage=stage("stage",metadata),target=dir.resolve("target");
        assertThrows(DirectoryNotEmptyException.class,()->publish(stage,target,metadata,(from,to)->{throw new DirectoryNotEmptyException(to.toString());}));
        assertTrue(Files.isDirectory(stage));assertFalse(Files.exists(target));
    }
    @Test void fallbackCannotOverwriteAConcurrentTarget()throws Exception{
        byte[] metadata=metadata();Path stage=stage("stage",metadata),target=dir.resolve("target");
        assertThrows(FileAlreadyExistsException.class,()->publish(stage,target,metadata,(from,to)->{Files.createDirectory(to);Files.writeString(to.resolve("owner"),"unrelated");throw new DirectoryNotEmptyException(from.toString());}));
        assertEquals("unrelated",Files.readString(target.resolve("owner")));assertFalse(Files.exists(target.resolve("bundle-manifest.json")));assertTrue(Files.isDirectory(stage));
    }
    @Test void changedPreparedBytesAreRejectedBeforeFallbackCreatesAnyTarget()throws Exception{
        byte[] metadata=metadata();Path stage=stage("stage",metadata),target=dir.resolve("target");
        assertThrows(IOException.class,()->publish(stage,target,metadata,(from,to)->{Files.writeString(from.resolve("runtime/node.exe"),"corrupt");throw new DirectoryNotEmptyException(from.toString());}));
        assertFalse(Files.exists(target));assertEquals("corrupt",Files.readString(stage.resolve("runtime/node.exe")));
    }
    @Test void interruptedFallbackDoesNotCreateAReadyTargetOrSwallowCancellation()throws Exception{
        byte[] metadata=metadata();Path stage=stage("stage",metadata),target=dir.resolve("target");
        try{
            assertThrows(InterruptedException.class,()->publish(stage,target,metadata,(from,to)->{Thread.currentThread().interrupt();throw new DirectoryNotEmptyException(from.toString());}));
            assertTrue(Thread.currentThread().isInterrupted());assertTrue(Files.isDirectory(stage));assertFalse(Files.exists(target));
        }finally{Thread.interrupted();}
    }
    @Test void aCompleteFileSetWithoutReadinessManifestIsNotReusableOrOverwritten()throws Exception{
        Path root=Files.createDirectory(dir.resolve("instance"));var installed=fixture.install(root,files,"0.1.4-alpha");Files.delete(installed.directory().resolve("bundle-manifest.json"));
        assertThrows(IOException.class,()->BuiltinCompanion.install(root,metadata(),name->{fail("Incomplete target must not be extracted again");return null;},s->{}));
        assertFalse(Files.exists(installed.directory().resolve("bundle-manifest.json")));
        for(var entry:files.entrySet())assertArrayEquals(entry.getValue(),Files.readAllBytes(installed.directory().resolve(entry.getKey())));
    }
    @Test void readinessManifestMustMatchTheFullOriginalMetadata()throws Exception{
        Path root=Files.createDirectory(dir.resolve("instance"));var installed=fixture.install(root,files,"0.1.4-alpha");byte[] changed=metadata();changed[0]=' ';
        Files.write(installed.directory().resolve("bundle-manifest.json"),changed);
        assertThrows(IOException.class,()->BuiltinCompanion.install(root,metadata(),name->{fail("Changed target must not be overwritten");return null;},s->{}));
        assertArrayEquals(changed,Files.readAllBytes(installed.directory().resolve("bundle-manifest.json")));
    }
    @Test void successfulRenameStillVerifiesActualPublishedBytesBeforeReturning()throws Exception{
        byte[] metadata=metadata();Path stage=stage("stage",metadata),target=dir.resolve("target");
        assertThrows(IOException.class,()->publish(stage,target,metadata,(from,to)->{Files.move(from,to);Files.writeString(to.resolve("runtime/node.exe"),"modified");}));
        assertEquals("modified",Files.readString(target.resolve("runtime/node.exe")));assertFalse(Files.exists(stage));
    }
}
