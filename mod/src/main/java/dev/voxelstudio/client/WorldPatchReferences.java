package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

/** Immutable local references for future explicit sends and receipt queries.
 * No adapter, submit, retry, world or permission API. A reference is NOT a
 * reservation/consent. Never delete history or adopt incomplete pending files. */
final class WorldPatchReferences {
    private final Path data,root;
    WorldPatchReferences(Path data){this.data=data.toAbsolutePath().normalize();root=this.data.resolve("world-patch-references");}
    private static void directory(Path path)throws IOException{
        var facts=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!facts.isDirectory()||facts.isSymbolicLink()||facts.isOther()||!path.toRealPath().equals(path))throw new IOException("Patch reference directory link/type rejected");
    }
    private void directories(boolean create)throws IOException{
        Path current=root.getRoot();directory(current);
        for(var part:root){current=current.resolve(part);
            if(create&&current.startsWith(data))try{Files.createDirectory(current);}catch(FileAlreadyExistsException ignored){}
            directory(current);
        }
    }
    private Path file(String id){if(id==null||!id.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid exact patch reference hash");return root.resolve(id+".json");}
    private static byte[] bytes(Path path)throws IOException{
        var facts=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!facts.isRegularFile()||facts.isSymbolicLink()||facts.isOther()||facts.size()>16384)throw new IOException("Patch reference file link/type/quota rejected");
        try(var channel=FileChannel.open(path,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
            var buffer=ByteBuffer.allocate(16385);while(buffer.hasRemaining()&&channel.read(buffer)>=0){}
            if(buffer.position()>16384)throw new IOException("Patch reference grew beyond quota");return Arrays.copyOf(buffer.array(),buffer.position());
        }
    }
    private JsonObject readAt(String id)throws IOException{
        try{
            String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes(file(id)))).toString();
            var envelope=WorldPatchCandidateReceipt.strictJson(json,()->false).getAsJsonObject();
            if(!envelope.keySet().equals(Set.of("format","version","createdAt","reference","sha256"))||!envelope.get("format").isJsonPrimitive()||!envelope.get("format").getAsJsonPrimitive().isString()
                ||!envelope.get("format").getAsString().equals("SavedWorldPatchReference")||!envelope.get("version").isJsonPrimitive()||!envelope.get("version").getAsJsonPrimitive().isNumber()||!envelope.get("version").getAsString().equals("1")
                ||!envelope.get("createdAt").isJsonPrimitive()||!envelope.get("createdAt").getAsJsonPrimitive().isNumber()||!envelope.get("createdAt").getAsString().matches("[0-9]+"))throw new IllegalStateException("Invalid saved patch reference envelope");
            long created=envelope.get("createdAt").getAsLong();if(created<=0||created>System.currentTimeMillis()+10000)throw new IllegalStateException("Invalid saved patch reference time");
            var content=envelope.deepCopy();content.remove("sha256");if(!ContextReceipt.jsonHash(content).equals(envelope.get("sha256").getAsString()))throw new IllegalStateException("Saved patch reference hash changed");
            var reference=WorldPatchJobReceipt.verifyReference(envelope.getAsJsonObject("reference"));if(!id.equals(reference.get("capsuleId").getAsString()))throw new IllegalStateException("Saved patch reference identity changed");return reference;
        }catch(RuntimeException error){throw new IOException("Saved patch reference rejected; preserved, never resubmitted",error);}
    }
    private List<String> names()throws IOException{
        try(var entries=Files.list(root)){var result=entries.limit(9).map(p->p.getFileName().toString()).toList();
            if(result.size()>8)throw new IOException("Patch reference history exceeds quota; preserved");
            for(var name:result){if(!name.matches("[a-f0-9]{64}\\.json|\\.pending-[a-f0-9-]{36}\\.json"))throw new IOException("Unknown reference history entry preserved");bytes(root.resolve(name));}
            return result;
        }
    }
    synchronized JsonObject remember(JsonObject input)throws IOException{
        var reference=WorldPatchJobReceipt.verifyReference(input.deepCopy());String id=reference.get("capsuleId").getAsString();directories(true);
        try{var previous=readAt(id);if(!previous.equals(reference))throw new IOException("Original patch reference cannot be rebound");return previous;}catch(NoSuchFileException absent){}
        if(names().size()>=8)throw new IOException("Patch reference history quota reached; no record evicted");
        var content=new JsonObject();content.addProperty("format","SavedWorldPatchReference");content.addProperty("version",1);content.addProperty("createdAt",System.currentTimeMillis());content.add("reference",reference);
        var envelope=content.deepCopy();envelope.addProperty("sha256",ContextReceipt.jsonHash(content));byte[] payload=ContextReceipt.canonicalJson(envelope).getBytes(StandardCharsets.UTF_8);
        if(payload.length>16384)throw new IOException("Patch reference quota exceeded before write");
        Path pending=root.resolve(".pending-"+UUID.randomUUID()+".json"),target=file(id);
        try(var channel=FileChannel.open(pending,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
            var buffer=ByteBuffer.wrap(payload);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
        }
        directory(root);bytes(pending);
        // No REPLACE_EXISTING. A failed move retains the complete pending file;
        // no model call is permitted as a fallback for local publication error.
        Files.move(pending,target);return readAt(id);
    }
    /** A saved reference suppresses every later submit, including after a
     * restart or a local/HTTP failure. Absence of a server receipt is not
     * evidence that a model call can safely be repeated. */
    synchronized boolean claim(JsonObject input)throws IOException{
        var reference=WorldPatchJobReceipt.verifyReference(input.deepCopy());String id=reference.get("capsuleId").getAsString();directories(true);
        try{if(!readAt(id).equals(reference))throw new IOException("Original patch reference cannot be rebound");return false;}catch(NoSuchFileException absent){}
        remember(reference);return true;
    }
    synchronized JsonObject read(String id)throws IOException{file(id);directories(false);return readAt(id).deepCopy();}
    synchronized List<JsonObject> list()throws IOException{
        try{directories(false);}catch(NoSuchFileException absent){return List.of();}
        var result=new ArrayList<JsonObject>();for(var name:names())if(!name.startsWith(".pending-"))result.add(readAt(name.substring(0,64)).deepCopy());return List.copyOf(result);
    }
}
