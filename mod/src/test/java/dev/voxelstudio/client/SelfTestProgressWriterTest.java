package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SelfTestProgressWriterTest {
    @TempDir Path dir;
    Path latest() throws IOException {
        Path file=dir.resolve("1".repeat(32)+".progress.json");
        Files.writeString(file,"old",StandardOpenOption.CREATE_NEW);return file;
    }
    @Test void normalPublicationReplacesOnlyTheProgressFile() throws Exception {
        Path file=latest();Files.writeString(dir.resolve("journal.json"),"protected");
        var result=SelfTestProgressWriter.publish(file,"new");
        assertTrue(result.latestUpdated());assertEquals(file,result.evidenceFile());assertEquals(1,result.attempts());
        assertNull(result.warning());assertEquals("new",Files.readString(file));
        assertEquals("protected",Files.readString(dir.resolve("journal.json")));
        try(var files=Files.list(dir)){assertEquals(2,files.count());}
    }
    @Test void transientReaderDenialRetriesTheSameCompleteSnapshot() throws Exception {
        Path file=latest();int[] attempts={0};List<Long> waits=new ArrayList<>();List<Path> sources=new ArrayList<>();
        var result=SelfTestProgressWriter.publish(file,"new",(from,to)->{
            sources.add(from);assertEquals("new",Files.readString(from));assertEquals("old",Files.readString(to));
            if(++attempts[0]<3)throw new AccessDeniedException(to.toString());
            Files.move(from,to,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        },waits::add);
        assertTrue(result.latestUpdated());assertEquals(3,result.attempts());assertEquals(List.of(25L,50L),waits);
        assertEquals(1,new HashSet<>(sources).size());assertEquals("new",Files.readString(file));
    }
    @Test void persistentReaderDenialRetainsEvidenceWithoutStoppingNextStage() throws Exception {
        Path file=latest();int[] attempts={0};List<Long> waits=new ArrayList<>();
        var held=SelfTestProgressWriter.publish(file,"stage6",(from,to)->{attempts[0]++;throw new AccessDeniedException(to.toString());},waits::add);
        assertFalse(held.latestUpdated());assertEquals(3,attempts[0]);assertEquals(List.of(25L,50L),waits);
        assertTrue(held.warning().contains("AccessDeniedException"));assertNotEquals(file,held.evidenceFile());
        assertEquals("old",Files.readString(file));assertEquals("stage6",Files.readString(held.evidenceFile()));
        var next=SelfTestProgressWriter.publish(file,"stage7");assertTrue(next.latestUpdated());
        assertEquals("stage7",Files.readString(file));assertEquals("stage6",Files.readString(held.evidenceFile()));
    }
    @Test void otherIoFailuresRemainFatalAndCannotTargetJournals() throws Exception {
        Path file=latest();int[] attempts={0};
        assertThrows(IOException.class,()->SelfTestProgressWriter.publish(file,"new",(from,to)->{attempts[0]++;throw new IOException("not sharing denial");},millis->fail("No retry")));
        assertEquals(1,attempts[0]);assertEquals("old",Files.readString(file));
        assertThrows(IllegalArgumentException.class,()->SelfTestProgressWriter.publish(dir.resolve("journal.json"),"forbidden"));
        assertFalse(Files.exists(dir.resolve("journal.json")));
    }
    @Test void interruptionIsNotHiddenAsSuccessfulPublication() throws Exception {
        Path file=latest();
        assertThrows(InterruptedException.class,()->SelfTestProgressWriter.publish(file,"new",(from,to)->{throw new AccessDeniedException(to.toString());},millis->{throw new InterruptedException("cancelled");}));
        assertEquals("old",Files.readString(file));
    }
    @Test @EnabledOnOs(OS.WINDOWS) void realWindowsReaderLockRetainsSnapshotAndRecovers() throws Exception {
        Path file=latest();
        OpenOption noShareDelete=(OpenOption)Class.forName("com.sun.nio.file.ExtendedOpenOption").getField("NOSHARE_DELETE").get(null);
        SelfTestProgressWriter.Publication held;
        try(var reader=Files.newByteChannel(file,Set.of(StandardOpenOption.READ,noShareDelete))) {
            assertTrue(reader.isOpen());held=SelfTestProgressWriter.publish(file,"locked-stage");
            assertFalse(held.latestUpdated());assertEquals(3,held.attempts());
            assertEquals("old",Files.readString(file));assertEquals("locked-stage",Files.readString(held.evidenceFile()));
        }
        assertTrue(SelfTestProgressWriter.publish(file,"unlocked-stage").latestUpdated());
        assertEquals("unlocked-stage",Files.readString(file));assertEquals("locked-stage",Files.readString(held.evidenceFile()));
    }
}
