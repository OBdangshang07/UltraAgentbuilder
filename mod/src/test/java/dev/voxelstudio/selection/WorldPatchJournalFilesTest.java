package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.List;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

/** Real local filesystem/native handle regression only, not a game/save gate. */
class WorldPatchJournalFilesTest {
    @TempDir Path temp;
    @Test void onlyNormalizedPhysicalDirectoriesAreAccepted()throws Exception{
        Path directory=Files.createDirectory(temp.resolve("physical")).toAbsolutePath().normalize();
        WorldPatchJournalFiles.directory(directory);
        assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(Path.of("relative")));
        assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(directory.resolve("..")));
        Path file=Files.writeString(directory.resolve("file.json"),"synthetic");
        assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(file));
    }
    @Test void windowsJunctionInAnAncestorCannotBeUsedForReadsOrPublication()throws Exception{
        org.junit.jupiter.api.Assumptions.assumeTrue(System.getProperty("os.name").startsWith("Windows"));
        Path root=temp.toAbsolutePath().normalize(),target=Files.createDirectory(root.resolve("target")),alias=root.resolve("redirected");
        Path child=Files.createDirectory(target.resolve("child"));Files.writeString(child.resolve("original.json"),"synthetic");
        var process=new ProcessBuilder("cmd.exe","/d","/c","mklink","/J",alias.toString(),target.toString()).redirectErrorStream(true).start();
        assertTrue(process.waitFor(15,TimeUnit.SECONDS),"Junction fixture must close normally");
        assertEquals(0,process.exitValue(),new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8));
        try{
            assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(alias));
            assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(alias.resolve("child")));
            assertThrows(IOException.class,()->WorldPatchJournalFiles.read(alias.resolve("child/original.json"),100));
            assertThrows(IOException.class,()->WorldPatchJournalFiles.publish(alias.resolve("child/new.json"),new byte[]{1},100));
            assertFalse(Files.exists(child.resolve("new.json")));
            assertEquals("synthetic",Files.readString(child.resolve("original.json")));
        }finally{Files.delete(alias);}
    }
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
