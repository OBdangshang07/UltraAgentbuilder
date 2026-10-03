package dev.voxelstudio.selection;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;

/** Experimental READ-ONLY sparse display. NOT an Asset or a write transaction.
 * The expected hashes must come from original-snapshot validation upstream.
 * Parsing here checks structure/digests/scope, not live server BEFORE states,
 * physics or permission. No production import or placement endpoint exists. */
public final class WorldPatchPreview {
    public enum Difference { ADDED, REMOVED, REPLACED }
    public enum Mode { CHANGES, BEFORE, AFTER }
    public record Binding(WorldSelection selection,long contextRevision,String snapshotHash,
                          String selectionHash,String patchHash,String previewHash) {
        public Binding {
            Objects.requireNonNull(selection); revision(contextRevision);
            for(var hash:List.of(snapshotHash,selectionHash,patchHash,previewHash)) digest(hash);
            if(!sha(selection.json()).equals(selectionHash)) fail("Selection digest mismatch");
        }
    }
    public record Row(SelectionRegion.Point position,String before,String after,Difference difference) {}
    public record Section(int x,int y,int z,List<Row> rows) {
        public Section {rows=List.copyOf(rows);}
    }
    public record Filter(Mode mode,int minY,int maxY,Set<Difference> categories) {
        public Filter {Objects.requireNonNull(mode);categories=Set.copyOf(categories);if(minY>=maxY)fail("Empty layer range");}
        public boolean includes(Row row){return row.position.y()>=minY&&row.position.y()<maxY&&categories.contains(row.difference);}
    }
    private final Binding binding;
    private final List<Section> sections;
    private final List<String> palette;
    private final SelectionRegion bounds;
    private final Map<SelectionRegion.Point,Row> positions;
    private final Map<Difference,Integer> counts;
    private WorldPatchPreview(Binding binding,List<Section> sections,List<String> palette,SelectionRegion bounds,Map<SelectionRegion.Point,Row> positions,Map<Difference,Integer> counts){
        this.binding=binding;this.sections=List.copyOf(sections);this.palette=List.copyOf(palette);this.bounds=bounds;this.positions=Map.copyOf(positions);this.counts=Map.copyOf(counts);
    }
    public Binding binding(){return binding;}
    public List<Section> sections(){return sections;}
    public List<String> palette(){return palette;}
    public SelectionRegion bounds(){return bounds;}
    public int totalWrites(){return positions.size();}
    public Map<Difference,Integer> counts(){return counts;}
    public boolean canAuthorizePlacement(){return false;}
    public boolean movable(){return false;}
    public Filter all(Mode mode){return new Filter(mode,bounds.min().y(),bounds.max().y(),EnumSet.allOf(Difference.class));}
    public Filter checked(Filter filter){var world=binding.selection.world();if(filter.minY<world.minY()||filter.maxY>world.maxY())fail("Layer range outside dimension");return filter;}
    public Row at(SelectionRegion.Point point){return positions.get(point);}
    public List<Row> visible(Filter filter){checked(filter);return sections.stream().flatMap(s->s.rows.stream()).filter(filter::includes).toList();}
    public static String displayState(Row row,Mode mode,boolean original){
        if(mode==Mode.BEFORE)return original&&row.difference!=Difference.ADDED?row.before:null;
        if(mode==Mode.AFTER)return !original&&row.difference!=Difference.REMOVED?row.after:null;
        return original?(row.difference!=Difference.ADDED?row.before:null):(row.difference!=Difference.REMOVED?row.after:null);
    }
    public static WorldPatchPreview parse(byte[] bytes,Binding expected){return parse(bytes,expected,()->false);}
    public static WorldPatchPreview parse(byte[] bytes,Binding expected,BooleanSupplier cancelled){
        Objects.requireNonNull(bytes);Objects.requireNonNull(expected);Objects.requireNonNull(cancelled);
        checkCancelled(cancelled);if(bytes.length>SelectionLimits.snapshotBytes())fail("Preview byte quota exceeded");
        var value=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
        keys(value,"format","version","policy","snapshotHash","selectionHash","patchHash","world","selectionRevision","contextRevision","coordinateSpace","movable","bounds","palette","sections","summary","canAuthorizePlacement","serverBaselineVerified","physicsVerified","worldRendered","previewHash");
        eq(value,"format","WorldPatchPreview");number(value.get("version"),1,1);eq(value,"policy","static-patch-preview-data-v1");eq(value,"coordinateSpace","original-world-absolute");
        for(var key:List.of("movable","canAuthorizePlacement","serverBaselineVerified","physicsVerified","worldRendered")) falseFlag(value,key);
        eq(value,"snapshotHash",expected.snapshotHash);eq(value,"selectionHash",expected.selectionHash);eq(value,"patchHash",expected.patchHash);eq(value,"previewHash",expected.previewHash);
        if(!value.get("world").equals(expected.selection.world().json()))fail("World/dimension mismatch");
        if(number(value.get("selectionRevision"),0,9007199254740991L)!=expected.selection.revision()||number(value.get("contextRevision"),0,9007199254740991L)!=expected.contextRevision)fail("Stale snapshot revision");
        var content=value.deepCopy();content.remove("previewHash");if(!sha(content).equals(expected.previewHash))fail("Preview content hash mismatch");
        var box=value.getAsJsonObject("bounds");keys(box,"min","max");var bounds=new SelectionRegion(point(box.get("min")),point(box.get("max")));
        if(!expected.selection.edit().contains(bounds))fail("Bounds outside edit scope");
        var palette=new ArrayList<String>();String last=null;
        var rawPalette=value.getAsJsonArray("palette");if(rawPalette.size()<2||rawPalette.size()>SelectionLimits.paletteStates())fail("Palette quota exceeded");
        for(var item:rawPalette){String state=string(item);if(!state.matches("minecraft:[a-z0-9_]+(?:\\[[a-z0-9_]+=[a-z0-9_-]+(?:,[a-z0-9_]+=[a-z0-9_-]+)*\\])?"))fail("Invalid block state syntax");if(last!=null&&last.compareTo(state)>=0)fail("Palette not sorted/unique");palette.add(state);last=state;}
        var counts=new EnumMap<Difference,Integer>(Difference.class);for(var d:Difference.values())counts.put(d,0);
        var positions=new HashMap<SelectionRegion.Point,Row>();var sections=new ArrayList<Section>();Section previous=null;int visited=0;
        int loX=Integer.MAX_VALUE,loY=loX,loZ=loX,hiX=Integer.MIN_VALUE,hiY=hiX,hiZ=hiX;
        var rawSections=value.getAsJsonArray("sections");if(rawSections.size()<1||rawSections.size()>SelectionLimits.editCells())fail("Section quota exceeded");
        for(var element:rawSections){
            checkCancelled(cancelled);var s=element.getAsJsonObject();keys(s,"x","y","z","rows");
            int sx=(int)number(s.get("x"),-1875000,1874999),sy=(int)number(s.get("y"),-128,127),sz=(int)number(s.get("z"),-1875000,1874999);
            var rows=new ArrayList<Row>();int previousIndex=-1;var rawRows=s.getAsJsonArray("rows");if(rawRows.size()<1||rawRows.size()>4096)fail("Invalid sparse section");
            for(var elementRow:rawRows){
                if((visited++&1023)==0)checkCancelled(cancelled);if(visited>SelectionLimits.editCells())fail("Row quota exceeded");
                var r=elementRow.getAsJsonArray();if(r.size()!=4)fail("Invalid row");int index=(int)number(r.get(0),0,4095);if(index<=previousIndex)fail("Rows not sorted/unique");previousIndex=index;
                String before=palette.get((int)number(r.get(1),0,palette.size()-1)),after=palette.get((int)number(r.get(2),0,palette.size()-1));var difference=Difference.values()[(int)number(r.get(3),0,2)];
                var position=new SelectionRegion.Point(sx*16+index%16,sy*16+index/256,sz*16+index/16%16);
                if(!bounds.contains(position)||expected.selection.protectedAt(position))fail("Row outside bounds or protected scope");
                if(before.equals(after)||air(before)&&air(after)||difference!=(air(before)?Difference.ADDED:air(after)?Difference.REMOVED:Difference.REPLACED))fail("Difference classification mismatch");
                var row=new Row(position,before,after,difference);if(positions.put(position,row)!=null)fail("Duplicate coordinate");rows.add(row);counts.merge(difference,1,Integer::sum);
                loX=Math.min(loX,position.x());loY=Math.min(loY,position.y());loZ=Math.min(loZ,position.z());hiX=Math.max(hiX,position.x()+1);hiY=Math.max(hiY,position.y()+1);hiZ=Math.max(hiZ,position.z()+1);
            }
            var section=new Section(sx,sy,sz,rows);if(previous!=null&&compare(previous,section)>=0)fail("Sections not sorted/unique");previous=section;sections.add(section);
        }
        if(!bounds.equals(new SelectionRegion(new SelectionRegion.Point(loX,loY,loZ),new SelectionRegion.Point(hiX,hiY,hiZ))))fail("Changed-cell bounds mismatch");
        var summary=value.getAsJsonObject("summary");keys(summary,"writes","counts","omittedCells","explicitKeeps");eq(summary,"omittedCells","keep");
        if(number(summary.get("writes"),1,SelectionLimits.editCells())!=positions.size())fail("Write count mismatch");number(summary.get("explicitKeeps"),0,SelectionLimits.editCells());var totals=summary.getAsJsonObject("counts");keys(totals,"added","removed","replaced");for(var d:Difference.values())if(number(totals.get(d.name().toLowerCase(Locale.ROOT)),0,SelectionLimits.editCells())!=counts.get(d))fail("Category count mismatch");
        checkCancelled(cancelled);return new WorldPatchPreview(expected,sections,palette,bounds,positions,counts);
    }
    private static int compare(Section a,Section b){int n=Integer.compare(a.y,b.y);if(n==0)n=Integer.compare(a.z,b.z);return n==0?Integer.compare(a.x,b.x):n;}
    public static boolean air(String s){return s.equals("minecraft:air")||s.equals("minecraft:cave_air")||s.equals("minecraft:void_air");}
    private static SelectionRegion.Point point(JsonElement value){var a=value.getAsJsonArray();if(a.size()!=3)fail("Invalid point");return new SelectionRegion.Point((int)number(a.get(0),-30000000,30000000),(int)number(a.get(1),-2048,2048),(int)number(a.get(2),-30000000,30000000));}
    private static long number(JsonElement e,long low,long high){if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("Expected integer");long n;try{n=e.getAsBigDecimal().longValueExact();}catch(Exception error){throw new IllegalArgumentException("Expected exact integer",error);}if(n<low||n>high)fail("Integer out of range");return n;}
    private static String string(JsonElement e){if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString())throw new IllegalArgumentException("Expected string");return e.getAsString();}
    private static void eq(JsonObject o,String key,String expected){if(!string(o.get(key)).equals(expected))fail("Identity mismatch: "+key);}
    private static void keys(JsonObject o,String... fields){if(o==null||!o.keySet().equals(Set.of(fields)))fail("Unknown or missing preview fields");}
    private static void falseFlag(JsonObject o,String key){var e=o.get(key);if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isBoolean()||e.getAsBoolean())fail("Read-only flag mismatch: "+key);}
    private static void digest(String hash){if(hash==null||!hash.matches("[a-f0-9]{64}"))fail("Expected SHA256");}
    private static void revision(long n){if(n<0||n>9007199254740991L)fail("Invalid context revision");}
    private static String sha(JsonElement e){try{return Asset.sha(Asset.canonical(e).getBytes(StandardCharsets.UTF_8));}catch(Exception error){throw new IllegalArgumentException("Cannot check preview digest",error);}}
    private static void checkCancelled(BooleanSupplier cancelled){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new CancellationException("Preview cancelled");}
    private static void fail(String reason){throw new IllegalArgumentException(reason);}
}
