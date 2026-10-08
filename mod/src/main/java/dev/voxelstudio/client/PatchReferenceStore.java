package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

/** Disk facts only. Fixed lanes share IO, never consent or dispatch rights. */
final class PatchReferenceStore {
    enum Lane {
        TEXT("world-patch-references","SavedWorldPatchReference") {
            JsonObject verify(JsonObject value){return WorldPatchJobReceipt.verifyReference(value);}
        },
        REFERENCE("reference-world-patch-references","SavedReferenceWorldPatchReference") {
            JsonObject verify(JsonObject value){return ReferenceWorldPatchJobReceipt.verifyReference(value);}
        },
        ASSEMBLY("reference-world-assembly-references","SavedReferenceWorldAssemblyReference","preparationHash",65536) {
            JsonObject verify(JsonObject value){return ReferenceWorldAssemblyReceipt.verifyReference(value);}
        };
        final String directory,format,identityKey;
        final int maximumBytes;
        Lane(String directory,String format){this(directory,format,"capsuleId",16384);}
        Lane(String directory,String format,String identityKey,int maximumBytes){this.directory=directory;this.format=format;this.identityKey=identityKey;this.maximumBytes=maximumBytes;}
        abstract JsonObject verify(JsonObject value);
    }
    private static final int MAX_RECORDS=8;
    private final Path data,root;
    private final Lane lane;
    PatchReferenceStore(Path data,Lane lane){this.data=data.toAbsolutePath().normalize();this.lane=Objects.requireNonNull(lane);root=this.data.resolve(lane.directory);}
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
    private byte[] bytes(Path path)throws IOException{
        var facts=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!facts.isRegularFile()||facts.isSymbolicLink()||facts.isOther()||facts.size()>lane.maximumBytes)throw new IOException("Patch reference file link/type/quota rejected");
        try(var channel=FileChannel.open(path,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){
            var buffer=ByteBuffer.allocate(lane.maximumBytes+1);while(buffer.hasRemaining()&&channel.read(buffer)>=0){}
            if(buffer.position()>lane.maximumBytes)throw new IOException("Patch reference grew beyond quota");return Arrays.copyOf(buffer.array(),buffer.position());
        }
    }
    private JsonObject readAt(String id)throws IOException{
        try{
            String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes(file(id)))).toString();
            var envelope=WorldPatchCandidateReceipt.strictJson(json,()->false).getAsJsonObject();
            WorldPatchTaskReceipt.keys(envelope,"format","version","createdAt","reference","sha256");
            if(!WorldPatchTaskReceipt.text(envelope,"format").equals(lane.format)||WorldPatchTaskReceipt.number(envelope,"version")!=1)throw new IllegalStateException("Invalid saved patch reference lane/version");
            long created=WorldPatchTaskReceipt.number(envelope,"createdAt");if(created<=0||created>System.currentTimeMillis()+10000)throw new IllegalStateException("Invalid saved patch reference time");
            WorldPatchTaskReceipt.digest(envelope,"sha256");var content=envelope.deepCopy();content.remove("sha256");
            if(!ContextReceipt.jsonHash(content).equals(WorldPatchTaskReceipt.text(envelope,"sha256")))throw new IllegalStateException("Saved patch reference hash changed");
            var reference=lane.verify(envelope.getAsJsonObject("reference"));if(!id.equals(WorldPatchTaskReceipt.text(reference,lane.identityKey)))throw new IllegalStateException("Saved patch reference identity changed");return reference;
        }catch(RuntimeException error){throw new IOException("Saved patch reference rejected; preserved, never resubmitted",error);}
    }
    private List<String> names()throws IOException{
        try(var entries=Files.list(root)){var result=entries.limit(MAX_RECORDS+1).map(p->p.getFileName().toString()).toList();
            if(result.size()>MAX_RECORDS)throw new IOException("Patch reference history exceeds quota; preserved");
            for(var name:result){if(!name.matches("[a-f0-9]{64}\\.json|\\.pending-(?:[a-f0-9-]{36}|[a-f0-9]{64})\\.json"))throw new IOException("Unknown reference history entry preserved");bytes(root.resolve(name));}
            return result;
        }
    }
    /** Only completion of THIS call's CREATE_NEW + move + exact read owns
     * publication. Finding another store's original is observation, not SEND. */
    private record Publication(JsonObject reference,boolean created){}
    private Publication publish(JsonObject input)throws IOException{
        var reference=lane.verify(input.deepCopy());String id=WorldPatchTaskReceipt.text(reference,lane.identityKey);directories(true);
        try{var previous=readAt(id);if(!previous.equals(reference))throw new IOException("Original patch reference cannot be rebound");return new Publication(previous,false);}catch(NoSuchFileException absent){}
        var names=names();
        // Complete pending bytes are not successful local publication. Keep
        // them, but never create a new dispatch claim beside uncertain history.
        if(names.stream().anyMatch(name->name.startsWith(".pending-")))throw new IOException("Unpublished patch reference preserved; new claims disabled");
        if(names.size()>=MAX_RECORDS)throw new IOException("Patch reference history quota reached; no record evicted");
        var content=new JsonObject();content.addProperty("format",lane.format);content.addProperty("version",1);content.addProperty("createdAt",System.currentTimeMillis());content.add("reference",reference);
        var envelope=content.deepCopy();envelope.addProperty("sha256",ContextReceipt.jsonHash(content));byte[] payload=ContextReceipt.canonicalJson(envelope).getBytes(StandardCharsets.UTF_8);
        if(payload.length>lane.maximumBytes)throw new IOException("Patch reference quota exceeded before write");
        // CREATE_NEW on an ID-keyed pending path arbitrates separate store
        // instances/processes before the move, including on POSIX filesystems.
        Path pending=root.resolve(".pending-"+id+".json"),target=file(id);
        try(var channel=FileChannel.open(pending,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){
            var buffer=ByteBuffer.wrap(payload);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);
        }
        directory(root);bytes(pending);
        // No replacement, cleanup or retry inferred from a missing receipt.
        // A failed publication keeps its pending evidence and never dispatches.
        Files.move(pending,target);return new Publication(readAt(id),true);
    }
    synchronized JsonObject remember(JsonObject input)throws IOException{return publish(input).reference();}
    synchronized boolean claim(JsonObject input)throws IOException{
        // No read-missing/remember/return-true gap: remember can observe a
        // concurrent publisher and must not promote that read to ownership.
        return publish(input).created();
    }
    synchronized JsonObject read(String id)throws IOException{file(id);directories(false);return readAt(id).deepCopy();}
    synchronized List<JsonObject> list()throws IOException{
        try{directories(false);}catch(NoSuchFileException absent){return List.of();}
        var result=new ArrayList<JsonObject>();for(var name:names())if(!name.startsWith(".pending-"))result.add(readAt(name.substring(0,64)).deepCopy());return List.copyOf(result);
    }
}
