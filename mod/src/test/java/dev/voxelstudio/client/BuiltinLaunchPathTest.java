package dev.voxelstudio.client;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.*;
import org.junit.jupiter.api.extension.ExtensionContext;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic install/cache regression only; real process startup is exercised
 * separately by BuiltinRuntimeTest with its original instance/data root. */
class BuiltinLaunchPathTest {
    public static class CacheTempFactory implements TempDirFactory {
        public Path createTempDirectory(org.junit.jupiter.api.extension.AnnotatedElementContext context,ExtensionContext extension)throws IOException{
            String home=System.getenv("LOCALAPPDATA");
            Path base=home==null?Path.of(System.getProperty("user.home")):Path.of(home);
            return Files.createTempDirectory(base,"uab-launch-test-");
        }
    }
    @TempDir(cleanup=CleanupMode.ON_SUCCESS) Path dir;
    @TempDir(factory=CacheTempFactory.class,cleanup=CleanupMode.ON_SUCCESS) Path cacheHome;
    BuiltinCompanionTest fixture=new BuiltinCompanionTest();
    Path longRoot()throws IOException{Path p=dir;while(p.toAbsolutePath().toString().length()<230)p=Files.createDirectory(p.resolve("long-instance-segment"));return Files.createDirectory(p.resolve("中文 instance"));}
    BuiltinCompanion.Runtime install(Path root,Path home,Map<String,byte[]> files)throws Exception{
        return BuiltinCompanion.installForLaunch(root,fixture.manifest(files,"0.1.4-alpha"),name->new ByteArrayInputStream(files.get(name)),s->{},home);
    }
    @Test void longInstanceUsesOnlyVerifiedCacheAndRetainsOriginalDataAndLegacyRuntime()throws Exception{
        var files=fixture.files();var root=longRoot();Files.createDirectory(root.resolve("data"));Files.writeString(root.resolve("data/evidence.txt"),"preserved");
        var original=BuiltinCompanion.install(root,fixture.manifest(files,"0.1.4-alpha"),name->new ByteArrayInputStream(files.get(name)),s->{});
        var cached=install(root,cacheHome,files);assertNotEquals(original.directory(),cached.directory());
        assertEquals(original.manifestHash(),cached.manifestHash(),"Relocating the verified runtime cache must not change its build identity");
        assertTrue(cached.directory().startsWith(cacheHome.resolve("UltraAgentbuilder/builtin-companion")));
        assertTrue(cached.directory().resolve("runtime/node.exe").toString().length()<=240);
        assertArrayEquals(files.get("runtime/node.exe"),Files.readAllBytes(cached.directory().resolve("runtime/node.exe")));
        assertArrayEquals(files.get("runtime/node.exe"),Files.readAllBytes(original.directory().resolve("runtime/node.exe")));
        assertEquals("preserved",Files.readString(root.resolve("data/evidence.txt")));assertFalse(Files.exists(cacheHome.resolve("UltraAgentbuilder/builtin-companion/data")));
        assertEquals(cached,BuiltinCompanion.installForLaunch(root,fixture.manifest(files,"0.1.4-alpha"),name->{throw new AssertionError("Verified cache must be reused");},s->{},cacheHome));
    }
    @Test void shortInstanceDoesNotCreateOrRequireAnExternalCache()throws Exception{
        var files=fixture.files();var root=cacheHome.resolve("short");var installed=install(root,null,files);
        assertTrue(installed.directory().startsWith(root.resolve("bundles")));assertFalse(Files.exists(cacheHome.resolve("UltraAgentbuilder")));
    }
    @Test void corruptOriginalRuntimeCannotBeHiddenByFallbackCache()throws Exception{
        var files=fixture.files();var root=longRoot();var old=BuiltinCompanion.install(root,fixture.manifest(files,"0.1.4-alpha"),name->new ByteArrayInputStream(files.get(name)),s->{});
        Files.writeString(old.directory().resolve("runtime/node.exe"),"changed-original");assertThrows(IOException.class,()->install(root,cacheHome,files));
        assertEquals("changed-original",Files.readString(old.directory().resolve("runtime/node.exe")));assertFalse(Files.exists(cacheHome.resolve("UltraAgentbuilder")));
    }
    @Test void cacheCorruptionFailsClosedWithoutOverwrite()throws Exception{
        var files=fixture.files();var root=longRoot();var old=install(root,cacheHome,files);Files.writeString(old.directory().resolve("bridge/server.mjs"),"changed-cache");
        assertThrows(IOException.class,()->install(root,cacheHome,files));assertEquals("changed-cache",Files.readString(old.directory().resolve("bridge/server.mjs")));
    }
    @Test void invalidOrOverlongCacheCannotLaunchOrRelocatePrivateData()throws Exception{
        var files=fixture.files();var root=longRoot();Files.writeString(root.resolve("private-evidence.txt"),"retained");
        for(Path bad:List.of(Path.of("relative-cache"),root.resolve("missing-cache"))){assertThrows(IOException.class,()->install(root,bad,files));assertFalse(Files.exists(bad.resolve("UltraAgentbuilder")));}
        assertThrows(IOException.class,()->install(root,null,files));assertEquals("retained",Files.readString(root.resolve("private-evidence.txt")));
    }
}
