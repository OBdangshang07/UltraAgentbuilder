package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Consumer;

/** Offline, hash-verified extraction. Never replaces an existing runtime or touches user data. */
final class BuiltinCompanion {
    private static final String RESOURCE="/voxelstudio-bundle/";
    private static final long MAX_TOTAL=200L*1024*1024;
    // Java 17/Windows process creation does not reliably launch an existing
    // executable beyond MAX_PATH, even with a long-path prefix. This applies
    // to the native executable only, not model tokens or geometry limits.
    private static final int MAX_LAUNCH_PATH=240;
    record Runtime(Path directory,String version,String manifestHash) {}
    @FunctionalInterface interface Resources { InputStream open(String name)throws IOException; }
    @FunctionalInterface interface DirectoryMove { void move(Path source,Path target)throws IOException; }
    @FunctionalInterface interface Pause { void waitMillis(long millis)throws InterruptedException; }
    static boolean bundled(){return BuiltinCompanion.class.getResource(RESOURCE+"manifest.json")!=null;}
    static Runtime prepare(Path root,Consumer<String> progress)throws Exception{
        if(!bundled()){directory(root);return new Runtime(root,null,null);} // Source-only development/legacy companion.
        if(!System.getProperty("os.name","").toLowerCase(Locale.ROOT).contains("windows")||!Set.of("amd64","x86_64").contains(System.getProperty("os.arch","")))throw new IOException("内置运行时仅支持 Windows x64；没有下载或安装任何程序");
        try(var stream=BuiltinCompanion.class.getResourceAsStream(RESOURCE+"manifest.json")){
            String home=System.getenv("LOCALAPPDATA");
            return installForLaunch(root,stream.readNBytes(1024*1024+1),name->BuiltinCompanion.class.getResourceAsStream(RESOURCE+name),progress,home==null?null:Path.of(home));
        }
    }
    static Runtime install(Path root,byte[] metadata,Resources resources,Consumer<String> progress)throws Exception{
        return install(root,metadata,resources,progress,null,false);
    }
    static Runtime installForLaunch(Path root,byte[] metadata,Resources resources,Consumer<String> progress,Path localAppData)throws Exception{
        return install(root,metadata,resources,progress,localAppData,true);
    }
    private static Runtime install(Path root,byte[] metadata,Resources resources,Consumer<String> progress,Path localAppData,boolean forLaunch)throws Exception{
        if(metadata.length>1024*1024)throw new IOException("Builtin manifest too large");
        var manifest=JsonParser.parseString(new String(metadata,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        String version=manifest.get("version").getAsString();
        if(manifest.get("schemaVersion").getAsInt()!=1||!version.matches("\\d+\\.\\d+\\.\\d+-alpha")||!manifest.get("platform").getAsString().equals("windows-x64"))throw new IOException("Invalid builtin manifest version/platform");
        var entries=manifest.getAsJsonArray("files");if(entries.isEmpty()||entries.size()>512)throw new IOException("Builtin file quota exceeded");
        Set<String> names=new HashSet<>();long total=0;
        for(var value:entries){var e=value.getAsJsonObject();String name=e.get("path").getAsString();long size=e.get("bytes").getAsLong();
            if(!safeName(name)||!names.add(name.toLowerCase(Locale.ROOT))||size<0||size>128L*1024*1024||!e.get("sha256").getAsString().matches("[a-f0-9]{64}"))throw new IOException("Invalid builtin file entry");
            total+=size;if(total>MAX_TOTAL)throw new IOException("Builtin size quota exceeded");
        }
        if(!names.containsAll(List.of("runtime/node.exe","bridge/server.mjs","package.json",".agents/skills/voxel-studio/skill.md")))throw new IOException("Incomplete builtin companion");
        root=root.toAbsolutePath().normalize();directory(root);String manifestHash=digest(metadata),id=version+"-"+manifestHash;
        if(forLaunch&&exceedsLaunchPath(root,id)){
            Path previousBundles=root.resolve("bundles"),previous=previousBundles.resolve(id);
            // A shorter cache must not conceal a corrupt existing runtime.
            if(Files.exists(previousBundles,LinkOption.NOFOLLOW_LINKS))directory(previousBundles);
            if(Files.exists(previous,LinkOption.NOFOLLOW_LINKS))verify(previous,entries,metadata);
            root=launchCache(localAppData,id);
            progress.accept("实例路径较长；仅把已校验的内置配套准备到本机缓存，任务数据仍在原实例…");
        }
        Path bundles=root.resolve("bundles");directory(bundles);
        Path target=bundles.resolve(id),lock=bundles.resolve(id+".lock");regularOrAbsent(lock);
        progress.accept("正在准备内置配套（本地解包，不联网下载）…");
        try(var channel=FileChannel.open(lock,StandardOpenOption.CREATE,StandardOpenOption.WRITE)){
            FileLock acquired=null;long deadline=System.nanoTime()+60_000_000_000L;
            while(acquired==null){try{acquired=channel.tryLock();}catch(OverlappingFileLockException ignored){}if(acquired==null){if(System.nanoTime()>deadline)throw new IOException("内置配套正被另一实例准备，请稍后重试");Thread.sleep(100);}}
            try(var held=acquired){
                if(Files.exists(target,LinkOption.NOFOLLOW_LINKS)){verify(target,entries,metadata);progress.accept("内置配套已就绪");return new Runtime(target,version,manifestHash);}
                Path stage=Files.createTempDirectory(bundles,".unpack-");int done=0;
                for(var value:entries){var e=value.getAsJsonObject();String name=e.get("path").getAsString();Path file=stage.resolve(name);Files.createDirectories(file.getParent());
                    try(var input=resources.open(name)){
                        if(input==null)throw new IOException("内置配套文件缺失："+name);
                        writeVerifiedFile(input,file,e);
                    }
                    progress.accept("正在准备内置配套："+(++done)+" / "+entries.size());
                }
                Files.write(stage.resolve("bundle-manifest.json"),metadata,StandardOpenOption.CREATE_NEW);
                // No REPLACE_EXISTING or ATOMIC_MOVE: on Windows the latter
                // may replace a target that appeared after the absence check.
                publishVerifiedDirectory(stage,target,metadata,entries,(source,destination)->Files.move(source,destination),Thread::sleep);
                progress.accept("内置配套已就绪");return new Runtime(target,version,manifestHash);
            }
        }
    }
    static boolean exceedsLaunchPath(Path root,String id){return root.toAbsolutePath().normalize().resolve("bundles").resolve(id).resolve("runtime/node.exe").toString().length()>MAX_LAUNCH_PATH;}
    private static Path launchCache(Path home,String id)throws IOException{
        if(home==null||!home.isAbsolute())throw new IOException("实例路径超过 Windows 原生启动长度，且本机缓存目录不可用；原文件和任务保留，未启动服务");
        home=home.normalize();Path product=home.resolve("UltraAgentbuilder"),cache=product.resolve("builtin-companion");
        if(exceedsLaunchPath(cache,id))throw new IOException("实例和本机缓存路径都超过 Windows 原生启动长度；请使用较短实例路径，未改动原运行时或任务");
        // Do not follow redirected ancestors or create an arbitrary supplied
        // home. Only the two named product cache directories may be created.
        for(Path ancestor=home;ancestor!=null;ancestor=ancestor.getParent()){
            var a=Files.readAttributes(ancestor,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
            if(!a.isDirectory()||a.isSymbolicLink()||a.isOther())throw new IOException("本机缓存父路径被重定向；没有启动或替换原运行时");
        }
        directory(product);directory(cache);return cache;
    }
    /** Some Windows directory policies report a cross-device move inside one
     * parent. Java then rejects a nonempty source directory. Do not retry that
     * permanent failure or replace an existing target. Copy only verified
     * manifest entries into a newly created destination, with the readiness
     * manifest last. A failure retains the source and rejects partial targets. */
    static void publishVerifiedDirectory(Path stage,Path target,byte[] metadata,JsonArray entries,DirectoryMove move,Pause pause)throws Exception{
        verify(stage,entries,metadata);
        try{publishPreparedDirectory(stage,target,move,pause);}
        catch(AtomicMoveNotSupportedException|DirectoryNotEmptyException unsupported){
            if(unsupported instanceof DirectoryNotEmptyException&&!stage.toString().equals(unsupported.getFile()))throw unsupported;
            if(Thread.currentThread().isInterrupted())throw new InterruptedException("Builtin preparation cancelled");
            verify(stage,entries,metadata);
            // CREATE_NEW ownership for the directory and every file. Neither
            // an unrelated target nor a prior failed publication is resumed.
            Files.createDirectory(target);
            for(var value:entries){
                var e=value.getAsJsonObject();Path source=stage.resolve(e.get("path").getAsString()),file=target.resolve(e.get("path").getAsString());
                List<Path> parents=new ArrayList<>();for(Path p=file.getParent();!p.equals(target);p=p.getParent())parents.add(p);
                Collections.reverse(parents);for(Path parent:parents)directory(parent);
                regularOrAbsent(source);
                try(var input=Files.newInputStream(source,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){writeVerifiedFile(input,file,e);}
            }
            verifyFiles(target,entries);
            if(Thread.currentThread().isInterrupted())throw new InterruptedException("Builtin preparation cancelled");
            Files.write(target.resolve("bundle-manifest.json"),metadata,StandardOpenOption.CREATE_NEW);
        }
        verify(target,entries,metadata);
    }
    private static void writeVerifiedFile(InputStream input,Path file,JsonObject entry)throws Exception{
        try(var output=Files.newOutputStream(file,StandardOpenOption.CREATE_NEW)){
            var hash=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];long count=0;int read;
            while((read=input.read(buffer))!=-1){
                if(Thread.currentThread().isInterrupted())throw new InterruptedException("Builtin preparation cancelled");
                count+=read;if(count>entry.get("bytes").getAsLong())throw new IOException("Builtin file exceeds declared size");
                hash.update(buffer,0,read);output.write(buffer,0,read);
            }
            if(count!=entry.get("bytes").getAsLong()||!HexFormat.of().formatHex(hash.digest()).equals(entry.get("sha256").getAsString()))throw new IOException("内置配套校验失败："+entry.get("path").getAsString());
        }
    }
    /** Windows may briefly deny a directory rename after its files close. Only
     * this local publication is retried, never extraction, model calls or an
     * existing destination replacement. Permanent failures retain the stage. */
    static void publishPreparedDirectory(Path stage,Path target,DirectoryMove move,Pause pause)throws IOException,InterruptedException{
        int attempts=0;
        while(true){
            if(Thread.currentThread().isInterrupted())throw new InterruptedException("Builtin preparation cancelled");
            var attributes=Files.readAttributes(stage,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
            if(!attributes.isDirectory()||attributes.isSymbolicLink()||attributes.isOther())throw new IOException("Unsafe prepared builtin directory");
            if(Files.exists(target,LinkOption.NOFOLLOW_LINKS))throw new FileAlreadyExistsException(target.toString());
            try{move.move(stage,target);return;}
            catch(AccessDeniedException denied){
                if(++attempts>=8)throw denied;
                pause.waitMillis(Math.min(400,50L<<(attempts-1)));
            }
        }
    }
    private static boolean safeName(String name){
        if(name.length()>240||name.startsWith("/")||name.contains("\\")||name.contains(":")||name.contains("\u0000"))return false;
        for(String part:name.split("/",-1))if(part.isEmpty()||part.equals(".")||part.equals("..")||part.endsWith(".")||part.endsWith(" ")||part.matches(".*[\\x00-\\x1f<>\"|?*].*")||part.matches("(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\..*)?"))return false;
        return name.equals("package.json")||name.equals("runtime/node.exe")||name.equals("runtime/NODE-LICENSE.txt")||List.of("bridge/","contracts/","prompts/","src/core/","src/generation/","src/design/","src/world/",".agents/skills/voxel-studio/").stream().anyMatch(name::startsWith);
    }
    static void directory(Path path)throws IOException{
        if(Files.exists(path,LinkOption.NOFOLLOW_LINKS)){var a=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);if(!a.isDirectory()||a.isSymbolicLink()||a.isOther())throw new IOException("配套路径被重定向或不是目录："+path);}
        else try{Files.createDirectory(path);}catch(FileAlreadyExistsException concurrent){directory(path);}
    }
    private static void regularOrAbsent(Path path)throws IOException{if(Files.exists(path,LinkOption.NOFOLLOW_LINKS)){var a=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);if(!a.isRegularFile()||a.isSymbolicLink()||a.isOther())throw new IOException("Unsafe builtin file path");}}
    private static void verify(Path root,JsonArray entries,byte[] metadata)throws Exception{
        directory(root);Path ready=root.resolve("bundle-manifest.json");regularOrAbsent(ready);
        if(!Files.isRegularFile(ready,LinkOption.NOFOLLOW_LINKS)||Files.size(ready)!=metadata.length||!Arrays.equals(Files.readAllBytes(ready),metadata))throw new IOException("内置配套尚未完整发布或清单被修改；原文件保留，未启动服务");
        verifyFiles(root,entries);
    }
    private static void verifyFiles(Path root,JsonArray entries)throws Exception{
        directory(root);
        for(var value:entries){var e=value.getAsJsonObject();Path file=root.resolve(e.get("path").getAsString());
            Path parent=file.getParent();while(!parent.equals(root)){if(!Files.exists(parent,LinkOption.NOFOLLOW_LINKS))throw new IOException("内置配套损坏；原件保留，请检查 bundles 目录");directory(parent);parent=parent.getParent();}
            regularOrAbsent(file);if(!Files.isRegularFile(file)||Files.size(file)!=e.get("bytes").getAsLong())throw new IOException("内置配套损坏；原件保留，请检查 bundles 目录");
            var hash=MessageDigest.getInstance("SHA-256");try(var stream=Files.newInputStream(file)){byte[] b=new byte[65536];int n;while((n=stream.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedException();hash.update(b,0,n);}}
            if(!HexFormat.of().formatHex(hash.digest()).equals(e.get("sha256").getAsString()))throw new IOException("内置配套文件被修改；未覆盖原件，请检查 bundles 目录");
        }
    }
    private static String digest(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
}
