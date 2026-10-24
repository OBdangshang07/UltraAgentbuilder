package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Independent grouped write-ahead protocol, NOT legacy whole v2. Preparing a
 * plan or inspecting disk grants no world access, consent or recovery ticket.
 * Each durable packet ends on an ORIGINAL complete operation-group boundary.
 * No automatic replay, replacement, deletion or world-durability assertion. */
final class CoupledAssemblyJournal {
    static final int BATCH=512,EVENT_BYTES=2*1024*1024,METADATA=AssemblyLimits.metadataBytes();
    enum ReceiptState { COMPLETE,CANCELLED,CONFLICT }
    enum Outcome { COMPLETED,CANCELLED,CONFLICT }
    record Packet(int offset,int groupOffset,List<AssemblyCoupledCompiler.Group> groups,List<WorldPatchCompiler.Write> writes){
        Packet{groups=List.copyOf(groups);writes=List.copyOf(writes);}
        int prefixGroups(int count){
            if(count<0||count>writes.size())throw new IllegalArgumentException("Coupled receipt outside original packet");
            int writes=0,index=0;while(writes<count&&index<groups.size())writes+=groups.get(index++).operationIndices().size();
            if(writes!=count)throw new IllegalArgumentException("A coupled group cannot be sealed as a half prefix");return index;
        }
    }
    static final class Plan {
        private final UUID id,player;private final CoupledAssemblyInput input;private final AssemblyCoupledCompiler.Compiled compiled;
        private final Map<String,byte[]> members;private final String hash;
        private Plan(UUID id,UUID player,CoupledAssemblyInput input,AssemblyCoupledCompiler.Compiled compiled,Map<String,byte[]> members,String hash){
            this.id=id;this.player=player;this.input=input;this.compiled=compiled;this.members=Collections.unmodifiableMap(new LinkedHashMap<>(members));this.hash=hash;
        }
        UUID id(){return id;}UUID player(){return player;}String hash(){return hash;}
        CoupledAssemblyBinding binding(){return input.binding();}AssemblyCoupledCompiler.Compiled compiled(){return compiled;}
        boolean canAuthorizePlacement(){return false;}
        Packet packet(int groupOffset){
            if(groupOffset<0||groupOffset>=compiled.groups().size())throw new IllegalArgumentException("Original coupled group cursor required");
            var selected=new ArrayList<AssemblyCoupledCompiler.Group>();var rows=new ArrayList<WorldPatchCompiler.Write>();
            for(int i=groupOffset;i<compiled.groups().size();i++){
                var g=compiled.groups().get(i);if(rows.size()+g.operationIndices().size()>BATCH)break;
                selected.add(g);for(int n:g.operationIndices())rows.add(compiled.writes().get(n));
            }
            if(selected.isEmpty())throw new IllegalStateException("Coupled packet cannot split or omit its first group");
            return new Packet(selected.get(0).offset(),groupOffset,selected,rows);
        }
        void verifyArchive(Path directory)throws IOException{
            WorldPatchJournalFiles.directory(directory);if(!directory.getFileName().toString().equals(id.toString()))throw new IOException("Coupled archive owner changed");
            for(var entry:members.entrySet())if(!Arrays.equals(entry.getValue(),WorldPatchJournalFiles.read(directory.resolve(entry.getKey()),maximum(entry.getKey()))))throw new IOException("Original coupled archive bytes changed");
        }
    }

    static Plan prepare(SelectionReadService.Capture original,CoupledAssemblyInput input,UUID player,BooleanSupplier cancelled){
        return prepare(original,input,null,player,UUID.randomUUID(),cancelled);
    }
    /** The live server path retains its audited Compiled object. A separate
     * archive reconstruction verifies bytes; it NEVER replaces that owner. */
    static Plan prepareOwned(SelectionReadService.Capture original,CoupledAssemblyInput input,AssemblyCoupledCompiler.Compiled owned,UUID player,BooleanSupplier cancelled){
        Objects.requireNonNull(owned);return prepare(original,input,owned,player,UUID.randomUUID(),cancelled);
    }
    private static Plan prepare(SelectionReadService.Capture original,CoupledAssemblyInput input,AssemblyCoupledCompiler.Compiled owned,UUID player,UUID id,BooleanSupplier cancelled){
        Objects.requireNonNull(original);Objects.requireNonNull(input);Objects.requireNonNull(player);Objects.requireNonNull(cancelled);WorldPatchJson.cancelled(cancelled);
        var b=input.binding();if(!original.id().equals(b.captureId())||!original.selection().equals(b.selection())||original.contextRevision()!=b.contextRevision())throw new IllegalArgumentException("Coupled journal requires original capture and whole binding");
        var source=original.payload().getBytes(StandardCharsets.UTF_8);if(source.length>SelectionLimits.snapshotBytes()+65536)throw new IllegalArgumentException("Coupled original source quota");
        var value=WorldPatchJson.parse(source,cancelled);WorldPatchJson.keys(value,"selection","capture");if(!value.get("selection").equals(b.selection().json()))throw new IllegalArgumentException("Coupled source selection differs");
        var baseline=SelectionBaseline.fromSealedCapture(b.selection(),value.getAsJsonObject("capture"),cancelled);
        var again=AssemblyCoupledCompiler.read(baseline,input,cancelled);var compiled=owned==null?again:owned;
        if(owned!=null&&(!owned.fromOriginalInput(input)||!owned.baseline().selection.equals(b.selection())||owned.baseline().contextRevision!=b.contextRevision()
                ||!owned.baseline().snapshotHash.equals(b.snapshotHash())||!owned.baseline().selectionHash.equals(b.selectionHash())
                ||!again.writes().equals(owned.writes())||!again.groups().equals(owned.groups())||!again.plan().equals(owned.plan())||!again.analysis().equals(owned.analysis())))
            throw new IllegalArgumentException("Archived coupled bytes cannot replace original server reconstruction");
        var members=new LinkedHashMap<String,byte[]>();members.put("source.json",source);members.put("binding.json",bytes(b.json()));members.put("native-manifest.json",input.originalManifest());members.put("native-cells.bin",input.originalCells());members.put("coupling-plan.json",input.originalPlan());
        for(var p:input.parts()){WorldPatchJson.cancelled(cancelled);members.put(partName(p.index(),"patch"),p.originalPart());members.put(partName(p.index(),"preview"),p.previewBytes());}
        var plan=new JsonObject();plan.addProperty("format","CoupledAssemblyTransactionPlan");plan.addProperty("version",1);plan.addProperty("id",id.toString());plan.addProperty("player",player.toString());plan.add("binding",b.json());
        var files=new JsonArray();long total=0;for(var entry:members.entrySet()){
            var raw=entry.getValue();if(raw.length<1||raw.length>maximum(entry.getKey()))throw new IllegalArgumentException("Coupled archive member quota");total+=raw.length;
            if(total>AssemblyLimits.candidateBytes()+SelectionLimits.snapshotBytes()+3L*METADATA)throw new IllegalArgumentException("Coupled complete archive quota");
            var pin=new JsonObject();pin.addProperty("path",entry.getKey());pin.addProperty("bytes",raw.length);pin.addProperty("sha256",sha(raw));files.add(pin);
        }
        plan.add("files",files);plan.addProperty("action","original-grouped-forward-only");for(var flag:List.of("canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication"))plan.addProperty(flag,false);
        String hash=SelectionBaseline.hash(plan);plan.addProperty("planHash",hash);var raw=bytes(plan);if(raw.length>METADATA)throw new IllegalArgumentException("Coupled plan metadata quota");members.put("plan.json",raw);
        WorldPatchJson.cancelled(cancelled);return new Plan(id,player,input,compiled,members,hash);
    }

    static final class Intent {
        private final Live owner;private final int index;private final Packet packet;
        private Intent(Live owner,int index,Packet packet){this.owner=owner;this.index=index;this.packet=packet;}
        int index(){return index;}Packet packet(){return packet;}boolean belongs(Plan plan){return owner.plan==plan;}
    }
    static final class Live {
        private final Path directory;private final Plan plan;private final Map<String,String> published=new LinkedHashMap<>();
        private int cursor,groupCursor,batches;private Intent pending;private ReceiptState stopped;private boolean broken,finished;
        private Live(Path directory,Plan plan){this.directory=directory;this.plan=plan;}
        Path directory(){return directory;}Plan plan(){return plan;}
        synchronized Sealed sealed(List<WorldPatchCompiler.Write> prefix,int groups){
            if(broken||!finished||pending!=null||cursor==0||groups!=groupCursor||prefix.size()!=cursor)throw new IllegalStateException("Coupled undo requires this original closed live ledger");
            var expected=new ArrayList<WorldPatchCompiler.Write>();for(var group:plan.compiled.groups().subList(0,groups))for(int n:group.operationIndices())expected.add(plan.compiled.writes().get(n));
            if(!prefix.equals(expected))throw new IllegalStateException("Coupled undo prefix must retain complete original execution groups");
            return new Sealed(plan,directory,prefix,groups,published);
        }
        private void available()throws IOException{if(broken||finished)throw new IOException("Coupled journal closed/unknown; no replay");}
        private void verifyCore()throws IOException{
            plan.verifyArchive(directory);int count=0;try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){count++;var name=file.getFileName().toString();if(plan.members.containsKey(name))continue;var expected=published.get(name);if(expected==null||!expected.equals(sha(WorldPatchJournalFiles.read(file,eventMaximum(name)))))throw new IOException("Unknown or changed original coupled event");}}
            if(count!=plan.members.size()+published.size())throw new IOException("Original coupled member missing");
        }
        private void persist(String name,JsonObject value)throws IOException{var raw=envelope(value);WorldPatchJournalFiles.publish(directory.resolve(name),raw,eventMaximum(name));published.put(name,sha(raw));}
        synchronized Intent intent()throws IOException{
            available();if(pending!=null||stopped!=null||groupCursor>=plan.compiled.groups().size())throw new IOException("One original complete coupled packet required");
            try{verifyCore();var packet=plan.packet(groupCursor);if(packet.offset()!=cursor)throw new IOException("Original coupled group cursor changed");
                var token=new Intent(this,batches+1,packet);persist(eventName(token.index,"intent"),event(plan,"CoupledAssemblyWriteIntent",token.index,packet,packet.writes().size(),null));pending=token;batches++;return token;
            }catch(Exception error){broken=true;throw io(error);}
        }
        synchronized void applied(Intent token,List<WorldPatchCompiler.Write> prefix,ReceiptState state)throws IOException{
            available();if(token==null||token.owner!=this||pending!=token||state==null)throw new IOException("Original coupled pending intent required");
            var rows=List.copyOf(prefix);var packet=token.packet;int groups=packet.prefixGroups(rows.size());
            if(!rows.equals(packet.writes().subList(0,rows.size()))||(state==ReceiptState.COMPLETE?rows.size()!=packet.writes().size():rows.size()==packet.writes().size()))throw new IOException("Coupled receipt must close exact complete original groups");
            try{verifyCore();if(!event(plan,"CoupledAssemblyWriteIntent",token.index,packet,packet.writes().size(),null).equals(readEvent(directory.resolve(eventName(token.index,"intent")),EVENT_BYTES)))throw new IOException("Original coupled intent changed");
                persist(eventName(token.index,"applied"),event(plan,"CoupledAssemblyAppliedGroups",token.index,packet,rows.size(),state.name()));cursor+=rows.size();groupCursor+=groups;pending=null;if(state!=ReceiptState.COMPLETE)stopped=state;
            }catch(Exception error){broken=true;throw io(error);}
        }
        synchronized void finish(Outcome outcome)throws IOException{
            available();if(pending!=null||outcome==null||outcome==Outcome.COMPLETED&&(cursor!=plan.binding().totalWrites()||stopped!=null)||stopped!=null&&!stopped.name().equals(outcome.name()))throw new IOException("Cannot close unresolved coupled groups");
            try{verifyCore();var v=base(plan,"CoupledAssemblyOperationOutcome");v.addProperty("outcome",outcome.name());v.addProperty("batches",batches);v.addProperty("confirmedWrites",cursor);v.addProperty("confirmedGroups",groupCursor);v.addProperty("worldDurabilityVerified",false);persist("outcome.json",v);finished=true;}
            catch(Exception error){broken=true;throw io(error);}
        }
        synchronized void ambiguous(Intent token,String reason)throws IOException{
            available();if(token==null||pending!=token||token.owner!=this)throw new IOException("Original unresolved coupled intent required");broken=true;
            var v=base(plan,"CoupledAssemblyAmbiguousOperation");v.addProperty("index",token.index);var text=String.valueOf(reason);v.addProperty("reason",text.substring(0,Math.min(1024,text.length())));persist("ambiguous.json",v);
        }
    }
    /** Same-live-ledger witness only; an archived Review, self-rehashed file
     * or equal-looking Plan can never construct it. Not final undo consent. */
    static final class Sealed {
        private final Plan plan;private final Path directory;private final List<WorldPatchCompiler.Write> prefix;private final int groups;private final Map<String,String> events;
        private Sealed(Plan plan,Path directory,List<WorldPatchCompiler.Write> prefix,int groups,Map<String,String> events){this.plan=plan;this.directory=directory;this.prefix=List.copyOf(prefix);this.groups=groups;this.events=Map.copyOf(events);}
        boolean matches(Plan original,Path archive,List<WorldPatchCompiler.Write> rows,int count){return plan==original&&directory.equals(archive)&&prefix.equals(rows)&&groups==count;}
        void verify()throws IOException{
            plan.verifyArchive(directory);int count=0;try(var stream=Files.newDirectoryStream(directory)){for(var file:stream){count++;var name=file.getFileName().toString();if(plan.members.containsKey(name))continue;var expected=events.get(name);if(expected==null||!expected.equals(sha(WorldPatchJournalFiles.read(file,eventMaximum(name)))))throw new IOException("Original coupled sealed event changed; no undo adoption");}}
            if(count!=plan.members.size()+events.size()||!events.containsKey("outcome.json"))throw new IOException("Original coupled sealed event missing");
        }
        boolean canAuthorizePlacement(){return false;}
    }
    static Live create(Path root,Plan plan)throws IOException{
        Objects.requireNonNull(plan);root=root.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(root);var directory=root.resolve(plan.id.toString());Files.createDirectory(directory);WorldPatchJournalFiles.directory(directory);
        for(var entry:plan.members.entrySet())WorldPatchJournalFiles.publish(directory.resolve(entry.getKey()),entry.getValue(),maximum(entry.getKey()));return new Live(directory,plan);
    }

    /** Reconstruct facts ONLY. No factory from this result to Live or a native
     * writer exists. A missing/half/ambiguous receipt cannot become a resume. */
    record Review(UUID id,CoupledAssemblyBinding binding,List<WorldPatchCompiler.Write> confirmed,int confirmedGroups,int intentBatches,int missingReceipts,Outcome outcome,String issue,String planHash,UUID player,List<AssemblyCoupledCompiler.Group> confirmedSchedule){
        Review{confirmed=List.copyOf(confirmed);confirmedSchedule=List.copyOf(confirmedSchedule);}boolean needsReview(){return issue!=null||missingReceipts>0||outcome==null;}
        boolean canAuthorizePlacement(){return false;}boolean worldDurabilityVerified(){return false;}
    }
    static Review inspect(Path directory){
        UUID id=null;CoupledAssemblyBinding binding=null;Plan rebuilt=null;var confirmed=new ArrayList<WorldPatchCompiler.Write>();int groups=0,batches=0,missing=0;Outcome outcome=null;
        try{
            directory=directory.toAbsolutePath().normalize();WorldPatchJournalFiles.directory(directory);var v=WorldPatchJson.parse(WorldPatchJournalFiles.read(directory.resolve("plan.json"),METADATA),()->false);
            WorldPatchJson.keys(v,"format","version","id","player","binding","files","action","canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication","planHash");
            eq(v,"format","CoupledAssemblyTransactionPlan");WorldPatchJson.integer(v.get("version"),1,1);eq(v,"action","original-grouped-forward-only");id=uuid(v.get("id"));var player=uuid(v.get("player"));if(!directory.getFileName().toString().equals(id.toString()))throw new IOException("Coupled archive path changed");
            for(String flag:List.of("canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication"))falseFlag(v,flag);
            var content=v.deepCopy();content.remove("planHash");if(!SelectionBaseline.hash(content).equals(WorldPatchJson.text(v.get("planHash"))))throw new IOException("Coupled transaction plan hash changed");
            binding=CoupledAssemblyBinding.parse(v.getAsJsonObject("binding"));var names=core(binding.partHashes().size());var declared=v.getAsJsonArray("files");if(declared.size()!=names.size()-1)throw new IOException("Complete coupled archive members required");
            var members=new HashMap<String,byte[]>();for(int i=0;i<declared.size();i++){
                var pin=declared.get(i).getAsJsonObject();WorldPatchJson.keys(pin,"path","bytes","sha256");String name=names.get(i);eq(pin,"path",name);var raw=WorldPatchJournalFiles.read(directory.resolve(name),maximum(name));
                if(raw.length!=WorldPatchJson.integer(pin.get("bytes"),1,maximum(name))||!sha(raw).equals(WorldPatchJson.text(pin.get("sha256"))))throw new IOException("Original coupled member hash/size differs");members.put(name,raw);
            }
            if(!CoupledAssemblyBinding.parse(members.get("binding.json"),()->false).equals(binding))throw new IOException("Original coupled binding differs");
            var parts=new ArrayList<CoupledAssemblyInput.Part>();for(int i=0;i<binding.partHashes().size();i++)parts.add(new CoupledAssemblyInput.Part(binding,i,members.get(partName(i,"patch")),members.get(partName(i,"preview"))));
            var input=new CoupledAssemblyInput(binding,members.get("native-manifest.json"),members.get("native-cells.bin"),members.get("coupling-plan.json"),parts);
            var capture=new SelectionReadService.Capture(binding.captureId(),binding.selection(),binding.contextRevision(),new String(members.get("source.json"),StandardCharsets.UTF_8),null,false);
            var plan=prepare(capture,input,null,player,id,()->false);if(!Arrays.equals(plan.members.get("plan.json"),bytes(v)))throw new IOException("Coupled archive differs from complete native reconstruction");rebuilt=plan;
            var all=new TreeSet<String>();try(var stream=Files.newDirectoryStream(directory)){for(var f:stream){if(all.size()>=names.size()+2*maximumBatches(binding.totalWrites())+2)throw new IOException("Coupled event file quota");all.add(f.getFileName().toString());}}
            for(var name:all)if(!names.contains(name)&&!Set.of("outcome.json","ambiguous.json").contains(name)&&!name.matches("[0-9]{6}\\.(intent|applied)\\.json"))throw new IOException("Unknown/partial coupled event");
            ReceiptState stopped=null;for(var name:all.stream().filter(n->n.endsWith(".intent.json")).toList()){
                batches++;if(stopped!=null||missing>0||!name.equals(eventName(batches,"intent")))throw new IOException("Coupled intent order/unknown continuation");var packet=plan.packet(groups);
                if(!readEvent(directory.resolve(name),EVENT_BYTES).equals(event(plan,"CoupledAssemblyWriteIntent",batches,packet,packet.writes().size(),null)))throw new IOException("Coupled intent differs from original groups");
                var receiptName=eventName(batches,"applied");if(!all.contains(receiptName)){missing++;continue;}
                var applied=readEvent(directory.resolve(receiptName),EVENT_BYTES);var state=ReceiptState.valueOf(WorldPatchJson.text(applied.get("state")));int count=(int)WorldPatchJson.integer(applied.get("confirmedWrites"),0,packet.writes().size());int closedGroups=packet.prefixGroups(count);
                if((state==ReceiptState.COMPLETE?count!=packet.writes().size():count==packet.writes().size())||!applied.equals(event(plan,"CoupledAssemblyAppliedGroups",batches,packet,count,state.name())))throw new IOException("Coupled receipt changed or split a group");
                confirmed.addAll(packet.writes().subList(0,count));groups+=closedGroups;if(state!=ReceiptState.COMPLETE)stopped=state;
            }
            for(var name:all)if(name.endsWith(".applied.json")&&!all.contains(name.replace(".applied.json",".intent.json")))throw new IOException("Orphan coupled receipt");
            if(all.contains("ambiguous.json"))throw new IOException("Explicit coupled ambiguity; no replay/undo");
            if(all.contains("outcome.json")){
                var result=readEvent(directory.resolve("outcome.json"),METADATA);WorldPatchJson.keys(result,"format","version","id","planHash","outcome","batches","confirmedWrites","confirmedGroups","worldDurabilityVerified");
                eq(result,"format","CoupledAssemblyOperationOutcome");WorldPatchJson.integer(result.get("version"),1,1);eq(result,"id",id.toString());eq(result,"planHash",plan.hash);falseFlag(result,"worldDurabilityVerified");
                WorldPatchJson.integer(result.get("batches"),batches,batches);WorldPatchJson.integer(result.get("confirmedWrites"),confirmed.size(),confirmed.size());WorldPatchJson.integer(result.get("confirmedGroups"),groups,groups);
                outcome=Outcome.valueOf(WorldPatchJson.text(result.get("outcome")));if(missing!=0||outcome==Outcome.COMPLETED&&(confirmed.size()!=binding.totalWrites()||stopped!=null)||stopped!=null&&!stopped.name().equals(outcome.name()))throw new IOException("Coupled outcome cannot close unknown/incomplete groups");
            }
        }catch(Exception error){return review(id,binding,confirmed,groups,batches,missing,outcome,String.valueOf(error.getMessage()),rebuilt);}
        return review(id,binding,confirmed,groups,batches,missing,outcome,null,rebuilt);
    }

    private static Review review(UUID id,CoupledAssemblyBinding binding,List<WorldPatchCompiler.Write> rows,int groups,int batches,int missing,Outcome outcome,String issue,Plan plan){
        return new Review(id,binding,rows,groups,batches,missing,outcome,issue,plan==null?null:plan.hash,plan==null?null:plan.player,plan==null?List.of():plan.compiled.groups().subList(0,groups));
    }

    private static JsonObject base(Plan plan,String format){var v=new JsonObject();v.addProperty("format",format);v.addProperty("version",1);v.addProperty("id",plan.id.toString());v.addProperty("planHash",plan.hash);return v;}
    private static JsonObject event(Plan plan,String format,int index,Packet packet,int count,String state){
        int n=packet.prefixGroups(count);var v=base(plan,format);v.addProperty("index",index);v.addProperty("offset",packet.offset());v.addProperty("groupOffset",packet.groupOffset());
        var groups=new JsonArray();for(var g:packet.groups().subList(0,n)){var r=new JsonObject();r.addProperty("offset",g.offset());r.addProperty("kind",g.kind());var indices=new JsonArray();g.operationIndices().forEach(indices::add);r.add("operationIndices",indices);groups.add(r);}v.add("groups",groups);
        var rows=new JsonArray();for(var w:packet.writes().subList(0,count)){var r=new JsonObject();r.add("position",w.position().json());r.addProperty("before",w.before());r.addProperty("after",w.after());r.addProperty("action",w.action());r.addProperty("difference",w.difference());rows.add(r);}v.add("writes",rows);
        if(state!=null){v.addProperty("confirmedWrites",count);v.addProperty("state",state);}return v;
    }
    private static List<String> core(int parts){var names=new ArrayList<String>(List.of("source.json","binding.json","native-manifest.json","native-cells.bin","coupling-plan.json"));for(int i=0;i<parts;i++){names.add(partName(i,"patch"));names.add(partName(i,"preview"));}names.add("plan.json");return names;}
    private static int maximum(String name){return switch(name){case "source.json"->SelectionLimits.snapshotBytes()+65536;case "native-cells.bin"->Math.toIntExact(SelectionLimits.editCells()*2L);case "plan.json","binding.json","native-manifest.json","coupling-plan.json"->METADATA;default->AssemblyLimits.partBytes();};}
    private static int eventMaximum(String name){return Set.of("outcome.json","ambiguous.json").contains(name)?METADATA:EVENT_BYTES;}
    private static int maximumBatches(int writes){return (writes+BATCH-2)/(BATCH-1);}
    private static String partName(int i,String kind){return String.format(Locale.ROOT,"part-%03d-%s.json",i,kind);}
    private static String eventName(int i,String kind){return String.format(Locale.ROOT,"%06d.%s.json",i,kind);}
    private static byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private static String sha(byte[] b){try{return dev.voxelstudio.Asset.sha(b);}catch(Exception error){throw new IllegalStateException(error);}}
    private static byte[] envelope(JsonObject v){var e=new JsonObject();e.add("value",v);e.addProperty("sha256",SelectionBaseline.hash(v));return bytes(e);}
    private static JsonObject readEvent(Path file,int maximum)throws IOException{var e=WorldPatchJson.parse(WorldPatchJournalFiles.read(file,maximum),()->false);WorldPatchJson.keys(e,"value","sha256");var v=e.getAsJsonObject("value");if(!SelectionBaseline.hash(v).equals(WorldPatchJson.text(e.get("sha256"))))throw new IOException("Coupled event hash mismatch");return v;}
    private static UUID uuid(JsonElement e){String text=WorldPatchJson.text(e);var id=UUID.fromString(text);if(!id.toString().equals(text))throw new IllegalArgumentException("Canonical coupled UUID required");return id;}
    private static void eq(JsonObject v,String key,String text){if(!WorldPatchJson.text(v.get(key)).equals(text))throw new IllegalArgumentException("Coupled original field changed: "+key);}
    private static void falseFlag(JsonObject v,String key){var e=v.get(key);if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isBoolean()||e.getAsBoolean())throw new IllegalArgumentException("Coupled archive cannot attest or authorize");}
    private static IOException io(Exception e){return e instanceof IOException x?x:new IOException(e);}
    private CoupledAssemblyJournal(){}
}
