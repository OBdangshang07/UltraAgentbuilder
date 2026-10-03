package dev.voxelstudio.selection;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Independent server-worker reconstruction of world-patch.mjs against ONLY
 * original server-owned compressed facts. NO world write/load or model API.
 * No compiled object can be constructed from downloaded writes/guards alone. */
final class WorldPatchCompiler {
    record Write(SelectionRegion.Point position,String before,String after,String action,String difference){}
    record Guard(SelectionRegion.Point position,String before,boolean blockEntity,List<String> roles){Guard{roles=List.copyOf(roles);}}
    static final class Compiled {
        private final SelectionBaseline baseline;private final JsonObject content;private final List<Write> writes;private final List<Guard> guards;private final String responseHash,patchHash;
        private Compiled(SelectionBaseline b,JsonObject c,List<Write> writes,List<Guard> guards,String responseHash,String patchHash){baseline=b;content=c.deepCopy();this.writes=List.copyOf(writes);this.guards=List.copyOf(guards);this.responseHash=responseHash;this.patchHash=patchHash;}
        SelectionBaseline baseline(){return baseline;}JsonObject json(){return content.deepCopy();}List<Write> writes(){return writes;}List<Guard> guards(){return guards;}
        String responseHash(){return responseHash;}String patchHash(){return patchHash;}boolean canAuthorizePlacement(){return false;}boolean physicsVerified(){return false;}
    }
    private record Operation(String op,SelectionRegion.Point position,String before,String after){
        JsonObject json(){var o=new JsonObject();o.addProperty("op",op);o.add("position",position.json());o.addProperty("before",before);if(op.equals("set"))o.addProperty("after",after);return o;}
    }
    private static final Comparator<SelectionRegion.Point> ORDER=Comparator.comparingInt(SelectionRegion.Point::y).thenComparingInt(SelectionRegion.Point::z).thenComparingInt(SelectionRegion.Point::x);
    private static int bytes(JsonElement value){return value.toString().getBytes(StandardCharsets.UTF_8).length;}
    private static String digest(JsonElement value){String hash=WorldPatchJson.text(value);if(!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Patch SHA256 required");return hash;}
    static Compiled read(SelectionBaseline original,byte[] bytes,WorldPatchPreview.Binding expected,String originalResponseHash,BooleanSupplier cancelled){
        var raw=WorldPatchJson.parse(bytes,cancelled);
        if(!SelectionBaseline.hash(raw).equals(originalResponseHash))throw new IllegalArgumentException("Original response hash changed");
        var rebuilt=compile(original,raw,cancelled);
        if(!expected.selection().equals(original.selection)||expected.contextRevision()!=original.contextRevision||!expected.snapshotHash().equals(original.snapshotHash)||!expected.selectionHash().equals(original.selectionHash)||!expected.patchHash().equals(rebuilt.patchHash))throw new IllegalArgumentException("Original patch/capture identity changed");
        return rebuilt;
    }
    static void verifyDownloaded(Compiled rebuilt,JsonObject downloaded){
        if(bytes(downloaded)>SelectionLimits.snapshotBytes()||!SelectionBaseline.hash(rebuilt.content).equals(SelectionBaseline.hash(downloaded)))throw new IllegalArgumentException("Downloaded patch differs from server reconstruction");
    }
    static void verifyPreview(Compiled rebuilt,WorldPatchPreview preview,WorldPatchPreview.Binding expected){
        if(!preview.binding().equals(expected)||!expected.patchHash().equals(rebuilt.patchHash)||!expected.snapshotHash().equals(rebuilt.baseline.snapshotHash)||!expected.selection().equals(rebuilt.baseline.selection)||expected.contextRevision()!=rebuilt.baseline.contextRevision||preview.totalWrites()!=rebuilt.writes.size())throw new IllegalArgumentException("Preview/candidate/server source identity differs");
        for(var write:rebuilt.writes){var row=preview.at(write.position);if(row==null||!row.before().equals(write.before)||!row.after().equals(write.after)||!row.difference().name().toLowerCase(Locale.ROOT).equals(write.difference))throw new IllegalArgumentException("Preview diff differs from reconstructed writes");}
    }
    static Compiled compile(SelectionBaseline original,JsonObject raw,BooleanSupplier cancelled){
        Objects.requireNonNull(original);Objects.requireNonNull(raw);Objects.requireNonNull(cancelled);WorldPatchJson.cancelled(cancelled);
        if(bytes(raw)>SelectionLimits.snapshotBytes())throw new IllegalArgumentException("Proposal bytes exceeded");
        WorldPatchJson.keys(raw,"format","version","snapshotHash","selectionHash","operations");
        if(!WorldPatchJson.text(raw.get("format")).equals("WorldPatchProposal"))throw new IllegalArgumentException("Patch proposal required");WorldPatchJson.integer(raw.get("version"),1,1);
        if(!digest(raw.get("snapshotHash")).equals(original.snapshotHash)||!digest(raw.get("selectionHash")).equals(original.selectionHash))throw new IllegalArgumentException("Patch baseline changed");
        var rawOps=raw.getAsJsonArray("operations");if(rawOps==null||rawOps.isEmpty()||rawOps.size()>SelectionLimits.editCells())throw new IllegalArgumentException("Patch operation quota exceeded");
        var operations=new ArrayList<Operation>();var points=new HashSet<SelectionRegion.Point>();int visits=0;
        for(var item:rawOps){if((visits++&1023)==0)WorldPatchJson.cancelled(cancelled);var o=item.getAsJsonObject();String op=WorldPatchJson.text(o.get("op"));
            WorldPatchJson.keys(o,op.equals("set")?new String[]{"op","position","before","after"}:new String[]{"op","position","before"});
            if(!Set.of("keep","clear","set").contains(op))throw new IllegalArgumentException("Unknown patch action");var p=WorldPatchJson.point(o.get("position"));if(!points.add(p))throw new IllegalArgumentException("Duplicate patch position");
            String before=SelectionBaseline.canonicalState(WorldPatchJson.text(o.get("before")));String after=op.equals("set")?SelectionBaseline.canonicalState(WorldPatchJson.text(o.get("after"))):null;operations.add(new Operation(op,p,before,after));
        }
        operations.sort(Comparator.comparing(Operation::position,ORDER));var normalized=new JsonObject();normalized.addProperty("format","WorldPatchProposal");normalized.addProperty("version",1);normalized.addProperty("snapshotHash",original.snapshotHash);normalized.addProperty("selectionHash",original.selectionHash);
        var jsonOps=new JsonArray();for(var op:operations)jsonOps.add(op.json());normalized.add("operations",jsonOps);
        var writes=new ArrayList<Write>();var guards=new TreeMap<SelectionRegion.Point,Guard>(ORDER);long[] accounted={bytes(normalized)+4096L};int keeps=0;
        for(var op:operations){if((visits++&1023)==0)WorldPatchJson.cancelled(cancelled);var p=op.position;
            if(!original.selection.edit().contains(p))throw new IllegalArgumentException("Patch action outside W");var before=original.at(p);
            if(before==null||!before.state().equals(op.before))throw new IllegalArgumentException("Patch BEFORE differs from original known snapshot");
            if(op.op.equals("keep")){keeps++;continue;}
            if(original.selection.protectedAt(p)||WorldPatchStatePolicy.protection(before)!=null)throw new IllegalArgumentException("Patch writes protected baseline");WorldPatchStatePolicy.requireStatic(before.state());
            String after=op.op.equals("clear")?"minecraft:air":op.after;if(op.op.equals("set")&&WorldPatchPreview.air(after))throw new IllegalArgumentException("SET air is not explicit CLEAR");WorldPatchStatePolicy.requireStatic(after);
            if(before.state().equals(after)||WorldPatchPreview.air(before.state())&&WorldPatchPreview.air(after))throw new IllegalArgumentException("No-op patch write");
            guard(original,guards,p,"write",accounted);
            for(int axis=0;axis<3;axis++)for(int side:new int[]{-1,1}){int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=side;var neighbor=new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]);
                var fact=guard(original,guards,neighbor,"neighbor",accounted);WorldPatchStatePolicy.requireNeighbor(fact);
            }
            var write=new Write(p,before.state(),after,op.op,WorldPatchPreview.air(before.state())?"added":WorldPatchPreview.air(after)?"removed":"replaced");account(accounted,bytes(writeJson(write))+1);writes.add(write);
        }
        if(writes.isEmpty())throw new IllegalArgumentException("Patch has no explicit changes");
        int[] lo={Integer.MAX_VALUE,Integer.MAX_VALUE,Integer.MAX_VALUE},hi={Integer.MIN_VALUE,Integer.MIN_VALUE,Integer.MIN_VALUE};var counts=new JsonObject();counts.addProperty("added",0);counts.addProperty("removed",0);counts.addProperty("replaced",0);
        var jsonWrites=new JsonArray();for(var w:writes){jsonWrites.add(writeJson(w));counts.addProperty(w.difference,counts.get(w.difference).getAsInt()+1);for(int axis=0;axis<3;axis++){lo[axis]=Math.min(lo[axis],w.position.axis(axis));hi[axis]=Math.max(hi[axis],w.position.axis(axis)+1);}}
        var jsonGuards=new JsonArray();for(var g:guards.values())jsonGuards.add(guardJson(g));var summary=new JsonObject();summary.addProperty("writes",writes.size());summary.addProperty("explicitKeeps",keeps);summary.addProperty("omittedCells","keep");summary.add("counts",counts);summary.add("bounds",new SelectionRegion(new SelectionRegion.Point(lo[0],lo[1],lo[2]),new SelectionRegion.Point(hi[0],hi[1],hi[2])).json());
        var content=new JsonObject();content.addProperty("format","WorldPatch");content.addProperty("version",1);content.addProperty("policy","static-proposal-data-v1");content.addProperty("snapshotHash",original.snapshotHash);content.addProperty("selectionHash",original.selectionHash);content.add("world",original.selection.world().json());content.addProperty("selectionRevision",original.selection.revision());content.addProperty("contextRevision",original.contextRevision);
        content.add("proposal",normalized);content.addProperty("proposalHash",SelectionBaseline.hash(normalized));content.add("writes",jsonWrites);content.add("guards",jsonGuards);content.add("summary",summary);content.addProperty("canAuthorizePlacement",false);content.addProperty("serverBaselineVerified",false);content.addProperty("physicsVerified",false);
        WorldPatchJson.cancelled(cancelled);if(bytes(content)+128>SelectionLimits.snapshotBytes())throw new IllegalArgumentException("Compiled patch quota exceeded");String patchHash=SelectionBaseline.hash(content);content.addProperty("patchHash",patchHash);
        return new Compiled(original,content,writes,new ArrayList<>(guards.values()),SelectionBaseline.hash(raw),patchHash);
    }
    private static void account(long[] total,long bytes){total[0]+=bytes;if(total[0]>SelectionLimits.snapshotBytes())throw new IllegalArgumentException("Compiled patch working quota exceeded");}
    private static SelectionScan.BlockFact guard(SelectionBaseline original,Map<SelectionRegion.Point,Guard> guards,SelectionRegion.Point p,String role,long[] accounted){
        var fact=original.at(p);if(fact==null)throw new IllegalArgumentException("Patch requires captured known neighbor");var prior=guards.get(p);
        if(prior==null){var next=new Guard(p,fact.state(),fact.blockEntity(),List.of(role));account(accounted,bytes(guardJson(next))+1);guards.put(p,next);}
        else if(!prior.roles.contains(role)){account(accounted,role.length()+3L);var roles=new ArrayList<>(prior.roles);roles.add(role);Collections.sort(roles);guards.put(p,new Guard(p,prior.before,prior.blockEntity,roles));}return fact;
    }
    private static JsonObject writeJson(Write w){var o=new JsonObject();o.add("position",w.position.json());o.addProperty("before",w.before);o.addProperty("after",w.after);o.addProperty("action",w.action);o.addProperty("difference",w.difference);return o;}
    private static JsonObject guardJson(Guard g){var o=new JsonObject();o.add("position",g.position.json());o.addProperty("before",g.before);o.addProperty("blockEntity",g.blockEntity);var roles=new JsonArray();g.roles.forEach(roles::add);o.add("roles",roles);return o;}
    private WorldPatchCompiler(){}
}
