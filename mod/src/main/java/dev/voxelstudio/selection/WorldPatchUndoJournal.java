package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Disk-worker only. Separate one-use undo log of a SEALED native prefix.
 * Recovery is read-only, never an undo Source or world-write capability.
 * The original apply archive must remain an unmodified physical sibling. */
final class WorldPatchUndoJournal {
    enum Disposition { RESTORED,PRESERVED_TARGET,PRESERVED_NEIGHBOR }
    record Entry(WorldPatchCompiler.Write write,Disposition disposition){Entry{Objects.requireNonNull(write);Objects.requireNonNull(disposition);}}
    static final class Plan {
        private final UUID id;private final WorldPatchExecution.UndoOrigin origin;private final List<WorldPatchCompiler.Write> writes;private final byte[] bytes;private final String hash;
        private Plan(WorldPatchExecution.UndoOrigin origin){
            this.origin=origin;id=UUID.randomUUID();var inverted=new ArrayList<WorldPatchCompiler.Write>();for(int i=origin.prefix().size()-1;i>=0;i--){var w=origin.prefix().get(i);inverted.add(inverse(w));}writes=List.copyOf(inverted);
            var v=new JsonObject();v.addProperty("format","WorldPatchUndoPlan");v.addProperty("version",1);v.addProperty("id",id.toString());v.addProperty("player",origin.plan().player().toString());v.addProperty("parentId",origin.plan().id().toString());v.addProperty("parentPlanHash",origin.plan().hash());v.addProperty("originalConfirmedWrites",origin.prefix().size());v.addProperty("order","reverse-original-confirmed-prefix");v.addProperty("canAuthorizePlacement",false);v.addProperty("worldDurabilityVerified",false);v.addProperty("crashAtomicPublication",false);hash=SelectionBaseline.hash(v);v.addProperty("planHash",hash);bytes=v.toString().getBytes(StandardCharsets.UTF_8);
        }
        UUID id(){return id;}String hash(){return hash;}WorldPatchJournal.Plan original(){return origin.plan();}List<WorldPatchCompiler.Write> writes(){return writes;}
        boolean canAuthorizePlacement(){return false;}
        private void verify(Path directory)throws IOException{
            WorldPatchJournalFiles.directory(directory);if(!directory.getFileName().toString().equals(id.toString())||!directory.getParent().equals(origin.archive().getParent())||!Arrays.equals(bytes,WorldPatchJournalFiles.read(directory.resolve("plan.json"),WorldPatchJournal.METADATA)))throw new IOException("Original undo plan/path changed; no replay");
            origin.plan().verifyArchive(origin.archive());var original=WorldPatchJournal.inspect(origin.archive());
            if(original.needsReview()||!origin.plan().hash().equals(original.planHash())||!origin.prefix().equals(original.confirmed()))throw new IOException("Original sealed receipts changed/ambiguous; no undo");
        }
    }
    static final class Intent {
        private final Live owner;private final int index,offset;private final List<WorldPatchCompiler.Write> writes;
        private Intent(Live l,int i,int o,List<WorldPatchCompiler.Write> rows){owner=l;index=i;offset=o;writes=List.copyOf(rows);}
        List<WorldPatchCompiler.Write> writes(){return writes;}int offset(){return offset;}boolean belongs(Plan p){return owner.plan==p;}
    }
    static final class Live {
        private final Path directory;private final Plan plan;private int cursor,batches,restored,preserved;private boolean broken,finished;private Intent pending;private WorldPatchJournal.ReceiptState stop;
        private final Map<String,String> published=new LinkedHashMap<>();
        private Live(Path d,Plan p){directory=d;plan=p;}
        Path directory(){return directory;}Plan plan(){return plan;}
        private void available()throws IOException{if(broken||finished)throw new IOException("Undo closed/uncertain; no replay");}
        private void verify()throws IOException{
            plan.verify(directory);int count=0;try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){count++;var name=file.getFileName().toString();if(name.equals("plan.json"))continue;var expected=published.get(name);if(expected==null||!expected.equals(digest(WorldPatchJournalFiles.read(file,WorldPatchJournal.SMALL))))throw new IOException("Prior/unknown undo event changed; preserved");}}
            if(count!=1+published.size())throw new IOException("Original undo event missing; preserved");
        }
        private void persist(String name,JsonObject value)throws IOException{var raw=eventBytes(value);WorldPatchJournalFiles.publish(directory.resolve(name),raw,WorldPatchJournal.SMALL);published.put(name,digest(raw));}
        synchronized Intent intent()throws IOException{
            available();if(pending!=null||stop!=null||cursor==plan.writes.size())throw new IOException("No new undo intent after pending/stopped/completed operation");
            try{verify();var i=new Intent(this,++batches,cursor,plan.writes.subList(cursor,Math.min(cursor+WorldPatchJournal.BATCH,plan.writes.size())));persist(name(i.index,"intent"),event(plan,i,"WorldPatchUndoIntent",null,null));pending=i;return i;}catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void evaluated(Intent i,List<Entry> entries,WorldPatchJournal.ReceiptState state)throws IOException{
            available();if(i==null||i.owner!=this||pending!=i||state==null)throw new IOException("Original pending undo intent required");var rows=List.copyOf(entries);
            if(rows.size()>i.writes.size()||state==WorldPatchJournal.ReceiptState.COMPLETE&&rows.size()!=i.writes.size()||state!=WorldPatchJournal.ReceiptState.COMPLETE&&rows.size()==i.writes.size())throw new IOException("Undo receipt closure must match exact evaluated prefix");
            for(int n=0;n<rows.size();n++)if(!rows.get(n).write.equals(i.writes.get(n)))throw new IOException("Undo evaluated prefix/order differs");
            try{verify();if(!event(plan,i,"WorldPatchUndoIntent",null,null).equals(readEvent(directory.resolve(name(i.index,"intent")))))throw new IOException("Original undo intent changed");
                persist(name(i.index,"evaluated"),event(plan,i,"WorldPatchUndoEvaluatedPrefix",rows,state));cursor+=rows.size();for(var row:rows)if(row.disposition==Disposition.RESTORED)restored++;else preserved++;pending=null;if(state!=WorldPatchJournal.ReceiptState.COMPLETE)stop=state;
            }catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void finish(WorldPatchJournal.Outcome outcome)throws IOException{
            available();if(pending!=null||outcome==null||outcome==WorldPatchJournal.Outcome.COMPLETED&&(cursor!=plan.writes.size()||stop!=null)||stop!=null&&!stop.name().equals(outcome.name()))throw new IOException("Cannot seal pending/mismatched undo");
            try{verify();var v=new JsonObject();v.addProperty("format","WorldPatchUndoOutcome");v.addProperty("version",1);v.addProperty("id",plan.id.toString());v.addProperty("planHash",plan.hash);v.addProperty("outcome",outcome.name());v.addProperty("batches",batches);v.addProperty("evaluated",cursor);v.addProperty("restored",restored);v.addProperty("preserved",preserved);v.addProperty("worldDurabilityVerified",false);persist("outcome.json",v);finished=true;}catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void ambiguous(Intent i,String why)throws IOException{
            available();if(i==null||pending!=i||i.owner!=this)throw new IOException("Exact uncertain undo intent required");broken=true;var v=new JsonObject();v.addProperty("format","WorldPatchUndoAmbiguous");v.addProperty("version",1);v.addProperty("id",plan.id.toString());v.addProperty("planHash",plan.hash);v.addProperty("index",i.index);String reason=String.valueOf(why);v.addProperty("reason",reason.substring(0,Math.min(1024,reason.length())));persist("ambiguous.json",v);
        }
    }
    static Live create(Path root,WorldPatchExecution.UndoOrigin origin)throws IOException{
        Objects.requireNonNull(origin);origin.claim();root=root.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(root);origin.plan().verifyArchive(origin.archive());
        var report=WorldPatchJournal.inspect(origin.archive());if(!root.equals(origin.archive().getParent())||report.needsReview()||!report.planHash().equals(origin.plan().hash())||!report.confirmed().equals(origin.prefix()))throw new IOException("Unmodified original sealed sibling archive required");
        var p=new Plan(origin);var directory=root.resolve(p.id.toString());Files.createDirectory(directory);WorldPatchJournalFiles.publish(directory.resolve("plan.json"),p.bytes,WorldPatchJournal.METADATA);p.verify(directory);return new Live(directory,p);
    }
    record Review(UUID id,String planHash,UUID parentId,String parentPlanHash,List<Entry> evaluated,int missingReceipts,WorldPatchJournal.Outcome outcome,String issue){
        Review{evaluated=List.copyOf(evaluated);}boolean needsReview(){return issue!=null||missingReceipts!=0||outcome==null;}boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    static Review inspect(Path directory){
        UUID id=null,parentId=null;String planHash=null,parentHash=null;var evaluated=new ArrayList<Entry>();int missing=0;WorldPatchJournal.Outcome outcome=null;
        try{
            directory=directory.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(directory);var v=WorldPatchJson.parse(WorldPatchJournalFiles.read(directory.resolve("plan.json"),WorldPatchJournal.METADATA),()->false);
            WorldPatchJson.keys(v,"format","version","id","player","parentId","parentPlanHash","originalConfirmedWrites","order","canAuthorizePlacement","worldDurabilityVerified","crashAtomicPublication","planHash");eq(v,"format","WorldPatchUndoPlan");WorldPatchJson.integer(v.get("version"),1,1);id=uuid(v.get("id"));uuid(v.get("player"));parentId=uuid(v.get("parentId"));if(!directory.getFileName().toString().equals(id.toString())||id.equals(parentId))throw new IOException("Undo identity/path/parent differs");
            for(var field:List.of("canAuthorizePlacement","worldDurabilityVerified","crashAtomicPublication"))falseFlag(v,field);eq(v,"order","reverse-original-confirmed-prefix");planHash=WorldPatchJson.text(v.get("planHash"));var content=v.deepCopy();content.remove("planHash");if(!planHash.equals(SelectionBaseline.hash(content)))throw new IOException("Undo plan integrity differs");parentHash=WorldPatchJson.text(v.get("parentPlanHash"));
            var parent=WorldPatchJournal.inspect(directory.getParent().resolve(parentId.toString()));int count=(int)WorldPatchJson.integer(v.get("originalConfirmedWrites"),1,SelectionLimits.editCells());
            if(parent.needsReview()||!parentHash.equals(parent.planHash())||parent.confirmed().size()!=count||!parent.player().toString().equals(WorldPatchJson.text(v.get("player"))))throw new IOException("Original apply journal not sealed or differs");
            var writes=new ArrayList<WorldPatchCompiler.Write>();for(int n=count-1;n>=0;n--)writes.add(inverse(parent.confirmed().get(n)));
            var names=new TreeSet<String>();int limit=3+2*((count+WorldPatchJournal.BATCH-1)/WorldPatchJournal.BATCH);try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){if(names.size()>=limit)throw new IOException("Undo member quota exceeded");names.add(file.getFileName().toString());}}
            for(var name:names)if(!Set.of("plan.json","outcome.json","ambiguous.json").contains(name)&&!name.matches("[0-9]{6}\\.(intent|evaluated)\\.json"))throw new IOException("Unknown/partial undo member; preserved");
            int batches=0,offset=0,restored=0,preserved=0;WorldPatchJournal.ReceiptState stop=null;
            for(var file:names.stream().filter(n->n.endsWith(".intent.json")).toList()){
                batches++;if(!file.equals(name(batches,"intent"))||missing!=0||stop!=null)throw new IOException("Undo order/resume after unresolved stop rejected");var intent=readEvent(directory.resolve(file));validate(intent,"WorldPatchUndoIntent",id,planHash,batches,offset,false);var planned=intent.getAsJsonArray("writes");int expected=Math.min(WorldPatchJournal.BATCH,writes.size()-offset);if(expected<1||planned.size()!=expected)throw new IOException("Undo fixed batch quota differs");for(int n=0;n<planned.size();n++)if(!writeJson(writes.get(offset+n)).equals(planned.get(n)))throw new IOException("Undo intent differs from original confirmed inverse");
                var receipt=name(batches,"evaluated");if(!names.contains(receipt)){missing++;continue;}var logged=readEvent(directory.resolve(receipt));validate(logged,"WorldPatchUndoEvaluatedPrefix",id,planHash,batches,offset,true);var rows=logged.getAsJsonArray("entries");stop=WorldPatchJournal.ReceiptState.valueOf(WorldPatchJson.text(logged.get("state")));if(rows.size()>planned.size()||(stop==WorldPatchJournal.ReceiptState.COMPLETE?rows.size()!=planned.size():rows.size()==planned.size()))throw new IOException("Undo exact prefix closure differs");
                for(int n=0;n<rows.size();n++){var row=rows.get(n).getAsJsonObject();WorldPatchJson.keys(row,"write","disposition");var w=writes.get(offset+n);if(!writeJson(w).equals(row.get("write")))throw new IOException("Undo receipt order/write differs");var disposition=Disposition.valueOf(WorldPatchJson.text(row.get("disposition")));evaluated.add(new Entry(w,disposition));if(disposition==Disposition.RESTORED)restored++;else preserved++;}offset+=rows.size();if(stop==WorldPatchJournal.ReceiptState.COMPLETE)stop=null;
            }
            for(var file:names)if(file.endsWith(".evaluated.json")&&!names.contains(file.replace(".evaluated.json",".intent.json")))throw new IOException("Orphan undo receipt");
            if(names.contains("ambiguous.json"))throw new IOException("Undo explicitly ambiguous; no automatic replay");
            if(names.contains("outcome.json")){var result=readEvent(directory.resolve("outcome.json"));WorldPatchJson.keys(result,"format","version","id","planHash","outcome","batches","evaluated","restored","preserved","worldDurabilityVerified");eq(result,"format","WorldPatchUndoOutcome");WorldPatchJson.integer(result.get("version"),1,1);eq(result,"id",id.toString());eq(result,"planHash",planHash);falseFlag(result,"worldDurabilityVerified");
                if(missing!=0||WorldPatchJson.integer(result.get("batches"),0,count)!=batches||WorldPatchJson.integer(result.get("evaluated"),0,count)!=offset||WorldPatchJson.integer(result.get("restored"),0,count)!=restored||WorldPatchJson.integer(result.get("preserved"),0,count)!=preserved)throw new IOException("Undo outcome count/receipts differ");outcome=WorldPatchJournal.Outcome.valueOf(WorldPatchJson.text(result.get("outcome")));if(outcome==WorldPatchJournal.Outcome.COMPLETED&&(offset!=count||stop!=null)||stop!=null&&!stop.name().equals(outcome.name()))throw new IOException("Undo outcome conflicts with exact prefix");
            }
            return new Review(id,planHash,parentId,parentHash,evaluated,missing,outcome,null);
        }catch(Exception e){return new Review(id,planHash,parentId,parentHash,evaluated,missing,outcome,String.valueOf(e.getMessage()));}
    }
    static WorldPatchCompiler.Write inverse(WorldPatchCompiler.Write w){return new WorldPatchCompiler.Write(w.position(),w.after(),w.before(),WorldPatchPreview.air(w.before())?"clear":"set",WorldPatchPreview.air(w.after())?"added":WorldPatchPreview.air(w.before())?"removed":"replaced");}
    private static JsonObject writeJson(WorldPatchCompiler.Write w){var v=new JsonObject();v.add("position",w.position().json());v.addProperty("before",w.before());v.addProperty("after",w.after());v.addProperty("action",w.action());v.addProperty("difference",w.difference());return v;}
    private static JsonObject event(Plan p,Intent i,String format,List<Entry> entries,WorldPatchJournal.ReceiptState state){var v=new JsonObject();v.addProperty("format",format);v.addProperty("version",1);v.addProperty("id",p.id.toString());v.addProperty("planHash",p.hash);v.addProperty("index",i.index);v.addProperty("offset",i.offset);var rows=new JsonArray();if(entries==null){for(var w:i.writes)rows.add(writeJson(w));v.add("writes",rows);}else{for(var e:entries){var row=new JsonObject();row.add("write",writeJson(e.write));row.addProperty("disposition",e.disposition.name());rows.add(row);}v.add("entries",rows);v.addProperty("state",state.name());}return v;}
    private static void validate(JsonObject v,String format,UUID id,String hash,int index,int offset,boolean receipt){WorldPatchJson.keys(v,receipt?new String[]{"format","version","id","planHash","index","offset","entries","state"}:new String[]{"format","version","id","planHash","index","offset","writes"});eq(v,"format",format);WorldPatchJson.integer(v.get("version"),1,1);eq(v,"id",id.toString());eq(v,"planHash",hash);WorldPatchJson.integer(v.get("index"),index,index);WorldPatchJson.integer(v.get("offset"),offset,offset);}
    private static String name(int i,String kind){return String.format(Locale.ROOT,"%06d.%s.json",i,kind);}
    private static byte[] eventBytes(JsonObject value){var envelope=new JsonObject();envelope.add("value",value);envelope.addProperty("sha256",SelectionBaseline.hash(value));return envelope.toString().getBytes(StandardCharsets.UTF_8);}
    private static String digest(byte[] bytes){try{return dev.voxelstudio.Asset.sha(bytes);}catch(Exception e){throw new IllegalStateException(e);}}
    private static JsonObject readEvent(Path file)throws IOException{var envelope=WorldPatchJson.parse(WorldPatchJournalFiles.read(file,WorldPatchJournal.SMALL),()->false);WorldPatchJson.keys(envelope,"value","sha256");var v=envelope.getAsJsonObject("value");if(!SelectionBaseline.hash(v).equals(WorldPatchJson.text(envelope.get("sha256"))))throw new IOException("Undo event integrity differs");return v;}
    private static UUID uuid(JsonElement v){String s=WorldPatchJson.text(v);var id=UUID.fromString(s);if(!id.toString().equals(s))throw new IllegalArgumentException("Exact undo UUID required");return id;}
    private static void eq(JsonObject v,String key,String expected){if(!expected.equals(WorldPatchJson.text(v.get(key))))throw new IllegalArgumentException("Undo original identity differs: "+key);}
    private static void falseFlag(JsonObject v,String key){var flag=v.get(key);if(flag==null||!flag.isJsonPrimitive()||!flag.getAsJsonPrimitive().isBoolean()||flag.getAsBoolean())throw new IllegalArgumentException("Undo cannot claim authority/durability");}
    private static IOException io(Exception e){return e instanceof IOException i?i:new IOException(e);}
    private WorldPatchUndoJournal(){}
}
