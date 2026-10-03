package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CompletionException;
import java.util.zip.*;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceDraftStoreTest {
    @TempDir Path temporary;
    private ReferenceImageDraft fixture()throws Exception {
        var draft=new ReferenceImageDraft();var source=new ReferenceImageDraft.Source(ReferenceImageDraftTest.png(7,5));String id=draft.add(source,0);
        var crop=new ReferenceImageNormalizer.Crop(1,1,4,3);draft.transform(id,crop,1,source.transform(crop,1),draft.revision());
        draft.annotate(id,ReferenceImageDraft.annotation("exterior","front","保留白石框架与中庭","height","224"));draft.mode("multi-view");
        String second=draft.add(new ReferenceImageDraft.Source(ReferenceImageDraftTest.png(9,3)),draft.revision());draft.annotate(second,ReferenceImageDraft.annotation("interior","section","内饰与核心筒",null,null));draft.move(second,-1);return draft;
    }
    @Test void explicitSaveRestoresExactSourceOrderCropRotationAnnotationsAndUploadButNotAuthority()throws Exception {
        var draft=fixture();var exact=draft.snapshot();var store=new ReferenceDraftStore(temporary.resolve("私人 图片"));var receipt=store.save(draft,exact).join();
        assertEquals(2,receipt.images());assertEquals(Files.size(store.file()),receipt.bytes());assertTrue(receipt.descriptorHash().matches("[a-f0-9]{64}"));
        var recovered=store.load().join();var cold=new ReferenceImageDraft();cold.restore(recovered.mode(),recovered.photos(),0);
        assertEquals(exact.upload(),cold.snapshot().upload());assertNotEquals(exact.ownerId(),cold.ownerId());assertFalse(cold.current(exact));
        for(int i=0;i<2;i++){var before=exact.photos().get(i);var after=cold.photos().get(i);assertEquals(before.id(),after.id());assertEquals(before.crop(),after.crop());assertEquals(before.turns(),after.turns());assertArrayEquals(before.source().originalBytes(),after.source().originalBytes());assertArrayEquals(before.output().png(),after.output().png());}
        var descriptor=contents(store.file()).get("draft.json");String json=new String(descriptor,StandardCharsets.UTF_8);
        for(String privateOrAuthority:new String[]{"ownerId","preparationHash","referenceSetHash","SEND","model","path","filename","world"})assertFalse(json.contains("\""+privateOrAuthority+"\""));
        assertEquals(new ReferenceImageNormalizer.Crop(1,1,4,3),cold.photos().get(1).crop());assertEquals(1,cold.photos().get(1).turns());
    }
    @Test void staleSaveAndRestoreNeverOverwriteNewEditsOrReuseConfirmation()throws Exception {
        var draft=fixture();var store=new ReferenceDraftStore(temporary);store.save(draft,draft.snapshot()).join();byte[] original=Files.readAllBytes(store.file());
        var old=draft.snapshot();draft.mode("reconstruct");assertThrows(CompletionException.class,()->store.save(draft,old).join());assertArrayEquals(original,Files.readAllBytes(store.file()));
        var recovered=store.load().join();assertThrows(IllegalStateException.class,()->draft.restore(recovered.mode(),recovered.photos(),old.revision()));assertEquals("reconstruct",draft.mode());
        var latest=draft.snapshot();draft.restore(recovered.mode(),recovered.photos(),draft.revision());assertFalse(draft.current(latest));assertFalse(draft.current(old));
    }
    @Test void savingAndDeletingOnlyTouchTheOneExplicitBundleNotSourcesTaskEvidenceOrMemory()throws Exception {
        Path source=temporary.resolve("原图.png"),task=temporary.resolve("original-task.json");Files.write(source,ReferenceImageDraftTest.png(3,2));Files.writeString(task,"original evidence");
        var draft=new ReferenceImageDraft();draft.add(ReferenceImageIO.read(source.toString()),0);var exact=draft.snapshot();var store=new ReferenceDraftStore(temporary.resolve("saved"));
        assertFalse(Files.exists(store.file()));store.save(draft,exact).join();draft.clear();assertTrue(Files.exists(store.file()));assertTrue(draft.photos().isEmpty());
        var recovered=store.load().join();draft.restore(recovered.mode(),recovered.photos(),draft.revision());var restored=draft.snapshot();assertTrue(store.forget().join());
        assertFalse(Files.exists(store.file()));assertTrue(Files.exists(source));assertEquals("original evidence",Files.readString(task));assertTrue(draft.current(restored));assertFalse(store.forget().join());
        assertThrows(CompletionException.class,()->store.load().join());
    }
    @Test void tamperedSourcesOutputsVersionsAndAuthorityFieldsArePreservedAndRejected()throws Exception {
        for(String corruption:List.of("source","output","version","authority","number-overflow")){
            var folder=temporary.resolve(corruption);var store=new ReferenceDraftStore(folder);var draft=fixture();store.save(draft,draft.snapshot()).join();var files=contents(store.file());
            var descriptor=JsonParser.parseString(new String(files.get("draft.json"),StandardCharsets.UTF_8)).getAsJsonObject();
            if(corruption.equals("source"))files.put("images/0.source",ReferenceImageDraftTest.png(10,3));
            else if(corruption.equals("output"))descriptor.getAsJsonArray("photos").get(0).getAsJsonObject().addProperty("outputSha256","0".repeat(64));
            else if(corruption.equals("version"))descriptor.addProperty("version",2);
            else if(corruption.equals("authority"))descriptor.addProperty("assemblyConfirmed",true);
            else descriptor.add("version",JsonParser.parseString("18446744073709551617"));
            descriptor.remove("descriptorHash");descriptor.addProperty("descriptorHash",ContextReceipt.jsonHash(descriptor));files.put("draft.json",descriptor.toString().getBytes(StandardCharsets.UTF_8));write(store.file(),files,false);
            byte[] bad=Files.readAllBytes(store.file());assertThrows(CompletionException.class,()->store.load().join(),corruption);assertThrows(CompletionException.class,()->store.save(draft,draft.snapshot()).join(),corruption);assertThrows(CompletionException.class,()->store.forget().join(),corruption);assertArrayEquals(bad,Files.readAllBytes(store.file()));
        }
    }
    @Test void extraTraversalCompressedAndDirectoryEntriesAreNeverExtracted()throws Exception {
        for(String corruption:List.of("extra","traversal","compressed","directory")){
            var store=new ReferenceDraftStore(temporary.resolve(corruption));var draft=fixture();store.save(draft,draft.snapshot()).join();var files=contents(store.file());
            if(corruption.equals("extra"))files.put("unrecognized",new byte[]{1});if(corruption.equals("traversal"))files.put("../../escaped",new byte[]{1});if(corruption.equals("directory"))files.put("folder/",new byte[]{1});write(store.file(),files,corruption.equals("compressed"));
            byte[] bad=Files.readAllBytes(store.file());assertThrows(CompletionException.class,()->store.load().join());assertArrayEquals(bad,Files.readAllBytes(store.file()));assertFalse(Files.exists(temporary.resolve("escaped")));
        }
    }
    @Test void nonFilesAndOversizedBundlesAreRejectedWithoutDeletingOrTruncating()throws Exception {
        var store=new ReferenceDraftStore(temporary);Files.createDirectory(store.file());assertThrows(CompletionException.class,()->store.load().join());assertThrows(CompletionException.class,()->store.forget().join());assertTrue(Files.isDirectory(store.file()));Files.delete(store.file());
        try(var file=new RandomAccessFile(store.file().toFile(),"rw")){file.setLength(ReferenceDraftStore.MAX_BUNDLE_BYTES+1);}
        assertThrows(CompletionException.class,()->store.load().join());assertThrows(CompletionException.class,()->store.forget().join());assertEquals(ReferenceDraftStore.MAX_BUNDLE_BYTES+1,Files.size(store.file()));
    }
    @Test void publicationGuardChecksTheActualCommitNotOnlyInitialSnapshot()throws Exception {
        var draft=fixture();var exact=draft.snapshot();draft.clear();boolean[] published={false};assertThrows(IllegalStateException.class,()->draft.publishIfCurrent(exact,()->published[0]=true));assertFalse(published[0]);
    }
    private static LinkedHashMap<String,byte[]> contents(Path file)throws Exception {
        var result=new LinkedHashMap<String,byte[]>();try(var zip=new ZipInputStream(Files.newInputStream(file))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){result.put(entry.getName(),zip.readAllBytes());zip.closeEntry();}}return result;
    }
    private static void write(Path file,Map<String,byte[]> entries,boolean compressed)throws Exception {
        try(var zip=new ZipOutputStream(Files.newOutputStream(file))){for(var item:entries.entrySet()){var entry=new ZipEntry(item.getKey());if(!compressed){var crc=new CRC32();crc.update(item.getValue());entry.setMethod(ZipEntry.STORED);entry.setSize(item.getValue().length);entry.setCompressedSize(item.getValue().length);entry.setCrc(crc.getValue());}zip.putNextEntry(entry);zip.write(item.getValue());zip.closeEntry();}}
    }
}
