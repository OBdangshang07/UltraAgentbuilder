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
    record Runtime(Path directory,String version) {}
    @FunctionalInterface interface Resources { InputStream open(String name)throws IOException; }
    @FunctionalInterface interface DirectoryMove { void move(Path source,Path target)throws IOException; }
    @FunctionalInterface interface Pause { void waitMillis(long millis)throws InterruptedException; }
    static boolean bundled(){return BuiltinCompanion.class.getResource(RESOURCE+"manifest.json")!=null;}
    static Runtime prepare(Path root,Consumer<String> progress)throws Exception{
        if(!bundled()){directory(root);return new Runtime(root,null);} // Source-only development/legacy companion.
        if(!System.getProperty("os.name","").toLowerCase(Locale.ROOT).contains("windows")||!Set.of("amd64","x86_64").contains(System.getProperty("os.arch","")))throw new IOException("内置运行时仅支持 Windows x64；没有下载或安装任何程序");
        try(var stream=BuiltinCompanion.class.getResourceAsStream(RESOURCE+"manifest.json")){
            return install(root,stream.readNBytes(1024*1024+1),name->BuiltinCompanion.class.getResourceAsStream(RESOURCE+name),progress);
        }
    }
    static Runtime install(Path root,byte[] metadata,Resources resources,Consumer<String> progress)throws Exception{
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
        root=root.toAbsolutePath().normalize();directory(root);Path bundles=root.resolve("bundles");directory(bundles);
        String id=version+"-"+digest(metadata);Path target=bundles.resolve(id),lock=bundles.resolve(id+".lock");regularOrAbsent(lock);
        progress.accept("正在准备内置配套（本地解包，不联网下载）…");
        try(var channel=FileChannel.open(lock,StandardOpenOption.CREATE,StandardOpenOption.WRITE)){
            FileLock acquired=null;long deadline=System.nanoTime()+60_000_000_000L;
            while(acquired==null){try{acquired=channel.tryLock();}catch(OverlappingFileLockException ignored){}if(acquired==null){if(System.nanoTime()>deadline)throw new IOException("内置配套正被另一实例准备，请稍后重试");Thread.sleep(100);}}
            try(var held=acquired){
                if(Files.exists(target,LinkOption.NOFOLLOW_LINKS)){verify(target,entries);progress.accept("内置配套已就绪");return new Runtime(target,version);}
                Path stage=Files.createTempDirectory(bundles,".unpack-");int done=0;
                for(var value:entries){var e=value.getAsJsonObject();String name=e.get("path").getAsString();Path file=stage.resolve(name);Files.createDirectories(file.getParent());
                    try(var input=resources.open(name)){
                        if(input==null)throw new IOException("内置配套文件缺失："+name);
                        try(var output=Files.newOutputStream(file,StandardOpenOption.CREATE_NEW)){
                            var hash=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];long count=0;int read;
                            while((read=input.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedException("Builtin preparation cancelled");count+=read;if(count>e.get("bytes").getAsLong())throw new IOException("Builtin file exceeds declared size");hash.update(buffer,0,read);output.write(buffer,0,read);}
                            if(count!=e.get("bytes").getAsLong()||!HexFormat.of().formatHex(hash.digest()).equals(e.get("sha256").getAsString()))throw new IOException("内置配套校验失败："+name);
                        }
                    }
                    progress.accept("正在准备内置配套："+(++done)+" / "+entries.size());
                }
                Files.write(stage.resolve("bundle-manifest.json"),metadata,StandardOpenOption.CREATE_NEW);
                publishPreparedDirectory(stage,target,(source,destination)->{
                    try{Files.move(source,destination,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(source,destination);}
                },Thread::sleep);
                progress.accept("内置配套已就绪");return new Runtime(target,version);
            }
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
    private static void verify(Path root,JsonArray entries)throws Exception{
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
