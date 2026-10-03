package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.concurrent.*;

/** Versioned local state. Callers receive errors; no swallowed persistence failures. */
public final class StudioStateStore {
    private static final ExecutorService IO=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"voxel-state-io");t.setDaemon(true);return t;});
    static {Runtime.getRuntime().addShutdownHook(new Thread(()->{IO.shutdown();try{IO.awaitTermination(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}},"voxel-state-flush"));}
    private final Path root;
    public StudioStateStore(Path root){this.root=root;}
    private static <T> CompletableFuture<T> work(Callable<T> action){return CompletableFuture.supplyAsync(()->{try{return action.call();}catch(Exception e){throw new CompletionException(e);}},IO);}
    static void atomic(Path file,JsonObject value)throws Exception{
        Files.createDirectories(file.getParent());Path temp=Files.createTempFile(file.getParent(),file.getFileName().toString(),".tmp");
        try{
            byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);
            try(var ch=FileChannel.open(temp,StandardOpenOption.WRITE)){var b=java.nio.ByteBuffer.wrap(bytes);while(b.hasRemaining())ch.write(b);ch.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }finally{Files.deleteIfExists(temp);}
    }
    static JsonObject read(Path file)throws Exception{
        if(!Files.exists(file))return null;
        if(Files.size(file)>65536)throw new IllegalStateException("State file too large; original preserved");
        JsonObject o=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if(o.has("schemaVersion")&&o.get("schemaVersion").getAsInt()!=1)throw new IllegalStateException("Unsupported state version; original preserved");return o;
    }
    public CompletableFuture<JsonObject> task(){return work(()->read(root.resolve("active-task.json")));}
    public CompletableFuture<Void> task(JsonObject state){JsonObject copy=state.deepCopy();copy.addProperty("schemaVersion",1);return work(()->{atomic(root.resolve("active-task.json"),copy);return null;});}
    public CompletableFuture<Void> archiveTask(JsonObject state){JsonObject copy=state.deepCopy();return work(()->{copy.addProperty("state","archived-unknown");copy.addProperty("schemaVersion",1);atomic(root.resolve("task-archive").resolve(java.util.UUID.randomUUID()+".json"),copy);atomic(root.resolve("active-task.json"),copy);return null;});}
    private Path scope(String world)throws Exception{return root.resolve("drafts-v1").resolve(Asset.sha(world.getBytes(StandardCharsets.UTF_8)));}
    public CompletableFuture<Void> saveDraft(JsonObject draft){JsonObject copy=draft.deepCopy();copy.addProperty("schemaVersion",1);return work(()->{
        validateDraft(copy);Path folder=scope(copy.get("world").getAsString());atomic(folder.resolve(copy.get("job").getAsString()+".json"),copy);atomic(folder.resolve("latest.json"),copy);return null;
    });}
    public CompletableFuture<JsonObject> draft(String world,Path legacy){return work(()->{
        JsonObject d=read(scope(world).resolve("latest.json"));
        if(d==null&&Files.exists(legacy)){d=read(legacy);if(d==null||!world.equals(d.get("world").getAsString()))throw new IllegalStateException("旧草稿不属于当前世界/维度；原文件保留，未迁移");d.addProperty("legacy",true);}
        if(d==null)throw new IllegalStateException("当前世界和维度没有已保存草稿");validateDraft(d);if(!world.equals(d.get("world").getAsString()))throw new IllegalStateException("草稿归属不匹配");return d;
    });}
    static void validateDraft(JsonObject d){
        if(!d.get("job").getAsString().matches("[0-9a-f-]{36}")||!d.get("hash").getAsString().matches("[0-9a-f]{64}")||d.get("world").getAsString().equals("none"))throw new IllegalArgumentException("Invalid draft identity");
        for(String k:new String[]{"x","y","z"}){long n=d.get(k).getAsLong();if(n<Integer.MIN_VALUE||n>Integer.MAX_VALUE||!d.get(k).getAsString().matches("-?\\d+"))throw new IllegalArgumentException("Invalid draft coordinate");}
        int r=d.get("rotation").getAsInt();if(r<0||r>3)throw new IllegalArgumentException("Invalid draft rotation");d.get("mirror").getAsBoolean();
    }
}
