package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

/** Real local filesystem/native handle regression only, not a game/save gate. */
class WorldPatchJournalFilesTest {
    @TempDir Path temp;
    @Test void physicalLocalAndUncSpellingsPreserveTheCompleteUnicodeMember()throws Exception{
        for(String path:List.of("C:\\fixture\\source.json","e:\\中文 实例\\日志\\source.json","Z:\\"+"segment\\".repeat(50)+"source.json"))
            assertEquals("\\\\?\\"+path,WorldPatchJournalFiles.windowsNativePath(path));
        assertEquals("\\\\?\\UNC\\server\\share\\中文\\source.json",WorldPatchJournalFiles.windowsNativePath("\\\\server\\share\\中文\\source.json"));
    }
    @Test void devicesRelativeAliasesTraversalAndAlternateStreamsCannotBeOpened(){
        assertThrows(IOException.class,()->WorldPatchJournalFiles.windowsNativePath(null));
        for(String path:List.of("","relative.json","C:relative.json","C:/fixture/source.json","\\\\?\\C:\\fixture\\source.json","\\\\.\\PhysicalDrive0","\\\\?\\GLOBALROOT\\Device\\file","C:\\fixture\\..\\source.json","C:\\fixture\\.\\source.json","C:\\fixture\\\\source.json","C:\\fixture\\source.json:stream","C:\\fixture\\source\n.json","C:\\","\\\\server\\share"))
            assertThrows(IOException.class,()->WorldPatchJournalFiles.windowsNativePath(path),path);
    }
    @Test void actualLongUnicodeJournalUsesTheSameCheckedHandleAndPreservesHardLinkAndQuotaGuards()throws Exception{
        Path directory=temp.toAbsolutePath().normalize();
        while(directory.resolve("source.json").toString().length()<300)directory=Files.createDirectory(directory.resolve("long-fixture-segment"));
        directory=Files.createDirectory(directory.resolve("中文 日志"));Path file=directory.resolve("source.json");
        assertTrue(file.toString().length()>300);byte[] original="synthetic original journal".getBytes(StandardCharsets.UTF_8);
        WorldPatchJournalFiles.publish(file,original,original.length);assertArrayEquals(original,WorldPatchJournalFiles.read(file,original.length));
        assertThrows(IOException.class,()->WorldPatchJournalFiles.publish(file,"changed".getBytes(StandardCharsets.UTF_8),original.length));
        assertThrows(IOException.class,()->WorldPatchJournalFiles.read(file,original.length-1));assertArrayEquals(original,Files.readAllBytes(file));
        Path alias=directory.resolve("source-hardlink.json");Files.createLink(alias,file);
        assertThrows(IOException.class,()->WorldPatchJournalFiles.read(file,original.length));assertArrayEquals(original,Files.readAllBytes(alias));
    }
}
