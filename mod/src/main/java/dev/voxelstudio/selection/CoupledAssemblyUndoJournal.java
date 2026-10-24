package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Independent one-use inverse of a SAME-LIVE sealed prefix. This journal
 * neither opens a native source nor supplies final consent. Inspect is facts
 * only; no archive/Review factory can construct a Live or an UndoOrigin. */
final class CoupledAssemblyUndoJournal {
    enum Disposition { RESTORED,PRESERVED_TARGET,PRESERVED_NEIGHBOR,PRESERVED_DEPENDENCY }
    record Entry(WorldPatchCompiler.Write write,Disposition disposition){Entry{Objects.requireNonNull(write);Objects.requireNonNull(disposition);}}
    record Group(int offset,int originalGroupIndex,String kind,List<WorldPatchCompiler.Write> writes,SelectionRegion.Point support){Group{writes=List.copyOf(writes);}}
    record Packet(int offset,int groupOffset,List<Group> groups,List<WorldPatchCompiler.Write> writes){
        Packet{groups=List.copyOf(groups);writes=List.copyOf(writes);}
        int prefixGroups(int count){int n=0,i=0;while(n<count&&i<groups.size())n+=groups.get(i++).writes.size();if(count<0||count>writes.size()||n!=count)throw new IllegalArgumentException("Undo receipt cannot split an original complete group");return i;}
    }
    static final class Plan {
        private final UUID id;private final CoupledAssemblyExecution.UndoOrigin origin;private final List<Group> groups;private final List<WorldPatchCompiler.Write> writes;private final Map<SelectionRegion.Point,String> originalAfter;private final byte[] bytes;private final String hash;
        private Plan(CoupledAssemblyExecution.UndoOrigin origin){
            this.origin=origin;id=UUID.randomUUID();groups=inverted(origin.plan().compiled().groups().subList(0,origin.groups()),origin.prefix());writes=flatten(groups);
            var after=new HashMap<SelectionRegion.Point,String>();for(var row:writes)if(after.put(row.position(),row.before())!=null)throw new IllegalStateException("Original inverse target duplicated");originalAfter=Map.copyOf(after);
            var v=planJson(id,origin.plan().id(),origin.plan().player(),origin.plan().hash(),writes.size(),groups.size());hash=SelectionBaseline.hash(v);v.addProperty("planHash",hash);bytes=bytes(v);
        }
        UUID id(){return id;}String hash(){return hash;}CoupledAssemblyJournal.Plan original(){return origin.plan();}List<Group> groups(){return groups;}List<WorldPatchCompiler.Write> writes(){return writes;}
        boolean fromOriginalOrigin(CoupledAssemblyExecution.UndoOrigin value){return origin==value;}
        Map<SelectionRegion.Point,String> originalAfter(){return originalAfter;}
        Packet packet(int groupOffset){return packetOf(groups,groupOffset);}
        boolean canAuthorizePlacement(){return false;}
        private void verify(Path directory)throws IOException{
            WorldPatchJournalFiles.directory(directory);if(!directory.getFileName().toString().equals(id.toString())||!directory.getParent().equals(origin.archive().getParent())||!Arrays.equals(bytes,WorldPatchJournalFiles.read(directory.resolve("plan.json"),CoupledAssemblyJournal.METADATA)))throw new IOException("Coupled undo original path/plan changed");origin.sealed().verify();
        }
    }
    static final class Intent {
        private final Live owner;private final int index;private final Packet packet;
        private Intent(Live owner,int index,Packet packet){this.owner=owner;this.index=index;this.packet=packet;}
        Packet packet(){return packet;}boolean belongs(Plan plan){return owner.plan==plan;}
    }
    static final class Live {
        private final Path directory;private final Plan plan;private final Map<String,String> published=new LinkedHashMap<>();
        private int cursor,groupCursor,batches,restored,preserved;private boolean broken,finished;private Intent pending;private CoupledAssemblyJournal.ReceiptState stop;
        private Live(Path directory,Plan plan){this.directory=directory;this.plan=plan;}
        Path directory(){return directory;}Plan plan(){return plan;}
        private void available()throws IOException{if(broken||finished)throw new IOException("Coupled undo closed/unknown; no replay");}
        private void verify()throws IOException{
            plan.verify(directory);int count=0;try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){count++;var name=file.getFileName().toString();if(name.equals("plan.json"))continue;var pin=published.get(name);if(pin==null||!pin.equals(digest(WorldPatchJournalFiles.read(file,CoupledAssemblyJournal.EVENT_BYTES))))throw new IOException("Unknown/changed coupled undo event");}}
            if(count!=1+published.size())throw new IOException("Original coupled undo event missing");
        }
        private void persist(String name,JsonObject value)throws IOException{var raw=envelope(value);WorldPatchJournalFiles.publish(directory.resolve(name),raw,CoupledAssemblyJournal.EVENT_BYTES);published.put(name,digest(raw));}
        synchronized Intent intent()throws IOException{
            available();if(pending!=null||stop!=null||groupCursor>=plan.groups.size())throw new IOException("One original complete inverse intent required");
            try{verify();var packet=plan.packet(groupCursor);if(packet.offset!=cursor)throw new IOException("Inverse complete-group cursor differs");var token=new Intent(this,batches+1,packet);persist(name(token.index,"intent"),event(plan.id,plan.hash,token.index,packet,null,null));pending=token;batches++;return token;}catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void evaluated(Intent token,List<Entry> entries,CoupledAssemblyJournal.ReceiptState state)throws IOException{
            available();if(token==null||token.owner!=this||pending!=token||state==null)throw new IOException("Same original coupled inverse intent required");var rows=List.copyOf(entries);int groups=checkedEntries(token.packet,rows,state);
            try{verify();if(!event(plan.id,plan.hash,token.index,token.packet,null,null).equals(readEvent(directory.resolve(name(token.index,"intent")))))throw new IOException("Original coupled undo intent changed");
                persist(name(token.index,"evaluated"),event(plan.id,plan.hash,token.index,token.packet,rows,state));cursor+=rows.size();groupCursor+=groups;for(var row:rows)if(row.disposition==Disposition.RESTORED)restored++;else preserved++;pending=null;if(state!=CoupledAssemblyJournal.ReceiptState.COMPLETE)stop=state;
            }catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void finish(CoupledAssemblyJournal.Outcome outcome)throws IOException{
            available();if(pending!=null||outcome==null||outcome==CoupledAssemblyJournal.Outcome.COMPLETED&&(cursor!=plan.writes.size()||stop!=null)||stop!=null&&!stop.name().equals(outcome.name()))throw new IOException("Cannot seal unknown/incomplete coupled inverse");
            try{verify();var v=base(plan.id,plan.hash,"CoupledAssemblyUndoOutcome");v.addProperty("outcome",outcome.name());v.addProperty("batches",batches);v.addProperty("evaluatedWrites",cursor);v.addProperty("evaluatedGroups",groupCursor);v.addProperty("restored",restored);v.addProperty("preserved",preserved);v.addProperty("worldDurabilityVerified",false);persist("outcome.json",v);finished=true;}catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void ambiguous(Intent token,String reason)throws IOException{
            available();if(token==null||token.owner!=this||pending!=token)throw new IOException("Exact original unresolved inverse intent required");broken=true;var v=base(plan.id,plan.hash,"CoupledAssemblyUndoAmbiguous");v.addProperty("index",token.index);String text=String.valueOf(reason);v.addProperty("reason",text.substring(0,Math.min(1024,text.length())));persist("ambiguous.json",v);
        }
    }
    static Live create(Path root,CoupledAssemblyExecution.UndoOrigin origin)throws IOException{
        Objects.requireNonNull(origin);origin.claim();root=root.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(root);origin.sealed().verify();if(!root.equals(origin.archive().getParent()))throw new IOException("Original coupled apply archive must remain physical sibling");
        var plan=new Plan(origin);var directory=root.resolve(plan.id.toString());Files.createDirectory(directory);WorldPatchJournalFiles.publish(directory.resolve("plan.json"),plan.bytes,CoupledAssemblyJournal.METADATA);plan.verify(directory);return new Live(directory,plan);
    }
    record Review(UUID id,UUID parentId,String planHash,List<Entry> evaluated,int evaluatedGroups,int missingReceipts,CoupledAssemblyJournal.Outcome outcome,String issue){
        Review{evaluated=List.copyOf(evaluated);}boolean needsReview(){return issue!=null||missingReceipts!=0||outcome==null;}boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    static Review inspect(Path directory){
        UUID id=null,parentId=null;String planHash=null;var evaluated=new ArrayList<Entry>();int groups=0,missing=0;CoupledAssemblyJournal.Outcome outcome=null;
        try{
            directory=directory.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(directory);var v=WorldPatchJson.parse(WorldPatchJournalFiles.read(directory.resolve("plan.json"),CoupledAssemblyJournal.METADATA),()->false);
            WorldPatchJson.keys(v,"format","version","id","parentId","player","parentPlanHash","originalConfirmedWrites","originalConfirmedGroups","order","canAuthorizePlacement","worldDurabilityVerified","crashAtomicPublication","planHash");eq(v,"format","CoupledAssemblyUndoPlan");WorldPatchJson.integer(v.get("version"),1,1);id=uuid(v.get("id"));parentId=uuid(v.get("parentId"));if(id.equals(parentId)||!directory.getFileName().toString().equals(id.toString()))throw new IOException("Original inverse path/identity differs");
            var parent=CoupledAssemblyJournal.inspect(directory.getParent().resolve(parentId.toString()));if(parent.needsReview())throw new IOException("Original complete apply journal is not sealed");
            var expected=planJson(id,parentId,parent.player(),parent.planHash(),parent.confirmed().size(),parent.confirmedGroups());planHash=SelectionBaseline.hash(expected);expected.addProperty("planHash",planHash);if(!expected.equals(v))throw new IOException("Inverse plan differs from original complete groups");
            var schedule=inverted(parent.confirmedSchedule(),parent.confirmed());int total=parent.confirmed().size(),limit=3+2*((total+510)/511);var names=new TreeSet<String>();try(var stream=Files.newDirectoryStream(directory)){for(var f:stream){if(names.size()>=limit)throw new IOException("Inverse event file quota");names.add(f.getFileName().toString());}}
            for(var name:names)if(!Set.of("plan.json","outcome.json","ambiguous.json").contains(name)&&!name.matches("[0-9]{6}\\.(intent|evaluated)\\.json"))throw new IOException("Unknown/partial inverse event");
            int batches=0,restored=0,preserved=0;CoupledAssemblyJournal.ReceiptState stop=null;
            for(var name:names.stream().filter(n->n.endsWith(".intent.json")).toList()){
                batches++;if(missing!=0||stop!=null||!name.equals(name(batches,"intent")))throw new IOException("Inverse continuation after unknown/stopped intent");var packet=packetOf(schedule,groups);
                if(!event(id,planHash,batches,packet,null,null).equals(readEvent(directory.resolve(name))))throw new IOException("Inverse intent differs from exact reversed groups");var receipt=name(batches,"evaluated");if(!names.contains(receipt)){missing++;continue;}
                var saved=readEvent(directory.resolve(receipt));var rows=new ArrayList<Entry>();for(var item:saved.getAsJsonArray("entries")){var r=item.getAsJsonObject();WorldPatchJson.keys(r,"write","disposition");int i=rows.size();if(i>=packet.writes.size()||!writeJson(packet.writes.get(i)).equals(r.get("write")))throw new IOException("Inverse evaluated order/write differs");rows.add(new Entry(packet.writes.get(i),Disposition.valueOf(WorldPatchJson.text(r.get("disposition")))));}
                var state=CoupledAssemblyJournal.ReceiptState.valueOf(WorldPatchJson.text(saved.get("state")));int n=checkedEntries(packet,rows,state);if(!event(id,planHash,batches,packet,rows,state).equals(saved))throw new IOException("Inverse receipt changed/split group");evaluated.addAll(rows);groups+=n;for(var row:rows)if(row.disposition==Disposition.RESTORED)restored++;else preserved++;if(state!=CoupledAssemblyJournal.ReceiptState.COMPLETE)stop=state;
            }
            for(var name:names)if(name.endsWith(".evaluated.json")&&!names.contains(name.replace(".evaluated.json",".intent.json")))throw new IOException("Orphan inverse receipt");if(names.contains("ambiguous.json"))throw new IOException("Explicit inverse ambiguity; no replay");
            if(names.contains("outcome.json")){
                var result=readEvent(directory.resolve("outcome.json"));outcome=CoupledAssemblyJournal.Outcome.valueOf(WorldPatchJson.text(result.get("outcome")));var expectedResult=base(id,planHash,"CoupledAssemblyUndoOutcome");expectedResult.addProperty("outcome",outcome.name());expectedResult.addProperty("batches",batches);expectedResult.addProperty("evaluatedWrites",evaluated.size());expectedResult.addProperty("evaluatedGroups",groups);expectedResult.addProperty("restored",restored);expectedResult.addProperty("preserved",preserved);expectedResult.addProperty("worldDurabilityVerified",false);
                if(!expectedResult.equals(result)||missing!=0||outcome==CoupledAssemblyJournal.Outcome.COMPLETED&&(evaluated.size()!=total||stop!=null)||stop!=null&&!stop.name().equals(outcome.name()))throw new IOException("Inverse outcome differs from complete evaluated groups");
            }
        }catch(Exception e){return new Review(id,parentId,planHash,evaluated,groups,missing,outcome,String.valueOf(e.getMessage()));}
        return new Review(id,parentId,planHash,evaluated,groups,missing,outcome,null);
    }
    private static List<Group> inverted(List<AssemblyCoupledCompiler.Group> forward,List<WorldPatchCompiler.Write> confirmed){
        if(forward.isEmpty()||confirmed.isEmpty())throw new IllegalArgumentException("Nonempty original complete-group prefix required");var result=new ArrayList<Group>();int offset=0,originalCount=0;
        for(var g:forward){if(g.offset()!=originalCount)throw new IllegalArgumentException("Original group prefix lost order");originalCount+=g.operationIndices().size();}if(originalCount!=confirmed.size())throw new IllegalArgumentException("Original complete-group prefix size differs");
        for(int n=forward.size()-1;n>=0;n--){var g=forward.get(n);var rows=new ArrayList<WorldPatchCompiler.Write>();for(int i=g.operationIndices().size()-1;i>=0;i--)rows.add(inverse(confirmed.get(g.offset()+i)));SelectionRegion.Point support=null;
            if(g.kind().equals("door-pair")){var lower=confirmed.get(g.offset()).position();support=new SelectionRegion.Point(lower.x(),lower.y()-1,lower.z());}
            result.add(new Group(offset,n,g.kind(),rows,support));offset+=rows.size();}return List.copyOf(result);
    }
    private static List<WorldPatchCompiler.Write> flatten(List<Group> groups){var result=new ArrayList<WorldPatchCompiler.Write>();for(var g:groups)result.addAll(g.writes);return List.copyOf(result);}
    private static Packet packetOf(List<Group> groups,int offset){if(offset<0||offset>=groups.size())throw new IllegalArgumentException("Original inverse group cursor required");var chosen=new ArrayList<Group>();int size=0;for(int i=offset;i<groups.size();i++){var g=groups.get(i);if(size+g.writes.size()>CoupledAssemblyJournal.BATCH)break;chosen.add(g);size+=g.writes.size();}return new Packet(chosen.get(0).offset,offset,chosen,flatten(chosen));}
    private static int checkedEntries(Packet packet,List<Entry> rows,CoupledAssemblyJournal.ReceiptState state){
        int groups=packet.prefixGroups(rows.size());if(state==null||(state==CoupledAssemblyJournal.ReceiptState.COMPLETE?rows.size()!=packet.writes.size():rows.size()==packet.writes.size()))throw new IllegalArgumentException("Exact complete inverse receipt prefix required");int index=0;
        for(var g:packet.groups.subList(0,groups)){var disposition=rows.get(index).disposition;for(var w:g.writes){var row=rows.get(index++);if(!w.equals(row.write)||row.disposition!=disposition)throw new IllegalArgumentException("An inverse group must have one whole restored/preserved disposition");}}return groups;
    }
    private static JsonObject planJson(UUID id,UUID parent,UUID player,String parentHash,int writes,int groups){var v=base(id,null,"CoupledAssemblyUndoPlan");v.addProperty("parentId",parent.toString());v.addProperty("player",player.toString());v.addProperty("parentPlanHash",parentHash);v.addProperty("originalConfirmedWrites",writes);v.addProperty("originalConfirmedGroups",groups);v.addProperty("order","reverse-complete-groups-upper-before-lower");for(var f:List.of("canAuthorizePlacement","worldDurabilityVerified","crashAtomicPublication"))v.addProperty(f,false);return v;}
    private static JsonObject base(UUID id,String hash,String format){var v=new JsonObject();v.addProperty("format",format);v.addProperty("version",1);v.addProperty("id",id.toString());if(hash!=null)v.addProperty("planHash",hash);return v;}
    private static JsonObject event(UUID id,String hash,int index,Packet packet,List<Entry> entries,CoupledAssemblyJournal.ReceiptState state){
        var v=base(id,hash,entries==null?"CoupledAssemblyUndoIntent":"CoupledAssemblyUndoEvaluatedGroups");v.addProperty("index",index);v.addProperty("offset",packet.offset);v.addProperty("groupOffset",packet.groupOffset);int count=entries==null?packet.writes.size():entries.size(),n=packet.prefixGroups(count);var groups=new JsonArray();for(var g:packet.groups.subList(0,n)){var a=new JsonObject();a.addProperty("offset",g.offset);a.addProperty("originalGroupIndex",g.originalGroupIndex);a.addProperty("kind",g.kind);a.addProperty("size",g.writes.size());a.add("support",g.support==null?JsonNull.INSTANCE:g.support.json());groups.add(a);}v.add("groups",groups);
        var rows=new JsonArray();if(entries==null){for(var w:packet.writes)rows.add(writeJson(w));v.add("writes",rows);}else{for(var e:entries){var r=new JsonObject();r.add("write",writeJson(e.write));r.addProperty("disposition",e.disposition.name());rows.add(r);}v.add("entries",rows);v.addProperty("state",state.name());}return v;
    }
    private static WorldPatchCompiler.Write inverse(WorldPatchCompiler.Write w){return new WorldPatchCompiler.Write(w.position(),w.after(),w.before(),WorldPatchPreview.air(w.before())?"clear":"set",WorldPatchPreview.air(w.after())?"added":WorldPatchPreview.air(w.before())?"removed":"replaced");}
    private static JsonObject writeJson(WorldPatchCompiler.Write w){var v=new JsonObject();v.add("position",w.position().json());v.addProperty("before",w.before());v.addProperty("after",w.after());v.addProperty("action",w.action());v.addProperty("difference",w.difference());return v;}
    private static String name(int i,String kind){return String.format(Locale.ROOT,"%06d.%s.json",i,kind);}
    private static byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private static String digest(byte[] b){try{return dev.voxelstudio.Asset.sha(b);}catch(Exception e){throw new IllegalStateException(e);}}
    private static byte[] envelope(JsonObject v){var e=new JsonObject();e.add("value",v);e.addProperty("sha256",SelectionBaseline.hash(v));return bytes(e);}
    private static JsonObject readEvent(Path file)throws IOException{var e=WorldPatchJson.parse(WorldPatchJournalFiles.read(file,CoupledAssemblyJournal.EVENT_BYTES),()->false);WorldPatchJson.keys(e,"value","sha256");var v=e.getAsJsonObject("value");if(!SelectionBaseline.hash(v).equals(WorldPatchJson.text(e.get("sha256"))))throw new IOException("Inverse event integrity differs");return v;}
    private static UUID uuid(JsonElement e){String value=WorldPatchJson.text(e);var id=UUID.fromString(value);if(!id.toString().equals(value))throw new IllegalArgumentException("Canonical inverse UUID required");return id;}
    private static void eq(JsonObject v,String key,String value){if(!value.equals(WorldPatchJson.text(v.get(key))))throw new IllegalArgumentException("Inverse fixed field changed");}
    private static IOException io(Exception e){return e instanceof IOException i?i:new IOException(e);}
    private CoupledAssemblyUndoJournal(){}
}
