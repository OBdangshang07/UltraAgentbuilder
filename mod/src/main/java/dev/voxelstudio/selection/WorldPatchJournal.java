package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Native-plan-bound, immutable write-ahead log. Disk methods belong on a
 * bounded worker, NEVER the server tick. An intent/receipt is not permission,
 * region-file durability or a crash-atomic world operation. No resume API. */
final class WorldPatchJournal {
    static final int BATCH=512,SMALL=2*1024*1024,METADATA=65536;
    enum ReceiptState { COMPLETE,CANCELLED,CONFLICT }
    enum Outcome { COMPLETED,CANCELLED,CONFLICT }
    private static final List<String> CORE=List.of("source.json","response.json","patch.json","plan.json");
    static final class Plan {
        private final UUID id,player;private final WorldPatchPreview.Binding binding;private final WorldPatchCompiler.Compiled compiled;
        private final Map<String,byte[]> members;private final String hash;
        private Plan(UUID id,UUID player,WorldPatchPreview.Binding binding,WorldPatchCompiler.Compiled compiled,Map<String,byte[]> members,String hash){this.id=id;this.player=player;this.binding=binding;this.compiled=compiled;this.hash=hash;var copy=new HashMap<String,byte[]>();members.forEach((k,v)->copy.put(k,v.clone()));this.members=Map.copyOf(copy);}
        UUID id(){return id;}UUID player(){return player;}String hash(){return hash;}WorldPatchPreview.Binding binding(){return binding;}WorldPatchCompiler.Compiled compiled(){return compiled;}
        boolean canAuthorizePlacement(){return false;}
        void verifyArchive(Path directory)throws IOException{WorldPatchJournalFiles.directory(directory);if(!directory.getFileName().toString().equals(id.toString()))throw new IOException("Original plan/archive identity differs");for(var member:CORE)if(!Arrays.equals(members.get(member),WorldPatchJournalFiles.read(directory.resolve(member),maximum(member))))throw new IOException("Original archive source changed; preserved");}
    }
    /** ONLY native reconstruction can prepare a new live log. The server must
     * separately own this Capture, fresh BEFORE and final in-game consent.
     * Hash-equivalent caller data does not grant any world-write capability. */
    static Plan prepare(SelectionReadService.Capture original,WorldPatchCompiler.Compiled compiled,WorldPatchPreview preview,byte[] originalResponse,UUID player){
        Objects.requireNonNull(original);Objects.requireNonNull(compiled);Objects.requireNonNull(preview);Objects.requireNonNull(player);Objects.requireNonNull(originalResponse);
        uuid(new JsonPrimitive(original.id()));
        WorldPatchCompiler.verifyPreview(compiled,preview,preview.binding());var source=original.payload().getBytes(StandardCharsets.UTF_8);
        var sourceValue=WorldPatchJson.parse(source,()->false);WorldPatchJson.keys(sourceValue,"selection","capture");
        if(!sourceValue.get("selection").equals(original.selection().json())||!original.selection().equals(compiled.baseline().selection)||original.contextRevision()!=compiled.baseline().contextRevision)throw new IllegalArgumentException("Original server Capture identity differs");
        var rebuilt=SelectionBaseline.fromSealedCapture(original.selection(),sourceValue.getAsJsonObject("capture"));
        if(!rebuilt.snapshotHash.equals(compiled.baseline().snapshotHash))throw new IllegalArgumentException("Original sealed source differs from native baseline");
        if(originalResponse.length<1||originalResponse.length>SMALL)throw new IllegalArgumentException("Original response quota exceeded");
        var response=originalResponse.clone();WorldPatchCompiler.verifyDownloaded(WorldPatchCompiler.read(rebuilt,response,preview.binding(),compiled.responseHash(),()->false),compiled.json());
        var buffers=new LinkedHashMap<String,byte[]>();buffers.put("source.json",source);buffers.put("response.json",response);buffers.put("patch.json",bytes(compiled.json()));
        var id=UUID.randomUUID();var content=new JsonObject();content.addProperty("format","WorldPatchTransactionPlan");content.addProperty("version",1);content.addProperty("id",id.toString());content.addProperty("player",player.toString());content.addProperty("originalCaptureId",original.id());content.add("binding",bindingJson(preview.binding()));content.addProperty("responseHash",compiled.responseHash());
        var files=new JsonArray();for(var e:buffers.entrySet()){var f=new JsonObject();f.addProperty("path",e.getKey());f.addProperty("bytes",e.getValue().length);f.addProperty("sha256",sha(e.getValue()));files.add(f);}content.add("files",files);
        content.addProperty("canAuthorizePlacement",false);content.addProperty("serverBaselineVerified",false);content.addProperty("worldDurabilityVerified",false);content.addProperty("crashAtomicPublication",false);
        var hash=SelectionBaseline.hash(content);content.addProperty("planHash",hash);buffers.put("plan.json",bytes(content));
        for(var e:buffers.entrySet())if(e.getValue().length>maximum(e.getKey()))throw new IllegalArgumentException("Native journal member quota exceeded");
        return new Plan(id,player,preview.binding(),compiled,buffers,hash);
    }
    static final class Intent {
        private final Live owner;private final int index,offset;private final List<WorldPatchCompiler.Write> writes;
        private Intent(Live owner,int index,int offset,List<WorldPatchCompiler.Write> writes){this.owner=owner;this.index=index;this.offset=offset;this.writes=List.copyOf(writes);}
        int index(){return index;}int offset(){return offset;}List<WorldPatchCompiler.Write> writes(){return writes;}
        boolean belongs(Plan plan){return owner.plan==plan;}
    }
    static final class Live {
        private final Path directory;private final Plan plan;private int cursor,batches;private Intent pending;private boolean broken,finished;private ReceiptState stop;
        private final Map<String,String> published=new LinkedHashMap<>();
        private Live(Path directory,Plan plan){this.directory=directory;this.plan=plan;}
        Path directory(){return directory;}Plan plan(){return plan;}
        private void available()throws IOException{if(broken||finished)throw new IOException("Journal closed/uncertain; no replay");}
        private void verifyCore()throws IOException{
            plan.verifyArchive(directory);int count=0;try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){count++;String name=file.getFileName().toString();if(CORE.contains(name))continue;var expected=published.get(name);if(expected==null||!expected.equals(sha(WorldPatchJournalFiles.read(file,name.equals("outcome.json")||name.equals("ambiguous.json")?METADATA:SMALL))))throw new IOException("Prior/unknown journal event changed; preserved");}}
            if(count!=CORE.size()+published.size())throw new IOException("Original journal event missing; preserved");
        }
        private void persist(String name,JsonObject value,int maximum)throws IOException{var raw=eventBytes(value);WorldPatchJournalFiles.publish(directory.resolve(name),raw,maximum);published.put(name,sha(raw));}
        synchronized Intent intent(int maximum)throws IOException{
            available();if(pending!=null||stop!=null||cursor>=plan.compiled.writes().size()||maximum!=BATCH||batches>=maximumBatches(plan.compiled.writes().size()))throw new IOException("Fixed bounded intent required; no new intent after pending/stopped/completed operation");
            try{verifyCore();var writes=plan.compiled.writes().subList(cursor,Math.min(cursor+maximum,plan.compiled.writes().size()));var token=new Intent(this,batches+1,cursor,writes);
                persist(name(token.index,"intent"),event(plan,"WorldPatchWriteIntent",token.index,token.offset,writes,null),SMALL);
                pending=token;batches++;return token;
            }catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void applied(Intent token,List<WorldPatchCompiler.Write> confirmed,ReceiptState state)throws IOException{
            available();if(token==null||token.owner!=this||pending!=token||state==null)throw new IOException("Original pending intent required");
            var copy=List.copyOf(confirmed);
            if(copy.size()>token.writes.size()||!copy.equals(token.writes.subList(0,copy.size()))||state==ReceiptState.COMPLETE&&copy.size()!=token.writes.size()||state!=ReceiptState.COMPLETE&&copy.size()==token.writes.size())throw new IOException("Receipt must be exact known ordered prefix; uncertainty cannot close intent");
            try{verifyCore();var expected=event(plan,"WorldPatchWriteIntent",token.index,token.offset,token.writes,null);
                if(!expected.equals(readEvent(directory.resolve(name(token.index,"intent")),SMALL)))throw new IOException("Write-ahead intent changed; preserved");
                persist(name(token.index,"applied"),event(plan,"WorldPatchAppliedPrefix",token.index,token.offset,copy,state.name()),SMALL);
                cursor+=copy.size();pending=null;if(state!=ReceiptState.COMPLETE)stop=state;
            }catch(Exception e){broken=true;throw io(e);}
        }
        synchronized void finish(Outcome outcome)throws IOException{
            available();if(pending!=null||outcome==null||outcome==Outcome.COMPLETED&&(cursor!=plan.compiled.writes().size()||stop!=null)||stop!=null&&!stop.name().equals(outcome.name()))throw new IOException("Cannot seal unresolved or mismatched operation");
            try{verifyCore();var event=new JsonObject();event.addProperty("format","WorldPatchOperationOutcome");event.addProperty("version",1);event.addProperty("id",plan.id.toString());event.addProperty("planHash",plan.hash);event.addProperty("outcome",outcome.name());event.addProperty("batches",batches);event.addProperty("confirmedWrites",cursor);event.addProperty("worldDurabilityVerified",false);persist("outcome.json",event,METADATA);finished=true;}
            catch(Exception e){broken=true;throw io(e);}
        }
        /** The existing intent remains unresolved. Even a failed ambiguity
         * marker cannot enable another intent or make recovery guess a write. */
        synchronized void ambiguous(Intent token,String reason)throws IOException{
            available();if(pending!=token||token==null||token.owner!=this)throw new IOException("Exact ambiguous intent required");broken=true;
            var value=new JsonObject();value.addProperty("format","WorldPatchAmbiguousOperation");value.addProperty("version",1);value.addProperty("id",plan.id.toString());value.addProperty("planHash",plan.hash);value.addProperty("index",token.index);value.addProperty("reason",String.valueOf(reason).substring(0,Math.min(1024,String.valueOf(reason).length())));persist("ambiguous.json",value,METADATA);
        }
    }
    static Live create(Path root,Plan plan)throws IOException{
        Objects.requireNonNull(plan);root=root.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(root);var directory=root.resolve(plan.id.toString());
        Files.createDirectory(directory);WorldPatchJournalFiles.directory(directory);
        for(var name:CORE)WorldPatchJournalFiles.publish(directory.resolve(name),plan.members.get(name),maximum(name));
        return new Live(directory,plan);
    }
    /** Recovery is READ-ONLY; reconstructed disk facts cannot create Live,
     * resume dispatch, replace a Capture, authorize writes or prove saves. */
    record Review(UUID id,UUID player,WorldPatchPreview.Binding binding,String planHash,List<WorldPatchCompiler.Write> confirmed,List<WorldPatchCompiler.Guard> guards,int intentBatches,int missingReceipts,Outcome outcome,String issue){
        Review {confirmed=List.copyOf(confirmed);guards=List.copyOf(guards);}
        boolean needsReview(){return issue!=null||missingReceipts>0||outcome==null;}
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    static Review inspect(Path directory){
        UUID id=null,player=null;WorldPatchPreview.Binding binding=null;String planHash=null;var confirmed=new ArrayList<WorldPatchCompiler.Write>();List<WorldPatchCompiler.Guard> guards=List.of();int batches=0,missing=0;Outcome outcome=null;
        try{
            directory=directory.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(directory);var plan=WorldPatchJson.parse(WorldPatchJournalFiles.read(directory.resolve("plan.json"),METADATA),()->false);
            WorldPatchJson.keys(plan,"format","version","id","player","originalCaptureId","binding","responseHash","files","canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication","planHash");
            eq(plan,"format","WorldPatchTransactionPlan");WorldPatchJson.integer(plan.get("version"),1,1);id=uuid(plan.get("id"));player=uuid(plan.get("player"));uuid(plan.get("originalCaptureId"));if(!directory.getFileName().toString().equals(id.toString()))throw new IOException("Journal identity/path differs");
            for(var field:List.of("canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication"))falseFlag(plan,field);
            planHash=WorldPatchJson.text(plan.get("planHash"));var content=plan.deepCopy();content.remove("planHash");if(!SelectionBaseline.hash(content).equals(planHash))throw new IOException("Journal plan integrity differs");binding=parseBinding(plan.getAsJsonObject("binding"));
            var files=plan.getAsJsonArray("files");if(files.size()!=3)throw new IOException("Incomplete original journal members");var members=new HashMap<String,byte[]>();
            for(int i=0;i<3;i++){var f=files.get(i).getAsJsonObject();WorldPatchJson.keys(f,"path","bytes","sha256");var name=CORE.get(i);eq(f,"path",name);var raw=WorldPatchJournalFiles.read(directory.resolve(name),maximum(name));if(raw.length!=WorldPatchJson.integer(f.get("bytes"),1,maximum(name))||!sha(raw).equals(WorldPatchJson.text(f.get("sha256"))))throw new IOException("Original journal member hash/size changed");members.put(name,raw);}
            var source=WorldPatchJson.parse(members.get("source.json"),()->false);WorldPatchJson.keys(source,"selection","capture");if(!source.get("selection").equals(binding.selection().json()))throw new IOException("Archived journal selection differs");
            var baseline=SelectionBaseline.fromSealedCapture(binding.selection(),source.getAsJsonObject("capture"));var compiled=WorldPatchCompiler.read(baseline,members.get("response.json"),binding,WorldPatchJson.text(plan.get("responseHash")),()->false);WorldPatchCompiler.verifyDownloaded(compiled,WorldPatchJson.parse(members.get("patch.json"),()->false));guards=compiled.guards();
            var names=new TreeSet<String>();try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){if(names.size()>=4+2*maximumBatches(compiled.writes().size())+2)throw new IOException("Journal member count quota exceeded");if(!names.add(file.getFileName().toString()))throw new IOException("Duplicate journal member");}}
            for(var name:names)if(!CORE.contains(name)&&!Set.of("outcome.json","ambiguous.json").contains(name)&&!name.matches("[0-9]{6}\\.(intent|applied)\\.json"))throw new IOException("Unknown/partial journal member; preserved");
            var intents=names.stream().filter(n->n.endsWith(".intent.json")).toList();int offset=0;ReceiptState stopped=null;
            for(var name:intents){batches++;if(!name.equals(name(batches,"intent"))||stopped!=null||missing>0)throw new IOException("Journal order/resume after unresolved stop rejected");
                var intent=readEvent(directory.resolve(name),SMALL);var planned=validateEvent(intent,"WorldPatchWriteIntent",id,planHash,batches,offset,compiled.writes(),false);var appliedName=name(batches,"applied");
                if(!names.contains(appliedName)){missing++;continue;}
                var applied=readEvent(directory.resolve(appliedName),SMALL);var rows=validateEvent(applied,"WorldPatchAppliedPrefix",id,planHash,batches,offset,planned,true);
                var state=ReceiptState.valueOf(WorldPatchJson.text(applied.get("state")));if(state==ReceiptState.COMPLETE?rows.size()!=planned.size():rows.size()>=planned.size())throw new IOException("Applied prefix closure state differs");
                confirmed.addAll(rows);offset+=rows.size();if(state!=ReceiptState.COMPLETE)stopped=state;
            }
            for(var name:names)if(name.endsWith(".applied.json")&&!names.contains(name.replace(".applied.json",".intent.json")))throw new IOException("Orphan applied receipt");
            if(names.contains("ambiguous.json"))throw new IOException("Original operation explicitly ambiguous; no automatic replay/undo");
            if(names.contains("outcome.json")){
                var result=readEvent(directory.resolve("outcome.json"),METADATA);WorldPatchJson.keys(result,"format","version","id","planHash","outcome","batches","confirmedWrites","worldDurabilityVerified");eq(result,"format","WorldPatchOperationOutcome");WorldPatchJson.integer(result.get("version"),1,1);eq(result,"id",id.toString());eq(result,"planHash",planHash);falseFlag(result,"worldDurabilityVerified");
                if(missing!=0||WorldPatchJson.integer(result.get("batches"),0,1000000)!=batches||WorldPatchJson.integer(result.get("confirmedWrites"),0,SelectionLimits.editCells())!=offset)throw new IOException("Outcome does not close exact logged prefixes");
                outcome=Outcome.valueOf(WorldPatchJson.text(result.get("outcome")));if(outcome==Outcome.COMPLETED&&(offset!=compiled.writes().size()||stopped!=null)||stopped!=null&&!stopped.name().equals(outcome.name()))throw new IOException("Outcome conflicts with applied prefix state");
            }
            return new Review(id,player,binding,planHash,confirmed,guards,batches,missing,outcome,null);
        }catch(Exception e){return new Review(id,player,binding,planHash,confirmed,guards,batches,missing,outcome,String.valueOf(e.getMessage()));}
    }
    private static List<WorldPatchCompiler.Write> validateEvent(JsonObject value,String format,UUID id,String hash,int index,int offset,List<WorldPatchCompiler.Write> expected,boolean applied)throws IOException{
        if(applied)WorldPatchJson.keys(value,"format","version","id","planHash","index","offset","writes","state");else WorldPatchJson.keys(value,"format","version","id","planHash","index","offset","writes");
        eq(value,"format",format);WorldPatchJson.integer(value.get("version"),1,1);eq(value,"id",id.toString());eq(value,"planHash",hash);WorldPatchJson.integer(value.get("index"),index,index);WorldPatchJson.integer(value.get("offset"),offset,offset);
        var rows=value.getAsJsonArray("writes");int start=applied?0:offset;if(rows==null||rows.size()>BATCH||!applied&&rows.size()!=Math.min(BATCH,expected.size()-offset)||!applied&&rows.isEmpty()||start+rows.size()>expected.size())throw new IOException("Journal fixed batch/prefix/quota differs");
        var result=new ArrayList<WorldPatchCompiler.Write>();for(int i=0;i<rows.size();i++){var write=expected.get(start+i);if(!writeJson(write).equals(rows.get(i)))throw new IOException("Journal write differs from independently rebuilt original proposal");result.add(write);}return List.copyOf(result);
    }
    private static JsonObject event(Plan p,String format,int index,int offset,List<WorldPatchCompiler.Write> writes,String state){var v=new JsonObject();v.addProperty("format",format);v.addProperty("version",1);v.addProperty("id",p.id.toString());v.addProperty("planHash",p.hash);v.addProperty("index",index);v.addProperty("offset",offset);var rows=new JsonArray();for(var w:writes)rows.add(writeJson(w));v.add("writes",rows);if(state!=null)v.addProperty("state",state);return v;}
    private static JsonObject writeJson(WorldPatchCompiler.Write w){var v=new JsonObject();v.add("position",w.position().json());v.addProperty("before",w.before());v.addProperty("after",w.after());v.addProperty("action",w.action());v.addProperty("difference",w.difference());return v;}
    private static JsonObject bindingJson(WorldPatchPreview.Binding b){var v=new JsonObject();v.add("selection",b.selection().json());v.addProperty("contextRevision",b.contextRevision());v.addProperty("snapshotHash",b.snapshotHash());v.addProperty("selectionHash",b.selectionHash());v.addProperty("patchHash",b.patchHash());v.addProperty("previewHash",b.previewHash());return v;}
    private static WorldPatchPreview.Binding parseBinding(JsonObject v){WorldPatchJson.keys(v,"selection","contextRevision","snapshotHash","selectionHash","patchHash","previewHash");return new WorldPatchPreview.Binding(parseSelection(v.getAsJsonObject("selection")),WorldPatchJson.integer(v.get("contextRevision"),0,9007199254740991L),WorldPatchJson.text(v.get("snapshotHash")),WorldPatchJson.text(v.get("selectionHash")),WorldPatchJson.text(v.get("patchHash")),WorldPatchJson.text(v.get("previewHash")));}
    private static WorldSelection parseSelection(JsonObject v){WorldPatchJson.keys(v,"format","version","world","revision","context","edit","protected");eq(v,"format","WorldSelection");WorldPatchJson.integer(v.get("version"),1,1);var w=v.getAsJsonObject("world");WorldPatchJson.keys(w,"worldId","dimension","minY","maxY");var world=new WorldSelection.WorldIdentity(WorldPatchJson.text(w.get("worldId")),WorldPatchJson.text(w.get("dimension")),(int)WorldPatchJson.integer(w.get("minY"),-2048,2048),(int)WorldPatchJson.integer(w.get("maxY"),-2048,2048));var protect=new ArrayList<SelectionRegion>();for(var e:v.getAsJsonArray("protected"))protect.add(region(e.getAsJsonObject()));return new WorldSelection(world,WorldPatchJson.integer(v.get("revision"),0,9007199254740991L),region(v.getAsJsonObject("context")),region(v.getAsJsonObject("edit")),protect);}
    private static SelectionRegion region(JsonObject v){WorldPatchJson.keys(v,"min","max");return new SelectionRegion(WorldPatchJson.point(v.get("min")),WorldPatchJson.point(v.get("max")));}
    private static int maximum(String name){return name.equals("plan.json")?METADATA:name.equals("response.json")?SMALL:SelectionLimits.snapshotBytes();}
    private static int maximumBatches(int writes){return (writes+BATCH-1)/BATCH;}
    private static String name(int index,String kind){return String.format(Locale.ROOT,"%06d.%s.json",index,kind);}
    private static UUID uuid(JsonElement v){String value=WorldPatchJson.text(v);var id=UUID.fromString(value);if(!id.toString().equals(value))throw new IllegalArgumentException("Exact journal UUID required");return id;}
    private static void eq(JsonObject v,String key,String expected){if(!WorldPatchJson.text(v.get(key)).equals(expected))throw new IllegalArgumentException("Journal original identity changed: "+key);}
    private static void falseFlag(JsonObject v,String key){var f=v.get(key);if(f==null||!f.isJsonPrimitive()||!f.getAsJsonPrimitive().isBoolean()||f.getAsBoolean())throw new IllegalArgumentException("Journal cannot claim authority/durability: "+key);}
    private static byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private static String sha(byte[] bytes){try{return dev.voxelstudio.Asset.sha(bytes);}catch(Exception e){throw new IllegalStateException(e);}}
    private static IOException io(Exception e){return e instanceof IOException i?i:new IOException(e);}
    private static byte[] eventBytes(JsonObject value){var e=new JsonObject();e.add("value",value);e.addProperty("sha256",SelectionBaseline.hash(value));return bytes(e);}
    private static JsonObject readEvent(Path file,int maximum)throws IOException{var e=WorldPatchJson.parse(WorldPatchJournalFiles.read(file,maximum),()->false);WorldPatchJson.keys(e,"value","sha256");var value=e.getAsJsonObject("value");if(!SelectionBaseline.hash(value).equals(WorldPatchJson.text(e.get("sha256"))))throw new IOException("Journal event integrity differs");return value;}
    private WorldPatchJournal(){}
}
