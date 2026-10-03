package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

/** One explicitly saved, private local picture draft. No discovery, account,
 * network, model, task, preparation or world authority. Never extracts ZIP
 * paths. Original PNG/JPEG bytes (including any metadata) stay LOCAL only.
 * All reads/writes/normalization run outside the client rendering thread. */
final class ReferenceDraftStore {
    static final String FILE="unsent-images-v1.zip";
    static final long MAX_BUNDLE_BYTES=4L*ReferenceImageNormalizer.MAX_SOURCE_BYTES+65536+4096;
    private static final ExecutorService IO=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(2),r->{var t=new Thread(r,"voxel-reference-draft-storage");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    static {Runtime.getRuntime().addShutdownHook(new Thread(()->{IO.shutdown();try{IO.awaitTermination(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}},"voxel-reference-draft-flush"));}
    record Saved(int images,long bytes,String descriptorHash) {}
    record Loaded(String mode,List<ReferenceImageDraft.Photo> photos) {Loaded{photos=List.copyOf(photos);}}
    private final Path root;
    ReferenceDraftStore(Path root){this.root=root.toAbsolutePath().normalize();}
    Path file(){return root.resolve(FILE);}
    private static <T> CompletableFuture<T> work(Callable<T> action){
        var result=new CompletableFuture<T>();try{IO.execute(()->{try{result.complete(action.call());}catch(Throwable e){result.completeExceptionally(e);}});}
        catch(RejectedExecutionException e){result.completeExceptionally(new IllegalStateException("本机图片草稿存储通道忙，请稍后重试",e));}return result;
    }
    CompletableFuture<Saved> save(ReferenceImageDraft draft,ReferenceImageDraft.Snapshot exact){return work(()->saveNow(draft,exact));}
    CompletableFuture<Loaded> load(){return work(this::loadNow);}
    CompletableFuture<Boolean> forget(){return work(()->{
        checkRoot(false);if(!Files.exists(file(),LinkOption.NOFOLLOW_LINKS))return false;
        // Refuse to remove a substituted/corrupt/foreign file. This never
        // deletes source images, Bridge preparation records or task originals.
        loadNow();checkFile(file());Files.delete(file());return true;
    });}
    private void checkRoot(boolean create)throws IOException {
        Path cursor=root.getRoot();
        for(Path segment:root){cursor=cursor.resolve(segment);
            if(!Files.exists(cursor,LinkOption.NOFOLLOW_LINKS)){if(!create)return;Files.createDirectory(cursor);}
            if(!Files.isDirectory(cursor,LinkOption.NOFOLLOW_LINKS)||Files.isSymbolicLink(cursor)||!cursor.toRealPath().equals(cursor))throw new IOException("本机草稿目录必须是普通目录，不能是链接");
        }
    }
    private static void checkFile(Path file)throws IOException {
        if(!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)||Files.isSymbolicLink(file)||!file.toRealPath().equals(file)||Files.size(file)>MAX_BUNDLE_BYTES)throw new IOException("本机草稿文件无效或超限；原文件保留");
    }
    private Saved saveNow(ReferenceImageDraft draft,ReferenceImageDraft.Snapshot exact)throws Exception {
        if(!draft.current(exact))throw new IllegalStateException("图片编辑已变化；未保存旧草稿");
        checkRoot(true);if(Files.exists(file(),LinkOption.NOFOLLOW_LINKS))loadNow();
        var descriptor=new JsonObject();descriptor.addProperty("format","LocalReferenceImageDraft");descriptor.addProperty("version",1);descriptor.addProperty("mode",exact.mode());
        var photos=new JsonArray();
        for(int i=0;i<exact.photos().size();i++){
            var photo=exact.photos().get(i);var original=photo.source().originalBytes();var item=new JsonObject();item.addProperty("id",photo.id());item.addProperty("sourceEntry","images/"+i+".source");
            item.addProperty("sourceBytes",original.length);item.addProperty("sourceSha256",ContextReceipt.sha256(original));item.addProperty("outputSha256",ContextReceipt.sha256(photo.output().png()));item.addProperty("turns",photo.turns());item.add("annotation",photo.annotation());
            var crop=photo.crop();if(crop==null)item.add("crop",JsonNull.INSTANCE);else{var bounds=new JsonObject();bounds.addProperty("x",crop.x());bounds.addProperty("y",crop.y());bounds.addProperty("width",crop.width());bounds.addProperty("height",crop.height());item.add("crop",bounds);}photos.add(item);
        }
        descriptor.add("photos",photos);String hash=ContextReceipt.jsonHash(descriptor);descriptor.addProperty("descriptorHash",hash);
        byte[] json=descriptor.toString().getBytes(StandardCharsets.UTF_8);if(json.length>65536)throw new IOException("本机草稿描述超限");
        Path pending=Files.createTempFile(root,"reference-draft-",".pending");
        try {
            try(var channel=FileChannel.open(pending,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
                var zip=new ZipOutputStream(Channels.newOutputStream(channel));entry(zip,"draft.json",json);
                for(int i=0;i<exact.photos().size();i++)entry(zip,"images/"+i+".source",exact.photos().get(i).source().originalBytes());
                zip.finish();zip.flush();channel.force(true);
            }
            long bytes=Files.size(pending);if(bytes>MAX_BUNDLE_BYTES)throw new IOException("本机草稿包超限");
            draft.publishIfCurrent(exact,()->{checkRoot(false);if(Files.exists(file(),LinkOption.NOFOLLOW_LINKS))checkFile(file());Files.move(pending,file(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);});
            return new Saved(exact.photos().size(),bytes,hash);
        } finally {Files.deleteIfExists(pending);}
    }
    private static void entry(ZipOutputStream zip,String name,byte[] bytes)throws IOException {
        var entry=new ZipEntry(name);var crc=new CRC32();crc.update(bytes);entry.setMethod(ZipEntry.STORED);entry.setSize(bytes.length);entry.setCompressedSize(bytes.length);entry.setCrc(crc.getValue());zip.putNextEntry(entry);zip.write(bytes);zip.closeEntry();
    }
    private static byte[] next(ZipInputStream zip,String name,int maximum)throws IOException {
        var entry=zip.getNextEntry();if(entry==null||!entry.getName().equals(name)||entry.isDirectory()||entry.getMethod()!=ZipEntry.STORED||entry.getSize()<1||entry.getSize()>maximum||entry.getCompressedSize()!=entry.getSize())throw new IOException("本机草稿条目无效；不解包、不恢复原文件");
        byte[] bytes=zip.readNBytes((int)entry.getSize()+1);if(bytes.length!=entry.getSize())throw new IOException("本机草稿条目长度不符");zip.closeEntry();return bytes;
    }
    private Loaded loadNow()throws Exception {
        checkRoot(false);if(!Files.exists(file(),LinkOption.NOFOLLOW_LINKS))throw new IOException("尚无已保存的本机图片草稿");checkFile(file());
        try(var channel=Files.newByteChannel(file(),Set.of(StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS));var zip=new ZipInputStream(Channels.newInputStream(channel))){
            var descriptor=JsonParser.parseString(new String(next(zip,"draft.json",65536),StandardCharsets.UTF_8)).getAsJsonObject();
            fields(descriptor,"format","version","mode","photos","descriptorHash");String hash=text(descriptor,"descriptorHash");var content=descriptor.deepCopy();content.remove("descriptorHash");
            if(!"LocalReferenceImageDraft".equals(text(descriptor,"format"))||number(descriptor,"version",1,1)!=1||!ReferenceImageDraft.MODES.contains(text(descriptor,"mode"))||!hash.matches("[a-f0-9]{64}")||!ContextReceipt.jsonHash(content).equals(hash))throw new IOException("本机图片草稿版本或校验不符；原文件保留");
            var entries=descriptor.getAsJsonArray("photos");if(entries.size()<1||entries.size()>4)throw new IOException("本机草稿图片数量超限");
            var photos=new ArrayList<ReferenceImageDraft.Photo>();var ids=new HashSet<String>();
            for(int i=0;i<entries.size();i++){
                var item=entries.get(i).getAsJsonObject();fields(item,"id","sourceEntry","sourceBytes","sourceSha256","outputSha256","turns","annotation","crop");
                String id=text(item,"id"),name="images/"+i+".source";if(!UUID.fromString(id).toString().equals(id)||!ids.add(id)||!name.equals(text(item,"sourceEntry")))throw new IOException("本机草稿图片身份无效");
                byte[] original=next(zip,name,ReferenceImageNormalizer.MAX_SOURCE_BYTES);if(original.length!=number(item,"sourceBytes",8,ReferenceImageNormalizer.MAX_SOURCE_BYTES)||!ContextReceipt.sha256(original).equals(text(item,"sourceSha256")))throw new IOException("本机草稿原图校验失败");
                var source=new ReferenceImageDraft.Source(original);ReferenceImageNormalizer.Crop crop=null;
                if(!item.get("crop").isJsonNull()){var bounds=item.getAsJsonObject("crop");fields(bounds,"x","y","width","height");crop=new ReferenceImageNormalizer.Crop(number(bounds,"x",0,8191),number(bounds,"y",0,8191),number(bounds,"width",1,8192),number(bounds,"height",1,8192));}
                int turns=number(item,"turns",0,3);var output=source.transform(crop,turns);if(!ContextReceipt.sha256(output.png()).equals(text(item,"outputSha256")))throw new IOException("本机草稿实际输出像素身份不符");
                var annotation=item.getAsJsonObject("annotation");ReferenceImageDraft.validateAnnotation(annotation);photos.add(new ReferenceImageDraft.Photo(id,source,crop,turns,output,annotation));
            }
            if(zip.getNextEntry()!=null)throw new IOException("本机草稿含额外条目；原文件保留");
            new ReferenceImageDraft.Snapshot(UUID.randomUUID().toString(),0,text(descriptor,"mode"),photos); // enforce aggregate pixel/byte quotas
            return new Loaded(text(descriptor,"mode"),photos);
        }
    }
    private static void fields(JsonObject object,String... keys)throws IOException {if(!object.keySet().equals(Set.of(keys)))throw new IOException("本机草稿含未知字段；不恢复发送、任务或世界权限");}
    private static String text(JsonObject object,String key)throws IOException {var value=object.get(key);if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString())throw new IOException("本机草稿字段类型无效");return value.getAsString();}
    private static int number(JsonObject object,String key,int minimum,int maximum)throws IOException {
        var value=object.get(key);if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isNumber()||!value.getAsString().matches("[0-9]{1,10}"))throw new IOException("本机草稿数值无效");
        long number=value.getAsLong();if(number<minimum||number>maximum)throw new IOException("本机草稿数值超限");return (int)number;
    }
}
