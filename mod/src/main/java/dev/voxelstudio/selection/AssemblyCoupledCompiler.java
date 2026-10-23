package dev.voxelstudio.selection;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Independent complete-native reconstruction on the server worker. A part,
 * report or self-rehashed hash cannot construct Compiled. This does not yet
 * implement a native application gateway, journal, cancellation or undo. */
final class AssemblyCoupledCompiler {
    private static final String ANALYSIS_POLICY="whole-native-new-door-analysis-v1";
    private static final String ORDER_RULE="native-order-promote-matching-upper-after-lower";
    private static final int[][] DIRECTIONS={{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}};
    private static final Comparator<SelectionRegion.Point> ORDER=Comparator.comparingInt(SelectionRegion.Point::y).thenComparingInt(SelectionRegion.Point::z).thenComparingInt(SelectionRegion.Point::x);
    record Group(int offset,String kind,List<Integer> operationIndices){Group{operationIndices=List.copyOf(operationIndices);}}
    static final class Compiled {
        private final SelectionBaseline baseline;private final Native source;private final JsonObject analysis,plan;
        private final List<WorldPatchCompiler.Write> writes;private final List<Integer> nativeIndices;private final List<Group> groups;private final CoupledAssemblyInput checkedInput;
        private Compiled(SelectionBaseline baseline,Native source,JsonObject analysis,JsonObject plan,List<WorldPatchCompiler.Write> writes,List<Integer> indices,List<Group> groups){
            this.baseline=baseline;this.source=source;this.analysis=analysis.deepCopy();this.plan=plan.deepCopy();this.writes=List.copyOf(writes);nativeIndices=List.copyOf(indices);this.groups=List.copyOf(groups);checkedInput=null;
        }
        private Compiled(Compiled original,CoupledAssemblyInput input){baseline=original.baseline;source=original.source;analysis=original.analysis;plan=original.plan;writes=original.writes;nativeIndices=original.nativeIndices;groups=original.groups;checkedInput=Objects.requireNonNull(input);}
        boolean fromOriginalInput(CoupledAssemblyInput input){return checkedInput!=null&&checkedInput==input;}
        SelectionBaseline baseline(){return baseline;}JsonObject analysis(){return analysis.deepCopy();}JsonObject plan(){return plan.deepCopy();}
        List<WorldPatchCompiler.Write> writes(){return writes;}List<Group> groups(){return groups;}
        boolean canAuthorizePlacement(){return false;}boolean physicsVerified(){return false;}
        int partCount(){return (writes.size()+8191)/8192;}
        JsonObject part(int index,BooleanSupplier cancelled){
            if(index<0||index>=partCount())throw new IllegalArgumentException("Whole coupled part index required");WorldPatchJson.cancelled(cancelled);
            int offset=index*8192,end=Math.min(writes.size(),offset+8192);var rows=new JsonArray();var guards=new TreeMap<SelectionRegion.Point,WorldPatchCompiler.Guard>(ORDER);
            for(int i=offset;i<end;i++){
                if((i&1023)==0)WorldPatchJson.cancelled(cancelled);var w=writes.get(i);var row=writeJson(w);row.addProperty("nativeIndex",nativeIndices.get(i));rows.add(row);
                guard(baseline,guards,w.position(),"write");for(var direction:DIRECTIONS)guard(baseline,guards,plus(w.position(),direction),"neighbor");
            }
            var jsonGuards=new JsonArray();for(var g:guards.values()){var row=new JsonObject();row.add("position",g.position().json());row.addProperty("before",g.before());row.addProperty("blockEntity",g.blockEntity());row.add("roles",strings(g.roles()));jsonGuards.add(row);}
            var value=new JsonObject();value.addProperty("format","AssemblyCoupledPart");value.addProperty("version",1);value.addProperty("policy",AssemblyCoupledPolicy.POLICY);value.add("planHash",plan.get("planHash"));
            identity(value,baseline,source);value.addProperty("index",index);value.addProperty("offset",offset);value.addProperty("totalWrites",writes.size());value.add("writes",rows);value.add("guards",jsonGuards);
            value.addProperty("provisional",true);value.addProperty("partIsApplyScope",false);value.addProperty("completePlanRequired",true);value.addProperty("canAuthorizePlacement",false);value.addProperty("worldWrites",0);
            if(bytes(value)+128>AssemblyLimits.partBytes())throw new IllegalArgumentException("Coupled transport part byte quota");value.addProperty("partHash",SelectionBaseline.hash(value));return value;
        }
        JsonObject patchSet(BooleanSupplier cancelled){
            var hashes=new JsonArray();long total=4096;
            for(int i=0;i<partCount();i++){var p=part(i,cancelled);total+=bytes(p);if(total>AssemblyLimits.patchBytes())throw new IllegalArgumentException("Whole coupled part-set byte quota");hashes.add(p.get("partHash"));}
            var v=new JsonObject();v.addProperty("format","AssemblyCoupledPatchSet");v.addProperty("version",1);v.addProperty("policy",AssemblyCoupledPolicy.POLICY);v.add("planHash",plan.get("planHash"));identity(v,baseline,source);
            v.addProperty("operationCount",writes.size());v.addProperty("partCount",partCount());v.add("partHashes",hashes);v.addProperty("fullAssetProcessed",true);v.addProperty("partialPublicationAllowed",false);
            v.addProperty("canAuthorizePlacement",false);v.addProperty("serverBaselineVerified",false);v.addProperty("physicsVerified",false);v.addProperty("worldWrites",0);v.addProperty("patchSetHash",SelectionBaseline.hash(v));return v;
        }
        void verifyPart(int index,JsonObject downloaded,BooleanSupplier cancelled){if(!part(index,cancelled).equals(downloaded))throw new IllegalArgumentException("Downloaded coupled part differs from complete original native");}
        WorldPatchPreview.Binding previewBinding(int index,String previewHash,BooleanSupplier cancelled){
            return new WorldPatchPreview.Binding(baseline.selection,baseline.contextRevision,baseline.snapshotHash,baseline.selectionHash,
                    WorldPatchJson.text(part(index,cancelled).get("partHash")),previewHash,WorldPatchJson.text(plan.get("planHash")),AssemblyCoupledPolicy.HASH);
        }
        /** Display must agree with this server-owned COMPLETE native rebuild,
         * not just the downloaded part, report or caller's self-rehashed pins. */
        void verifyPreview(int index,WorldPatchPreview preview,WorldPatchPreview.Binding expected,BooleanSupplier cancelled){
            if(!expected.coupled()||!preview.binding().equals(expected)||!expected.equals(previewBinding(index,expected.previewHash(),cancelled)))throw new IllegalArgumentException("Coupled preview/whole native identity differs");
            int offset=index*8192,end=Math.min(writes.size(),offset+8192);if(preview.totalWrites()!=end-offset)throw new IllegalArgumentException("Coupled preview omitted native changes");
            for(int i=offset;i<end;i++){
                if((i&1023)==0)WorldPatchJson.cancelled(cancelled);var w=writes.get(i);var row=preview.at(w.position());
                if(row==null||!row.before().equals(w.before())||!row.after().equals(w.after())||!row.difference().name().toLowerCase(Locale.ROOT).equals(w.difference()))throw new IllegalArgumentException("Coupled preview differs from exact native rows");
            }
        }
    }
    private static final class Native {
        final JsonObject manifest;final byte[] cells;final List<String> palette;final int width,height,length,plane,volume;
        final Map<Integer,AssemblyCoupledPolicy.State> states=new HashMap<>();
        Native(JsonObject input,byte[] data,SelectionBaseline baseline,BooleanSupplier cancelled){
            Objects.requireNonNull(input);Objects.requireNonNull(data);manifest=input.deepCopy();var dimensions=manifest.getAsJsonObject("dimensions");WorldPatchJson.keys(dimensions,"width","height","length");
            width=(int)WorldPatchJson.integer(dimensions.get("width"),1,Asset.MAX_WIDTH);height=(int)WorldPatchJson.integer(dimensions.get("height"),1,Asset.MAX_HEIGHT);length=(int)WorldPatchJson.integer(dimensions.get("length"),1,Asset.MAX_LENGTH);
            var edit=baseline.selection.edit();long v=(long)width*height*length;
            if(v>Asset.MAX_VOLUME||v*2!=data.length||width>edit.max().x()-edit.min().x()||height>edit.max().y()-edit.min().y()||length>edit.max().z()-edit.min().z())throw new IllegalArgumentException("Native coupled dimensions exceed original W");
            if(manifest.has("diagnosticOnly")&&(!manifest.get("diagnosticOnly").isJsonPrimitive()||!manifest.get("diagnosticOnly").getAsJsonPrimitive().isBoolean()||manifest.get("diagnosticOnly").getAsBoolean()))throw new IllegalArgumentException("Diagnostic native is not eligible");
            var metadata=manifest.deepCopy();metadata.remove("assetHash");if(!SelectionBaseline.hash(metadata).equals(digest(manifest,"assetHash")))throw new IllegalArgumentException("Coupled native asset hash mismatch");
            cells=data.clone();if(!binaryHash(cells).equals(digest(manifest,"cellsHash")))throw new IllegalArgumentException("Coupled native cells hash mismatch");
            plane=width*length;volume=(int)v;var raw=manifest.getAsJsonArray("palette");if(raw==null||raw.size()<2||raw.size()>256)throw new IllegalArgumentException("Coupled native palette quota");
            var p=new ArrayList<String>();for(var item:raw){String text=WorldPatchJson.text(item);if(text.isEmpty()||text.length()>512)throw new IllegalArgumentException("Native palette state length quota");p.add(text);}palette=List.copyOf(p);
            if(!palette.get(0).equals("@keep")||!palette.get(1).equals("minecraft:air"))throw new IllegalArgumentException("Exact native KEEP/CLEAR palette required");
            int sets=0,clears=0;var used=new TreeSet<Integer>();
            for(int i=0;i<volume;i++){if((i&1023)==0)WorldPatchJson.cancelled(cancelled);int n=cell(i);if(n>=palette.size())throw new IllegalArgumentException("Coupled palette index outside native");if(n>=2){sets++;used.add(n);}else if(n==1)clears++;}
            if(WorldPatchJson.integer(manifest.get("setCount"),0,volume)!=sets||WorldPatchJson.integer(manifest.get("clearCount"),0,volume)!=clears)throw new IllegalArgumentException("Coupled native set/clear count mismatch");
            for(int n:used)states.put(n,AssemblyCoupledPolicy.target(palette.get(n)));
        }
        int cell(int index){return (cells[index*2]&255)|((cells[index*2+1]&255)<<8);}
        SelectionRegion.Point position(SelectionBaseline b,int i){var o=b.selection.edit().min();return new SelectionRegion.Point(o.x()+i%width,o.y()+i/plane,o.z()+i/width%length);}
    }
    private static final class Check {
        final SelectionBaseline baseline;int reads;final Set<String> checked=new HashSet<>();
        Check(SelectionBaseline baseline){this.baseline=baseline;}
        SelectionScan.BlockFact read(SelectionRegion.Point p){
            if(!baseline.selection.context().contains(p))throw new IllegalArgumentException("Coupled six-neighbor closure outside C");var fact=baseline.at(p);reads++;if(fact==null)throw new IllegalArgumentException("Coupled UNKNOWN baseline/neighbor");return fact;
        }
        void guard(SelectionRegion.Point p,boolean neighbor){var f=read(p);String reason=WorldPatchStatePolicy.protection(f);if(reason!=null)throw new IllegalArgumentException("Unsafe coupled BEFORE/neighbor: "+reason);
            if(checked.add(f.state()))WorldPatchStatePolicy.requireStatic(f.state());
            if(neighbor&&AssemblyCoupledPolicy.state(f.state()).id().endsWith("_stairs"))throw new IllegalArgumentException("Protected adjacent BEFORE stair");}
    }
    /** Entire new packet must reconstruct against the ORIGINAL server-owned
     * baseline. Caller identity and hashes alone never become a Compiled. */
    static Compiled read(SelectionBaseline baseline,CoupledAssemblyInput input,BooleanSupplier cancelled){
        Objects.requireNonNull(input);WorldPatchJson.cancelled(cancelled);var b=input.binding();
        if(!baseline.selection.equals(b.selection())||baseline.contextRevision!=b.contextRevision()||!baseline.snapshotHash.equals(b.snapshotHash())||!baseline.selectionHash.equals(b.selectionHash()))throw new IllegalArgumentException("Coupled input belongs to another original server baseline");
        var manifest=WorldPatchJson.parse(input.originalManifest(),cancelled);var rebuilt=compile(baseline,manifest,input.originalCells(),cancelled);var p=rebuilt.plan();
        if(!AssemblyCoupledPolicy.HASH.equals(b.couplingPolicyHash())||!WorldPatchJson.text(p.get("planHash")).equals(b.couplingPlanHash())||!WorldPatchJson.text(p.get("analysisHash")).equals(b.analysisHash())||!WorldPatchJson.text(p.get("scheduleHash")).equals(b.scheduleHash())||!WorldPatchJson.text(p.get("assetHash")).equals(b.assetHash())||!WorldPatchJson.text(p.get("cellsHash")).equals(b.cellsHash())||rebuilt.writes.size()!=b.totalWrites()||!p.equals(WorldPatchJson.parse(input.originalPlan(),cancelled)))throw new IllegalArgumentException("Coupled whole input differs from native reconstruction");
        var scene=manifest.getAsJsonObject("scene");if(scene==null||!WorldPatchJson.text(scene.get("sourceHash")).equals(b.sourceHash()))throw new IllegalArgumentException("Coupled native source differs from selected whole SceneSpec");
        for(int i=0;i<input.parts().size();i++){
            WorldPatchJson.cancelled(cancelled);var part=input.parts().get(i);rebuilt.verifyPart(i,WorldPatchJson.parse(part.originalPart(),cancelled),cancelled);rebuilt.verifyPreview(i,part.preview(),b.previewBinding(i),cancelled);
        }
        if(!rebuilt.patchSet(cancelled).equals(b.patchSet()))throw new IllegalArgumentException("Coupled full set differs from independent original reconstruction");
        return new Compiled(rebuilt,input);
    }
    static Compiled compile(SelectionBaseline baseline,JsonObject manifest,byte[] cells,BooleanSupplier cancelled){
        Objects.requireNonNull(baseline);Objects.requireNonNull(cancelled);WorldPatchJson.cancelled(cancelled);var source=new Native(manifest,cells,baseline,cancelled);var check=new Check(baseline);
        var counts=new JsonObject();for(String name:List.of("door","trapdoor","stairs","slab","static"))counts.addProperty(name,0);
        var writes=new ArrayList<WorldPatchCompiler.Write>();var nativeIndices=new ArrayList<Integer>();int[] ranks=new int[source.volume];Arrays.fill(ranks,-1);
        for(int i=0;i<source.volume;i++){
            if((i&1023)==0)WorldPatchJson.cancelled(cancelled);int n=source.cell(i);if(n==0)continue;var p=source.position(baseline,i);var before=check.read(p);String after=source.palette.get(n);
            if(n>=2){String id=source.states.get(n).id(),kind=id.endsWith("_door")?"door":id.endsWith("_trapdoor")?"trapdoor":id.endsWith("_stairs")?"stairs":id.endsWith("_slab")?"slab":"static";counts.addProperty(kind,counts.get(kind).getAsInt()+1);}
            if(before.state().equals(after)||n==1&&WorldPatchPreview.air(before.state()))continue;
            if(baseline.selection.protectedAt(p)||WorldPatchStatePolicy.protection(before)!=null)throw new IllegalArgumentException("Coupled write touches protected BEFORE");
            check.guard(p,false);for(var direction:DIRECTIONS)check.guard(plus(p,direction),true);
            ranks[i]=writes.size();nativeIndices.add(i);writes.add(new WorldPatchCompiler.Write(p,before.state(),after,n==1?"clear":"set",WorldPatchPreview.air(before.state())?"added":WorldPatchPreview.air(after)?"removed":"replaced"));
        }
        if(writes.isEmpty())throw new IllegalArgumentException("Coupled native has no explicit changes");
        var doorGroups=new JsonArray();long reportBytes=4096;
        for(int i=0;i<source.volume;i++){
            if((i&1023)==0)WorldPatchJson.cancelled(cancelled);var a=source.states.get(source.cell(i));if(a==null||!a.id().endsWith("_door"))continue;
            boolean lower=a.properties().get("half").equals("lower");int y=i/source.plane,other=i+(lower?source.plane:-source.plane),otherY=y+(lower?1:-1);
            var b=otherY<0||otherY>=source.height?null:source.states.get(source.cell(other));
            if(b==null||!a.id().equals(b.id())||!b.properties().get("half").equals(lower?"upper":"lower")
                    ||List.of("facing","hinge","open","powered").stream().anyMatch(k->!a.properties().get(k).equals(b.properties().get(k))))throw new IllegalArgumentException("Coupled door needs explicit matching halves");
            if(!lower)continue;var below=plus(source.position(baseline,i),new int[]{0,-1,0});int support=y==0?0:source.cell(i-source.plane);
            String supportState=support==0?check.read(below).state():source.palette.get(support);
            if(!AssemblyCoupledPolicy.fullUpperFace(supportState))throw new IllegalArgumentException("Coupled door final UP-face support missing");
            var group=new JsonObject();group.addProperty("kind","door-pair");group.add("indices",numbers(i,other));var positions=new JsonArray();positions.add(source.position(baseline,i).json());positions.add(source.position(baseline,other).json());group.add("positions",positions);
            group.add("states",strings(List.of(source.palette.get(source.cell(i)),source.palette.get(source.cell(other)))));var s=new JsonObject();s.add("position",below.json());s.addProperty("state",supportState);s.addProperty("source",support==0?"snapshot-keep":"native-after");group.add("support",s);
            reportBytes+=bytes(group)+1L;if(reportBytes>AssemblyLimits.proposalBytes())throw new IllegalArgumentException("Coupling analysis report quota");doorGroups.add(group);
        }
        var analysis=analysis(baseline,source,check.reads,writes.size(),counts,doorGroups);var pairs=new JsonArray();var orderPairs=new JsonArray();var lowers=new HashMap<Integer,List<Integer>>();var uppers=new HashSet<Integer>();
        for(var element:doorGroups){var g=element.getAsJsonObject();var ni=g.getAsJsonArray("indices");int a=ranks[ni.get(0).getAsInt()],b=ranks[ni.get(1).getAsInt()];if(a<0&&b<0)continue;if(a<0||b<0||a>=b)throw new IllegalArgumentException("Complete changed door pair required");
            var pair=new JsonObject();pair.add("nativeIndices",ni.deepCopy());pair.add("operationIndices",numbers(a,b));pair.add("positions",g.get("positions").deepCopy());pair.add("states",g.get("states").deepCopy());pair.add("support",g.get("support").deepCopy());pairs.add(pair);orderPairs.add(numbers(a,b));lowers.put(a,List.of(a,b));uppers.add(b);
        }
        var schedule=new JsonObject();schedule.addProperty("rule",ORDER_RULE);schedule.addProperty("operationCount",writes.size());schedule.add("pairs",orderPairs);
        var plan=new JsonObject();plan.addProperty("format","AssemblyCoupledPlan");plan.addProperty("version",1);plan.addProperty("policy",AssemblyCoupledPolicy.POLICY);plan.addProperty("policyHash",AssemblyCoupledPolicy.HASH);identity(plan,baseline,source);
        plan.add("analysisHash",analysis.get("analysisHash"));plan.add("origin",baseline.selection.edit().min().json());plan.add("dimensions",source.manifest.get("dimensions").deepCopy());plan.addProperty("operationCount",writes.size());plan.addProperty("pairCount",pairs.size());plan.add("pairs",pairs);plan.addProperty("scheduleHash",SelectionBaseline.hash(schedule));plan.addProperty("executionOrder",ORDER_RULE);
        plan.addProperty("partScope","transport-only-complete-plan-required");plan.addProperty("omittedCells","keep");plan.addProperty("existingCoupledBeforeWritesAllowed",false);plan.addProperty("serverBaselineVerified",false);plan.addProperty("physicsVerified",false);plan.addProperty("canAuthorizePlacement",false);plan.addProperty("worldWrites",0);
        if(bytes(plan)+128>AssemblyLimits.metadataBytes())throw new IllegalArgumentException("Coupled plan metadata quota");plan.addProperty("planHash",SelectionBaseline.hash(plan));
        var groups=new ArrayList<Group>();int offset=0;for(int i=0;i<writes.size();i++){if((i&1023)==0)WorldPatchJson.cancelled(cancelled);if(uppers.contains(i))continue;var indices=lowers.getOrDefault(i,List.of(i));groups.add(new Group(offset,indices.size()==2?"door-pair":"single",indices));offset+=indices.size();}
        if(offset!=writes.size())throw new IllegalArgumentException("Whole coupled schedule incomplete");WorldPatchJson.cancelled(cancelled);return new Compiled(baseline,source,analysis,plan,writes,nativeIndices,groups);
    }
    private static JsonObject analysis(SelectionBaseline baseline,Native source,int reads,int operations,JsonObject counts,JsonArray groups){
        var a=new JsonObject();a.addProperty("format","AssemblyCouplingAnalysis");a.addProperty("version",1);a.addProperty("policy",ANALYSIS_POLICY);identity(a,baseline,source);a.add("origin",baseline.selection.edit().min().json());a.add("dimensions",source.manifest.get("dimensions").deepCopy());
        a.addProperty("operationCount",operations);a.addProperty("baselineReads",reads);a.add("counts",counts);a.add("groups",groups);a.addProperty("omittedCells","keep");a.addProperty("groupScope","complete-native-not-parts");a.addProperty("existingCoupledBeforeWritesAllowed",false);a.addProperty("trapdoorSupport","no-attachment-requirement-vanilla-1.20.1");
        a.addProperty("dataSupportChecked",true);a.addProperty("serverBaselineVerified",false);a.addProperty("physicsVerified",false);a.addProperty("applicationIntegrated",false);a.addProperty("canAuthorizePlacement",false);a.addProperty("worldWrites",0);a.addProperty("analysisHash",SelectionBaseline.hash(a));return a;
    }
    private static void identity(JsonObject value,SelectionBaseline baseline,Native source){value.addProperty("snapshotHash",baseline.snapshotHash);value.addProperty("selectionHash",baseline.selectionHash);value.add("assetHash",source.manifest.get("assetHash"));value.add("cellsHash",source.manifest.get("cellsHash"));}
    private static String digest(JsonObject v,String key){String text=WorldPatchJson.text(v.get(key));if(!text.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Coupled native SHA256 required");return text;}
    private static String binaryHash(byte[] value){try{return Asset.sha(value);}catch(Exception error){throw new IllegalStateException("Cannot hash coupled native cells",error);}}
    private static int bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8).length;}
    private static SelectionRegion.Point plus(SelectionRegion.Point p,int[] d){return new SelectionRegion.Point(p.x()+d[0],p.y()+d[1],p.z()+d[2]);}
    private static JsonArray numbers(int... values){var a=new JsonArray();for(int n:values)a.add(n);return a;}
    private static JsonArray strings(Collection<String> values){var a=new JsonArray();for(String value:values)a.add(value);return a;}
    private static JsonObject writeJson(WorldPatchCompiler.Write w){var v=new JsonObject();v.add("position",w.position().json());v.addProperty("before",w.before());v.addProperty("after",w.after());v.addProperty("action",w.action());v.addProperty("difference",w.difference());return v;}
    private static void guard(SelectionBaseline baseline,Map<SelectionRegion.Point,WorldPatchCompiler.Guard> guards,SelectionRegion.Point p,String role){
        var f=baseline.at(p);if(f==null)throw new IllegalArgumentException("Coupled known guard required");var prior=guards.get(p);var roles=new TreeSet<String>();if(prior!=null)roles.addAll(prior.roles());roles.add(role);guards.put(p,new WorldPatchCompiler.Guard(p,f.state(),f.blockEntity(),new ArrayList<>(roles)));
    }
    private AssemblyCoupledCompiler(){}
}
