package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Independent WHOLE v2 write-ahead ledger. All disk methods are worker-only.
 * Original source and EVERY proposal/patch/preview are immutable plan members.
 * No legacy plan, per-part application, resume, server consent or world API.
 * Persisted receipts do not certify region-file durability/crash atomicity. */
final class AssemblyPatchJournal {
    static final int BATCH=512,EVENT_BYTES=2*1024*1024,METADATA=65536;
    enum ReceiptState { COMPLETE,CANCELLED,CONFLICT }
    enum Outcome { COMPLETED,CANCELLED,CONFLICT }
    static final class Plan {
        private final UUID id,player;
        private final AssemblyPatchCompiler.Compiled compiled;
        private final Map<String,byte[]> members;
        private final String hash;
        private Plan(UUID id,UUID player,AssemblyPatchCompiler.Compiled compiled,Map<String,byte[]> members,String hash){
            this.id=id;this.player=player;this.compiled=compiled;this.hash=hash;
            // Byte arrays originate only in the defensive immutable input or
            // fresh local serialization. No public mutable member accessor.
            this.members=Collections.unmodifiableMap(new LinkedHashMap<>(members));
        }
        UUID id(){return id;}UUID player(){return player;}String hash(){return hash;}
        AssemblyPatchBinding binding(){return compiled.binding();}AssemblyPatchCompiler.Compiled compiled(){return compiled;}
        boolean canAuthorizePlacement(){return false;}
        void verifyArchive(Path directory)throws IOException{
            WorldPatchJournalFiles.directory(directory);if(!directory.getFileName().toString().equals(id.toString()))throw new IOException("Original whole archive identity differs");
            for(var name:core(binding().partHashes().size()))if(!Arrays.equals(members.get(name),WorldPatchJournalFiles.read(directory.resolve(name),maximum(name))))throw new IOException("Original whole archive bytes changed; preserved");
        }
    }
    static Plan prepare(SelectionReadService.Capture original,AssemblyPatchCompiler.Compiled compiled,AssemblyPatchPreview preview,UUID player){
        return prepare(original,compiled,preview,player,()->false);
    }
    static Plan prepare(SelectionReadService.Capture original,AssemblyPatchCompiler.Compiled compiled,AssemblyPatchPreview preview,UUID player,BooleanSupplier cancelled){
        Objects.requireNonNull(original);Objects.requireNonNull(compiled);Objects.requireNonNull(preview);Objects.requireNonNull(player);
        Objects.requireNonNull(cancelled);WorldPatchJson.cancelled(cancelled);
        var binding=compiled.binding();var baseline=compiled.baseline();
        if(!original.id().equals(binding.captureId())||!original.selection().equals(binding.selection())||original.contextRevision()!=binding.contextRevision()
                ||!preview.binding().equals(binding)||preview.totalWrites()!=binding.totalWrites())throw new IllegalArgumentException("Whole journal requires the same original Capture and complete candidate");
        var source=original.payload().getBytes(StandardCharsets.UTF_8);var value=WorldPatchJson.parse(source,cancelled);WorldPatchJson.keys(value,"selection","capture");
        if(!value.get("selection").equals(binding.selection().json()))throw new IllegalArgumentException("Whole source selection differs");
        var rebuilt=SelectionBaseline.fromSealedCapture(original.selection(),value.getAsJsonObject("capture"),cancelled);
        if(!rebuilt.snapshotHash.equals(baseline.snapshotHash)||!rebuilt.selectionHash.equals(baseline.selectionHash)||rebuilt.contextRevision!=binding.contextRevision())throw new IllegalArgumentException("Whole archived source differs from original server baseline");
        var again=AssemblyPatchCompiler.compile(rebuilt,compiled.original(),cancelled);WorldPatchJson.cancelled(cancelled);
        if(!again.writes().equals(compiled.writes())||!again.guards().equals(compiled.guards()))throw new IllegalArgumentException("Whole archive cannot replace original server reconstruction");
        int checked=0;for(var write:compiled.writes()){
            if((checked++&1023)==0)WorldPatchJson.cancelled(cancelled);
            var row=preview.at(write.position());if(row==null||!write.before().equals(row.before())||!write.after().equals(row.after())||!write.difference().equals(row.difference().name().toLowerCase(Locale.ROOT)))throw new IllegalArgumentException("Whole confirmed display differs from original writes");
        }
        var members=new LinkedHashMap<String,byte[]>();members.put("source.json",source);
        for(var part:compiled.original().parts()){
            WorldPatchJson.cancelled(cancelled);
            if(part.originalPreview()==null)throw new IllegalArgumentException("Original complete preview bytes required; no synthesized archive substitute");
            members.put(partName(part.index(),"proposal"),part.originalProposal());members.put(partName(part.index(),"patch"),part.originalPatch());members.put(partName(part.index(),"preview"),part.originalPreview());
        }
        var id=UUID.randomUUID();var plan=new JsonObject();plan.addProperty("format","AssemblyPatchTransactionPlan");plan.addProperty("version",2);
        plan.addProperty("id",id.toString());plan.addProperty("player",player.toString());plan.addProperty("originalCaptureId",original.id());plan.add("binding",binding.json());
        var files=new JsonArray();for(var entry:members.entrySet()){
            WorldPatchJson.cancelled(cancelled);
            if(entry.getValue().length>maximum(entry.getKey()))throw new IllegalArgumentException("Whole journal member quota exceeded");
            var pin=new JsonObject();pin.addProperty("path",entry.getKey());pin.addProperty("bytes",entry.getValue().length);pin.addProperty("sha256",sha(entry.getValue()));files.add(pin);
        }
        plan.add("files",files);for(var flag:List.of("canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication"))plan.addProperty(flag,false);
        var hash=SelectionBaseline.hash(plan);plan.addProperty("planHash",hash);var raw=bytes(plan);if(raw.length>METADATA)throw new IllegalArgumentException("Whole plan metadata quota exceeded");members.put("plan.json",raw);
        WorldPatchJson.cancelled(cancelled);return new Plan(id,player,compiled,members,hash);
    }
    static final class Intent {
        private final Live owner;private final int index,offset;private final List<WorldPatchCompiler.Write> writes;
        private Intent(Live owner,int index,int offset,List<WorldPatchCompiler.Write> writes){this.owner=owner;this.index=index;this.offset=offset;this.writes=List.copyOf(writes);}
        int index(){return index;}int offset(){return offset;}List<WorldPatchCompiler.Write> writes(){return writes;}
        boolean belongs(Plan plan){return owner.plan==plan;}
    }
    static final class Live {
        private final Path directory;private final Plan plan;
        private final Map<String,String> published=new LinkedHashMap<>();
        private int cursor,batches;private Intent pending;private boolean broken,finished;private ReceiptState stop;
        private Live(Path directory,Plan plan){this.directory=directory;this.plan=plan;}
        Path directory(){return directory;}Plan plan(){return plan;}
        /** CPU-only observation of THIS live ledger's acknowledged closure.
         * It does not reread disk, mint undo consent or authorize a writer. */
        synchronized Sealed sealed(List<WorldPatchCompiler.Write> prefix){
            if(broken||!finished||pending!=null||cursor==0||prefix.size()!=cursor||!prefix.equals(plan.compiled.writes().subList(0,cursor)))throw new IllegalStateException("Whole undo requires this original closed live ledger");
            return new Sealed(plan,directory,prefix,published);
        }
        private void available()throws IOException{if(broken||finished)throw new IOException("Whole journal closed or uncertain; no replay");}
        private void verifyCore()throws IOException{
            plan.verifyArchive(directory);var core=core(plan.binding().partHashes().size());int count=0;
            try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){
                count++;var name=file.getFileName().toString();if(core.contains(name))continue;var expected=published.get(name);
                if(expected==null||!expected.equals(sha(WorldPatchJournalFiles.read(file,eventMaximum(name)))))throw new IOException("Unknown/changed whole journal event; preserved");
            }}
            if(count!=core.size()+published.size())throw new IOException("Original whole event missing; preserved");
        }
        private void persist(String name,JsonObject value)throws IOException{
            var raw=eventBytes(value);WorldPatchJournalFiles.publish(directory.resolve(name),raw,eventMaximum(name));published.put(name,sha(raw));
        }
        synchronized Intent intent(int maximum)throws IOException{
            available();if(maximum!=BATCH||pending!=null||stop!=null||cursor>=plan.binding().totalWrites()||batches>=maximumBatches(plan.binding().totalWrites()))throw new IOException("One fixed complete-set ordered intent required");
            try{verifyCore();var token=new Intent(this,batches+1,cursor,plan.compiled.writes().subList(cursor,Math.min(cursor+BATCH,plan.binding().totalWrites())));
                persist(eventName(token.index,"intent"),event(plan,"AssemblyPatchWriteIntent",token.index,token.offset,token.writes,null));pending=token;batches++;return token;
            }catch(Exception error){broken=true;throw io(error);}
        }
        synchronized void applied(Intent token,List<WorldPatchCompiler.Write> prefix,ReceiptState state)throws IOException{
            available();if(token==null||token.owner!=this||pending!=token||state==null)throw new IOException("Original whole pending intent required");
            var rows=List.copyOf(prefix);if(rows.size()>token.writes.size()||!rows.equals(token.writes.subList(0,rows.size()))||state==ReceiptState.COMPLETE&&rows.size()!=token.writes.size()||state!=ReceiptState.COMPLETE&&rows.size()==token.writes.size())throw new IOException("Whole receipt must retain exact known ordered prefix");
            try{verifyCore();if(!event(plan,"AssemblyPatchWriteIntent",token.index,token.offset,token.writes,null).equals(readEvent(directory.resolve(eventName(token.index,"intent")),EVENT_BYTES)))throw new IOException("Original whole intent changed");
                persist(eventName(token.index,"applied"),event(plan,"AssemblyPatchAppliedPrefix",token.index,token.offset,rows,state.name()));cursor+=rows.size();pending=null;if(state!=ReceiptState.COMPLETE)stop=state;
            }catch(Exception error){broken=true;throw io(error);}
        }
        synchronized void finish(Outcome outcome)throws IOException{
            available();if(pending!=null||outcome==null||outcome==Outcome.COMPLETED&&(cursor!=plan.binding().totalWrites()||stop!=null)||stop!=null&&!stop.name().equals(outcome.name()))throw new IOException("Cannot close an unresolved or mismatched whole operation");
            try{verifyCore();var result=new JsonObject();result.addProperty("format","AssemblyPatchOperationOutcome");result.addProperty("version",2);result.addProperty("id",plan.id.toString());result.addProperty("planHash",plan.hash);
                result.addProperty("outcome",outcome.name());result.addProperty("batches",batches);result.addProperty("confirmedWrites",cursor);result.addProperty("worldDurabilityVerified",false);persist("outcome.json",result);finished=true;
            }catch(Exception error){broken=true;throw io(error);}
        }
        synchronized void ambiguous(Intent token,String reason)throws IOException{
            available();if(token==null||pending!=token||token.owner!=this)throw new IOException("Original whole unresolved intent required");broken=true;
            var result=new JsonObject();result.addProperty("format","AssemblyPatchAmbiguousOperation");result.addProperty("version",2);result.addProperty("id",plan.id.toString());result.addProperty("planHash",plan.hash);result.addProperty("index",token.index);
            var text=String.valueOf(reason);result.addProperty("reason",text.substring(0,Math.min(1024,text.length())));persist("ambiguous.json",result);
        }
    }
    /** Private-constructor same-live-ledger receipt witness. Disk review can
     * never construct this object. Verification remains disk-worker-only and
     * compares exact core bytes/events without recompiling a substitute. */
    static final class Sealed {
        private final Plan plan;private final Path directory;private final List<WorldPatchCompiler.Write> prefix;private final Map<String,String> events;
        private Sealed(Plan plan,Path directory,List<WorldPatchCompiler.Write> prefix,Map<String,String> events){this.plan=plan;this.directory=directory;this.prefix=List.copyOf(prefix);this.events=Map.copyOf(events);}
        boolean matches(Plan plan,Path directory,List<WorldPatchCompiler.Write> prefix){return this.plan==plan&&this.directory.equals(directory)&&this.prefix.equals(prefix);}
        void verify()throws IOException{
            plan.verifyArchive(directory);var core=core(plan.binding().partHashes().size());int count=0;
            try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){count++;var name=file.getFileName().toString();if(core.contains(name))continue;var expected=events.get(name);if(expected==null||!expected.equals(sha(WorldPatchJournalFiles.read(file,eventMaximum(name)))))throw new IOException("Original sealed whole event changed/unknown; no undo replay");}}
            if(count!=core.size()+events.size()||!events.containsKey("outcome.json"))throw new IOException("Original whole sealed event missing");
        }
        boolean canAuthorizePlacement(){return false;}
    }
    static Live create(Path root,Plan plan)throws IOException{
        Objects.requireNonNull(plan);root=root.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(root);var directory=root.resolve(plan.id.toString());Files.createDirectory(directory);WorldPatchJournalFiles.directory(directory);
        for(var name:core(plan.binding().partHashes().size()))WorldPatchJournalFiles.publish(directory.resolve(name),plan.members.get(name),maximum(name));return new Live(directory,plan);
    }
    /** Disk review can rebuild facts but NEVER mint Live, consent or undo. */
    record Review(UUID id,UUID player,AssemblyPatchBinding binding,String planHash,List<WorldPatchCompiler.Write> confirmed,List<WorldPatchCompiler.Guard> guards,int intentBatches,int missingReceipts,Outcome outcome,String issue){
        Review{confirmed=List.copyOf(confirmed);guards=List.copyOf(guards);}
        boolean needsReview(){return issue!=null||missingReceipts>0||outcome==null;}
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    static Review inspect(Path directory){
        UUID id=null,player=null;AssemblyPatchBinding binding=null;String planHash=null;var confirmed=new ArrayList<WorldPatchCompiler.Write>();List<WorldPatchCompiler.Guard> guards=List.of();int batches=0,missing=0;Outcome outcome=null;
        try{
            directory=directory.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(directory);var plan=WorldPatchJson.parse(WorldPatchJournalFiles.read(directory.resolve("plan.json"),METADATA),()->false);
            WorldPatchJson.keys(plan,"format","version","id","player","originalCaptureId","binding","files","canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication","planHash");
            eq(plan,"format","AssemblyPatchTransactionPlan");WorldPatchJson.integer(plan.get("version"),2,2);id=uuid(plan.get("id"));player=uuid(plan.get("player"));if(!directory.getFileName().toString().equals(id.toString()))throw new IOException("Whole archive path differs");
            for(var flag:List.of("canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication"))falseFlag(plan,flag);
            planHash=WorldPatchJson.text(plan.get("planHash"));var content=plan.deepCopy();content.remove("planHash");if(!SelectionBaseline.hash(content).equals(planHash))throw new IOException("Whole plan hash changed");
            binding=AssemblyPatchBinding.parse(plan.getAsJsonObject("binding"));eq(plan,"originalCaptureId",binding.captureId());
            var core=core(binding.partHashes().size());var files=plan.getAsJsonArray("files");if(files.size()!=core.size()-1)throw new IOException("Incomplete whole original members");var members=new HashMap<String,byte[]>();
            for(int i=0;i<files.size();i++){
                var pin=files.get(i).getAsJsonObject();WorldPatchJson.keys(pin,"path","bytes","sha256");var name=core.get(i);eq(pin,"path",name);var raw=WorldPatchJournalFiles.read(directory.resolve(name),maximum(name));
                if(raw.length!=WorldPatchJson.integer(pin.get("bytes"),1,maximum(name))||!sha(raw).equals(WorldPatchJson.text(pin.get("sha256"))))throw new IOException("Whole member hash/size changed");members.put(name,raw);
            }
            var source=WorldPatchJson.parse(members.get("source.json"),()->false);WorldPatchJson.keys(source,"selection","capture");if(!source.get("selection").equals(binding.selection().json()))throw new IOException("Whole source selection changed");
            var baseline=SelectionBaseline.fromSealedCapture(binding.selection(),source.getAsJsonObject("capture"));var parts=new ArrayList<AssemblyPatchInput.Part>();
            for(int index=0;index<binding.partHashes().size();index++){
                var previewBinding=new WorldPatchPreview.Binding(binding.selection(),binding.contextRevision(),binding.snapshotHash(),binding.selectionHash(),binding.partHashes().get(index),binding.previewHashes().get(index));
                var raw=members.get(partName(index,"preview"));parts.add(new AssemblyPatchInput.Part(index,members.get(partName(index,"proposal")),members.get(partName(index,"patch")),WorldPatchPreview.parse(raw,previewBinding),raw));
            }
            var compiled=AssemblyPatchCompiler.compile(baseline,new AssemblyPatchInput(binding,parts),()->false);guards=compiled.guards();
            var names=new TreeSet<String>();try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){if(names.size()>=core.size()+2*maximumBatches(binding.totalWrites())+2)throw new IOException("Whole journal member quota exceeded");if(!names.add(file.getFileName().toString()))throw new IOException("Duplicate whole archive member");}}
            for(var name:names)if(!core.contains(name)&&!Set.of("outcome.json","ambiguous.json").contains(name)&&!name.matches("[0-9]{6}\\.(intent|applied)\\.json"))throw new IOException("Unknown/partial whole journal member; preserved");
            int offset=0;ReceiptState stopped=null;
            for(var name:names.stream().filter(n->n.endsWith(".intent.json")).toList()){
                batches++;if(!name.equals(eventName(batches,"intent"))||stopped!=null||missing>0)throw new IOException("Whole ordering or unresolved continuation rejected");
                var expected=validateEvent(readEvent(directory.resolve(name),EVENT_BYTES),"AssemblyPatchWriteIntent",id,planHash,batches,offset,compiled.writes(),false);var appliedName=eventName(batches,"applied");
                if(!names.contains(appliedName)){missing++;continue;}
                var applied=readEvent(directory.resolve(appliedName),EVENT_BYTES);var prefix=validateEvent(applied,"AssemblyPatchAppliedPrefix",id,planHash,batches,offset,expected,true);
                var state=ReceiptState.valueOf(WorldPatchJson.text(applied.get("state")));if(state==ReceiptState.COMPLETE?prefix.size()!=expected.size():prefix.size()>=expected.size())throw new IOException("Whole prefix closure differs");
                confirmed.addAll(prefix);offset+=prefix.size();if(state!=ReceiptState.COMPLETE)stopped=state;
            }
            for(var name:names)if(name.endsWith(".applied.json")&&!names.contains(name.replace(".applied.json",".intent.json")))throw new IOException("Whole orphan receipt rejected");
            if(names.contains("ambiguous.json"))throw new IOException("Whole intent explicitly ambiguous; no replay/undo");
            if(names.contains("outcome.json")){
                var result=readEvent(directory.resolve("outcome.json"),METADATA);WorldPatchJson.keys(result,"format","version","id","planHash","outcome","batches","confirmedWrites","worldDurabilityVerified");
                eq(result,"format","AssemblyPatchOperationOutcome");WorldPatchJson.integer(result.get("version"),2,2);eq(result,"id",id.toString());eq(result,"planHash",planHash);falseFlag(result,"worldDurabilityVerified");
                if(missing!=0||WorldPatchJson.integer(result.get("batches"),0,maximumBatches(binding.totalWrites()))!=batches||WorldPatchJson.integer(result.get("confirmedWrites"),0,binding.totalWrites())!=offset)throw new IOException("Whole outcome does not close exact prefixes");
                outcome=Outcome.valueOf(WorldPatchJson.text(result.get("outcome")));if(outcome==Outcome.COMPLETED&&(offset!=binding.totalWrites()||stopped!=null)||stopped!=null&&!stopped.name().equals(outcome.name()))throw new IOException("Whole outcome conflicts with prefix");
            }
            return new Review(id,player,binding,planHash,confirmed,guards,batches,missing,outcome,null);
        }catch(Exception error){return new Review(id,player,binding,planHash,confirmed,guards,batches,missing,outcome,String.valueOf(error.getMessage()));}
    }
    private static List<WorldPatchCompiler.Write> validateEvent(JsonObject value,String format,UUID id,String hash,int index,int offset,List<WorldPatchCompiler.Write> expected,boolean applied)throws IOException{
        if(applied)WorldPatchJson.keys(value,"format","version","id","planHash","index","offset","writes","state");else WorldPatchJson.keys(value,"format","version","id","planHash","index","offset","writes");
        eq(value,"format",format);WorldPatchJson.integer(value.get("version"),2,2);eq(value,"id",id.toString());eq(value,"planHash",hash);WorldPatchJson.integer(value.get("index"),index,index);WorldPatchJson.integer(value.get("offset"),offset,offset);
        var rows=value.getAsJsonArray("writes");int start=applied?0:offset;if(rows==null||rows.size()>BATCH||!applied&&rows.size()!=Math.min(BATCH,expected.size()-offset)||!applied&&rows.isEmpty()||start+rows.size()>expected.size())throw new IOException("Whole fixed batch/prefix differs");
        var writes=new ArrayList<WorldPatchCompiler.Write>();for(int i=0;i<rows.size();i++){var write=expected.get(start+i);if(!writeJson(write).equals(rows.get(i)))throw new IOException("Whole event differs from original complete reconstruction");writes.add(write);}return List.copyOf(writes);
    }
    private static JsonObject event(Plan plan,String format,int index,int offset,List<WorldPatchCompiler.Write> writes,String state){
        var value=new JsonObject();value.addProperty("format",format);value.addProperty("version",2);value.addProperty("id",plan.id.toString());value.addProperty("planHash",plan.hash);value.addProperty("index",index);value.addProperty("offset",offset);
        var rows=new JsonArray();writes.forEach(w->rows.add(writeJson(w)));value.add("writes",rows);if(state!=null)value.addProperty("state",state);return value;
    }
    private static JsonObject writeJson(WorldPatchCompiler.Write write){var value=new JsonObject();value.add("position",write.position().json());value.addProperty("before",write.before());value.addProperty("after",write.after());value.addProperty("action",write.action());value.addProperty("difference",write.difference());return value;}
    private static List<String> core(int parts){var names=new ArrayList<String>();names.add("source.json");for(int index=0;index<parts;index++)for(var kind:List.of("proposal","patch","preview"))names.add(partName(index,kind));names.add("plan.json");return List.copyOf(names);}
    private static String partName(int index,String kind){return String.format(Locale.ROOT,"part-%03d-%s.json",index,kind);}
    private static String eventName(int index,String kind){return String.format(Locale.ROOT,"%06d.%s.json",index,kind);}
    private static int maximum(String name){return name.equals("plan.json")?METADATA:SelectionLimits.snapshotBytes();}
    private static int eventMaximum(String name){return name.equals("outcome.json")||name.equals("ambiguous.json")?METADATA:EVENT_BYTES;}
    private static int maximumBatches(int writes){return (writes+BATCH-1)/BATCH;}
    private static UUID uuid(JsonElement value){var text=WorldPatchJson.text(value);var id=UUID.fromString(text);if(!id.toString().equals(text))throw new IllegalArgumentException("Exact whole UUID required");return id;}
    private static void eq(JsonObject value,String key,String expected){if(!WorldPatchJson.text(value.get(key)).equals(expected))throw new IllegalArgumentException("Original whole identity changed: "+key);}
    private static void falseFlag(JsonObject value,String key){var f=value.get(key);if(f==null||!f.isJsonPrimitive()||!f.getAsJsonPrimitive().isBoolean()||f.getAsBoolean())throw new IllegalArgumentException("Whole archive cannot claim authority/durability");}
    private static byte[] bytes(JsonElement value){return value.toString().getBytes(StandardCharsets.UTF_8);}
    private static String sha(byte[] raw){try{return dev.voxelstudio.Asset.sha(raw);}catch(Exception error){throw new IllegalStateException(error);}}
    private static byte[] eventBytes(JsonObject value){var envelope=new JsonObject();envelope.add("value",value);envelope.addProperty("sha256",SelectionBaseline.hash(value));return bytes(envelope);}
    private static JsonObject readEvent(Path file,int maximum)throws IOException{var envelope=WorldPatchJson.parse(WorldPatchJournalFiles.read(file,maximum),()->false);WorldPatchJson.keys(envelope,"value","sha256");var value=envelope.getAsJsonObject("value");if(!SelectionBaseline.hash(value).equals(WorldPatchJson.text(envelope.get("sha256"))))throw new IOException("Whole event hash changed");return value;}
    private static IOException io(Exception error){return error instanceof IOException e?e:new IOException(error);}
    private AssemblyPatchJournal(){}
}
