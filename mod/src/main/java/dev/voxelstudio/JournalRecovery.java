package dev.voxelstudio;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Disk-only audit. Receipts describe logged writes, never proof of region-file durability. */
public final class JournalRecovery {
    public static final int MAX_BATCH_ENTRIES=512;
    public record Entry(long pos,String before,String after) {}
    public record Review(String id,JsonObject metadata,List<Entry> entries,int intentBatches,int missingReceipts,boolean undone,String issue) {
        public boolean needsReview(){return missingReceipts>0||issue!=null;}
    }
    private static JsonElement read(Path p)throws Exception {
        if(Files.size(p)>2*1024*1024)throw new IllegalStateException("Journal file quota exceeded");return JsonParser.parseString(Files.readString(p));
    }
    public static Review inspect(Path dir)throws Exception{
        JsonObject metadata=read(dir.resolve("metadata.json")).getAsJsonObject();int missing=0,batches=0;List<Entry> entries=new ArrayList<>();String issue=null;
        try{
            if(Files.exists(dir.resolve("operation.json")))metadata.add("recordedOutcome",read(dir.resolve("operation.json")));
            List<Path> files;try(var s=Files.list(dir)){files=s.filter(p->p.getFileName().toString().endsWith(".intent.json")).sorted().toList();}
            if(files.size()>20000)throw new IllegalStateException("Journal batch quota exceeded");Set<Long> positions=new HashSet<>();
            for(Path intent:files){
                if(!intent.getFileName().toString().matches("\\d{6}\\.intent\\.json"))throw new IllegalStateException("Invalid journal batch name");batches++;
                List<Entry> planned=decode(read(intent));Path receipt=intent.resolveSibling(intent.getFileName().toString().replace(".intent.json",".applied.json"));
                for(Entry e:planned)if(!positions.add(e.pos))throw new IllegalStateException("Duplicate journal position");
                if(positions.size()>1_000_000)throw new IllegalStateException("Recovery audit exceeds 1,000,000 direct changes; partitioned review required");
                if(!Files.exists(receipt)){missing++;continue;}
                List<Entry> applied=decode(read(receipt));int cursor=0;
                for(Entry e:applied){while(cursor<planned.size()&&!planned.get(cursor).equals(e))cursor++;if(cursor==planned.size())throw new IllegalStateException("Receipt does not match its write-ahead intent");cursor++;entries.add(e);}
            }
            try(var s=Files.list(dir)){for(Path receipt:s.filter(p->p.getFileName().toString().endsWith(".applied.json")).toList())if(!Files.exists(receipt.resolveSibling(receipt.getFileName().toString().replace(".applied.json",".intent.json"))))throw new IllegalStateException("Orphan application receipt");}
        }catch(Exception e){issue=e.getMessage();}
        return new Review(dir.getFileName().toString(),metadata,List.copyOf(entries),batches,missing,Files.exists(dir.resolve("undone.json")),issue);
    }
    private static List<Entry> decode(JsonElement json){
        JsonArray a=json.getAsJsonArray();if(a.size()>MAX_BATCH_ENTRIES)throw new IllegalStateException("Journal batch exceeds "+MAX_BATCH_ENTRIES+" entries");List<Entry> entries=new ArrayList<>();
        for(JsonElement value:a){JsonObject o=value.getAsJsonObject();String before=o.get("before").getAsString(),after=o.get("after").getAsString();if(before.length()>1024||after.length()>1024||!before.startsWith("minecraft:")||!after.startsWith("minecraft:"))throw new IllegalStateException("Invalid journal state");entries.add(new Entry(o.get("pos").getAsLong(),before,after));}return entries;
    }
    public static List<Review> list(Path root,String player,String dimension)throws Exception{
        if(!Files.isDirectory(root))return List.of();List<Path> dirs;try(var s=Files.list(root)){dirs=s.filter(Files::isDirectory).filter(p->p.getFileName().toString().matches("[0-9a-f-]{36}")).sorted(Comparator.comparingLong((Path p)->p.toFile().lastModified()).reversed()).limit(1000).toList();}
        List<Review> result=new ArrayList<>();int retained=0;for(Path dir:dirs){
            try{Review r=inspect(dir);if(player.equals(r.metadata.get("player").getAsString())&&dimension.equals(r.metadata.get("dimension").getAsString())){result.add(r);retained+=r.entries.size();}}
            catch(Exception e){result.add(new Review(dir.getFileName().toString(),new JsonObject(),List.of(),0,0,false,"Metadata unreadable; ownership cannot be established"));}
            if(result.size()>=100||retained>=1_000_000)break;
        }return result;
    }
}
