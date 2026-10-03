package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

/** Immutable original action intents, published BEFORE any storage POST.
 * No network, retry, model, world or cleanup API. Incomplete and foreign
 * records remain on disk and block publication rather than being evicted. */
final class ReferenceArchiveActions {
    static final int MAX_RECORDS=512,MAX_BYTES=131072;
    private final Path data,root;
    ReferenceArchiveActions(Path data){this.data=data.toAbsolutePath().normalize();root=this.data.resolve("client-state/reference-archive-actions-v1");}
    private static void directory(Path path)throws IOException{
        var a=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!a.isDirectory()||a.isSymbolicLink()||a.isOther()||!path.toRealPath().equals(path))throw new IOException("归档操作目录重定向或类型无效；原记录保留");
    }
    private void directories(boolean create)throws IOException{
        Path current=root.getRoot();directory(current);
        for(var part:root){current=current.resolve(part);if(create&&current.startsWith(data))try{Files.createDirectory(current);}catch(FileAlreadyExistsException ignored){}directory(current);}
    }
    private Path file(String id){ReferenceArchiveReceipt.owner(id);return root.resolve(id+".json");}
    private static byte[] bytes(Path path)throws IOException{
        var a=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!a.isRegularFile()||a.isSymbolicLink()||a.isOther()||a.size()<1||a.size()>MAX_BYTES)throw new IOException("归档操作记录类型或大小无效；原记录保留");
        if(Files.getFileStore(path).supportsFileAttributeView("unix")&&((Number)Files.getAttribute(path,"unix:nlink",LinkOption.NOFOLLOW_LINKS)).longValue()!=1)throw new IOException("归档操作硬链接拒绝");
        try(var channel=FileChannel.open(path,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
            var b=ByteBuffer.allocate(MAX_BYTES+1);while(b.hasRemaining()&&channel.read(b)>=0){}
            if(b.position()>MAX_BYTES)throw new IOException("归档操作记录增长超限");return Arrays.copyOf(b.array(),b.position());
        }
    }
    private JsonObject readAt(String id)throws IOException{
        try{
            String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes(file(id)))).toString();
            var envelope=WorldPatchCandidateReceipt.strictJson(text,()->Thread.currentThread().isInterrupted()).getAsJsonObject();
            ReferencePreparationReceipt.keys(envelope,"format","version","createdAt","reference","sha256");ReferencePreparationReceipt.hash(envelope,"sha256");
            var content=envelope.deepCopy();content.remove("sha256");
            if(!ContextReceipt.jsonHash(content).equals(ReferencePreparationReceipt.text(envelope,"sha256")))
                throw new IllegalStateException("原操作内容校验失败；保留、不重建或发送替代操作");
            if(!ReferencePreparationReceipt.text(envelope,"format").equals("SavedReferenceArchiveAction")||ReferencePreparationReceipt.number(envelope,"version")!=1)throw new IllegalStateException("原操作保存格式不支持");
            long created=ReferencePreparationReceipt.number(envelope,"createdAt");if(created<1||created>System.currentTimeMillis()+10000)throw new IllegalStateException("原操作时间不符");
            var reference=ReferenceArchiveReceipt.verifyActionReference(envelope.getAsJsonObject("reference"));
            if(!id.equals(ReferencePreparationReceipt.text(reference,"actionId")))throw new IllegalStateException("原操作编号被改变");return reference;
        }catch(RuntimeException e){throw new IOException("归档原操作不可核验；保留、不重建或自动继续",e);}
    }
    private List<String> names()throws IOException{
        try(var entries=Files.list(root)){
            var names=entries.limit(MAX_RECORDS+1L).map(p->p.getFileName().toString()).toList();
            if(names.size()>MAX_RECORDS)throw new IOException("原操作记录超出配额；不清除历史");
            for(var name:names){
                if(!name.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\.json|\\.pending-[a-f0-9-]{36}\\.json"))throw new IOException("未知原操作文件保留");
                bytes(root.resolve(name));
                if(name.startsWith(".pending-"))throw new IOException("存在未发布的原操作；核对原记录前不创建替代操作");
                readAt(name.substring(0,name.length()-5));
            }
            return names;
        }
    }
    synchronized JsonObject remember(JsonObject input)throws IOException{
        var reference=ReferenceArchiveReceipt.verifyActionReference(input.deepCopy());String id=ReferencePreparationReceipt.text(reference,"actionId");directories(true);
        var names=names();
        if(names.contains(id+".json")){var previous=readAt(id);if(!previous.equals(reference))throw new IOException("原操作不可改绑到另一个草稿、范围或目的");return previous.deepCopy();}
        if(names.size()>=MAX_RECORDS)throw new IOException("原操作记录已满；未移除任何历史");
        var envelope=new JsonObject();envelope.addProperty("format","SavedReferenceArchiveAction");envelope.addProperty("version",1);envelope.addProperty("createdAt",System.currentTimeMillis());envelope.add("reference",reference);
        envelope.addProperty("sha256",ContextReceipt.jsonHash(envelope));byte[] payload=ContextReceipt.canonicalJson(envelope).getBytes(StandardCharsets.UTF_8);
        if(payload.length>MAX_BYTES)throw new IOException("原操作写入超限；不会发送 POST");
        Path pending=root.resolve(".pending-"+UUID.randomUUID()+".json");
        try(var channel=FileChannel.open(pending,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
            var b=ByteBuffer.wrap(payload);while(b.hasRemaining())channel.write(b);channel.force(true);
        }
        directory(root);if(!Arrays.equals(bytes(pending),payload))throw new IOException("未发布原操作字节发生变化；原文件保留");
        Files.move(pending,file(id)); // No overwrite, recursive deletion or fresh-ID fallback.
        return readAt(id).deepCopy();
    }
    synchronized JsonObject read(String id)throws IOException{file(id);directories(false);return readAt(id).deepCopy();}
    synchronized boolean claim(JsonObject input)throws IOException{
        var exact=ReferenceArchiveReceipt.verifyActionReference(input.deepCopy());String id=ReferencePreparationReceipt.text(exact,"actionId");directories(true);
        if(names().contains(id+".json")){if(!readAt(id).equals(exact))throw new IOException("原操作不可改绑");return false;}
        remember(exact);return true;
    }
    synchronized List<JsonObject> list()throws IOException{
        try{directories(false);}catch(NoSuchFileException absent){return List.of();}
        var result=new ArrayList<JsonObject>();for(var name:names())result.add(readAt(name.substring(0,name.length()-5)).deepCopy());
        result.sort(Comparator.comparing(r->ReferencePreparationReceipt.text(r,"actionId")));return List.copyOf(result);
    }
}
