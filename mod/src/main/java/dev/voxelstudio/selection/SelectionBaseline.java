package dev.voxelstudio.selection;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Server-owned compressed facts rebuilt on the bounded worker from the sealed
 * scanner buffer, never from a client receipt or a downloaded baseline. The
 * digest mirrors context-snapshot.mjs; it is integrity, NOT write permission. */
final class SelectionBaseline {
    private record Chunk(SelectionRegion region,List<SelectionScan.BlockFact> palette,int[] ids,long[] ends) {
        SelectionScan.BlockFact at(SelectionRegion.Point p){
            if(palette.isEmpty())return null;
            int w=region.max().x()-region.min().x(),l=region.max().z()-region.min().z();
            long offset=((long)p.y()-region.min().y())*w*l+((long)p.z()-region.min().z())*w+p.x()-region.min().x();
            int lo=0,hi=ends.length-1;while(lo<hi){int mid=(lo+hi)>>>1;if(ends[mid]>offset)hi=mid;else lo=mid+1;}
            return palette.get(ids[lo]);
        }
    }
    final WorldSelection selection;
    final long contextRevision;
    final String snapshotHash,selectionHash;
    private final Map<Long,Chunk> chunks;
    private SelectionBaseline(WorldSelection selection,long revision,String snapshotHash,String selectionHash,Map<Long,Chunk> chunks){
        this.selection=selection;contextRevision=revision;this.snapshotHash=snapshotHash;this.selectionHash=selectionHash;this.chunks=Map.copyOf(chunks);
    }
    private static long key(int x,int z){return ((long)x<<32)^(z&0xffffffffL);}
    static String hash(JsonElement value){try{return Asset.sha(Asset.canonical(value).getBytes(StandardCharsets.UTF_8));}catch(Exception error){throw new IllegalStateException("Cannot hash server baseline",error);}}
    private static void keys(JsonObject value,String... fields){if(value==null||!value.keySet().equals(Set.of(fields)))throw new IllegalArgumentException("Invalid sealed baseline fields");}
    private static long integer(JsonElement value,long low,long high){
        if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("Baseline integer required");
        try{long n=value.getAsBigDecimal().longValueExact();if(n<low||n>high)throw new IllegalArgumentException("Baseline integer out of range");return n;}
        catch(ArithmeticException error){throw new IllegalArgumentException("Baseline integer must be exact",error);}
    }
    private static String text(JsonElement value){if(value==null||!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString())throw new IllegalArgumentException("Baseline string required");return value.getAsString();}
    static String canonicalState(String value){
        // Validate the syntax before indexing. Registry-owned properties are
        // sorted; normalization also matches the Node snapshot contract.
        new SelectionScan.BlockFact(value,false);int at=value.indexOf('[');if(at<0)return value;
        var properties=new TreeMap<String,String>();for(var entry:value.substring(at+1,value.length()-1).split(",",-1)){
            var pair=entry.split("=",-1);if(pair.length!=2||pair[0].isEmpty()||pair[1].isEmpty()||properties.put(pair[0],pair[1])!=null)throw new IllegalArgumentException("Duplicate/invalid baseline property");
        }
        return value.substring(0,at)+"["+properties.entrySet().stream().map(e->e.getKey()+"="+e.getValue()).collect(java.util.stream.Collectors.joining(","))+"]";
    }
    static SelectionBaseline fromSealedCapture(WorldSelection selection,JsonObject capture){
        Objects.requireNonNull(selection);keys(capture,"fence","chunks");var fence=capture.getAsJsonObject("fence");keys(fence,"start","end");
        long revision=integer(fence.get("start"),0,9007199254740991L);if(integer(fence.get("end"),0,9007199254740991L)!=revision)throw new IllegalArgumentException("Mixed server baseline");
        var expected=selection.chunks();var source=capture.getAsJsonArray("chunks");if(source.size()!=expected.size())throw new IllegalArgumentException("Incomplete server baseline coverage");
        var chunks=new HashMap<Long,Chunk>();var normalized=new JsonArray();
        for(int i=0;i<expected.size();i++){
            if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("Baseline preparation cancelled");
            var e=expected.get(i);var raw=source.get(i).getAsJsonObject();keys(raw,"x","z","coverage","palette","runs");
            if(integer(raw.get("x"),-1875000,1874999)!=e.x()||integer(raw.get("z"),-1875000,1874999)!=e.z())throw new IllegalArgumentException("Server chunk order changed");
            String coverage=text(raw.get("coverage"));boolean known=coverage.equals("known");if(!known&&!coverage.equals("unknown"))throw new IllegalArgumentException("Invalid server coverage");
            var palette=new ArrayList<SelectionScan.BlockFact>();var jsonPalette=new JsonArray();var rawPalette=raw.getAsJsonArray("palette");var runs=raw.getAsJsonArray("runs");
            if(known?(rawPalette.isEmpty()||rawPalette.size()>SelectionLimits.paletteStates()||runs.isEmpty()||runs.size()>e.region().cells()):(!rawPalette.isEmpty()||!runs.isEmpty()))throw new IllegalArgumentException("Invalid server compressed coverage");
            var states=new HashSet<String>();for(var item:rawPalette){var fact=item.getAsJsonObject();keys(fact,"state","blockEntity");String state=canonicalState(text(fact.get("state")));var entity=fact.get("blockEntity");
                if(!entity.isJsonPrimitive()||!entity.getAsJsonPrimitive().isBoolean()||!states.add(state))throw new IllegalArgumentException("Contradictory server palette");
                palette.add(new SelectionScan.BlockFact(state,entity.getAsBoolean()));var normalizedFact=new JsonObject();normalizedFact.addProperty("state",state);normalizedFact.addProperty("blockEntity",entity.getAsBoolean());jsonPalette.add(normalizedFact);
            }
            int[] ids=new int[runs.size()];long[] ends=new long[runs.size()];long total=0;int previous=-1;var used=new HashSet<Integer>();var jsonRuns=new JsonArray();
            for(int j=0;j<runs.size();j++){var run=runs.get(j).getAsJsonArray();if(run.size()!=2)throw new IllegalArgumentException("Invalid server run");
                int id=(int)integer(run.get(0),0,palette.size()-1);long count=integer(run.get(1),1,e.region().cells());total+=count;
                if(id==previous||total>e.region().cells())throw new IllegalArgumentException("Noncanonical/overflow server runs");ids[j]=id;ends[j]=total;used.add(id);previous=id;
                var pair=new JsonArray();pair.add(id);pair.add(count);jsonRuns.add(pair);
            }
            if(known&&(total!=e.region().cells()||used.size()!=palette.size()))throw new IllegalArgumentException("Omitted server cells or unused palette");
            chunks.put(key(e.x(),e.z()),new Chunk(e.region(),List.copyOf(palette),ids,ends));
            var content=new JsonObject();content.addProperty("x",e.x());content.addProperty("z",e.z());content.add("region",e.region().json());content.addProperty("coverage",coverage);content.add("palette",jsonPalette);content.add("runs",jsonRuns);content.addProperty("chunkHash",hash(content));normalized.add(content);
        }
        String selectionHash=hash(selection.json());var snapshot=new JsonObject();snapshot.addProperty("format","WorldContextSnapshot");snapshot.addProperty("version",1);snapshot.add("selection",selection.json());snapshot.addProperty("selectionHash",selectionHash);
        snapshot.add("fence",fence.deepCopy());snapshot.add("chunks",normalized);snapshot.addProperty("cellOrder","y-z-x");snapshot.addProperty("privacy","block-states-only");snapshot.addProperty("canAuthorizePlacement",false);
        return new SelectionBaseline(selection,revision,hash(snapshot),selectionHash,chunks);
    }
    SelectionScan.BlockFact at(SelectionRegion.Point point){
        if(!selection.context().contains(point))throw new IllegalArgumentException("Baseline read outside C");
        var chunk=chunks.get(key(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16)));if(chunk==null)throw new IllegalStateException("Missing server baseline chunk");return chunk.at(point);
    }
    List<SelectionRegion> checkRegions(){
        var regions=new ArrayList<SelectionRegion>();var w=selection.edit();var c=selection.context();regions.add(w);
        for(int axis=0;axis<3;axis++)for(int side:new int[]{-1,1}){
            int edge=side<0?w.min().axis(axis)-1:w.max().axis(axis);if(edge<c.min().axis(axis)||edge>=c.max().axis(axis))continue;
            int[] lo={w.min().x(),w.min().y(),w.min().z()},hi={w.max().x(),w.max().y(),w.max().z()};lo[axis]=edge;hi[axis]=edge+1;
            regions.add(new SelectionRegion(new SelectionRegion.Point(lo[0],lo[1],lo[2]),new SelectionRegion.Point(hi[0],hi[1],hi[2])));
        }
        return List.copyOf(regions);
    }
}
