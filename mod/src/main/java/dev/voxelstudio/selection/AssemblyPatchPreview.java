package dev.voxelstudio.selection;

import java.util.*;
import java.util.function.BooleanSupplier;

/** Complete, immovable original-coordinate difference. An independent v2
 * display type, not a legacy patch candidate, Asset, confirmation or writer. */
public final class AssemblyPatchPreview implements WorldDifferenceView {
    private record SectionKey(int x,int y,int z){}
    private final AssemblyPatchBinding binding;private final List<WorldPatchPreview.Section> sections;
    private final Map<SelectionRegion.Point,WorldPatchPreview.Row> positions;
    private final List<String> palette;
    private final Map<WorldPatchPreview.Difference,Integer> counts;private final SelectionRegion bounds;
    private AssemblyPatchPreview(AssemblyPatchInput original,BooleanSupplier cancelled){
        Objects.requireNonNull(cancelled);WorldPatchJson.cancelled(cancelled);
        binding=original.binding();var bySection=new TreeMap<SectionKey,List<WorldPatchPreview.Row>>(Comparator.comparingInt(SectionKey::y).thenComparingInt(SectionKey::z).thenComparingInt(SectionKey::x));
        var rows=new HashMap<SelectionRegion.Point,WorldPatchPreview.Row>();var totals=new EnumMap<WorldPatchPreview.Difference,Integer>(WorldPatchPreview.Difference.class);
        for(var value:WorldPatchPreview.Difference.values())totals.put(value,0);
        var states=new TreeSet<String>();int visited=0;
        int[] lo={Integer.MAX_VALUE,Integer.MAX_VALUE,Integer.MAX_VALUE},hi={Integer.MIN_VALUE,Integer.MIN_VALUE,Integer.MIN_VALUE};
        for(int index=0;index<original.parts().size();index++){
            WorldPatchJson.cancelled(cancelled);
            var preview=original.parts().get(index).preview();if(preview.totalWrites()!=Math.min(8192,binding.totalWrites()-8192*index))fail("Whole difference omits original rows");
            for(var section:preview.sections())for(var row:section.rows()){
                if((visited++&1023)==0)WorldPatchJson.cancelled(cancelled);
                var p=row.position();if(!binding.selection().edit().contains(p)||binding.selection().protectedAt(p)||rows.putIfAbsent(p,row)!=null)fail("Whole difference outside original scope or repeated across parts");
                bySection.computeIfAbsent(new SectionKey(Math.floorDiv(p.x(),16),Math.floorDiv(p.y(),16),Math.floorDiv(p.z(),16)),key->new ArrayList<>()).add(row);
                states.add(row.before());states.add(row.after());
                if(states.size()>SelectionLimits.paletteStates())fail("Whole difference palette quota exceeded");
                totals.merge(row.difference(),1,Integer::sum);for(int axis=0;axis<3;axis++){lo[axis]=Math.min(lo[axis],p.axis(axis));hi[axis]=Math.max(hi[axis],p.axis(axis)+1);}
            }
        }
        if(rows.size()!=binding.totalWrites())fail("Whole difference is incomplete");
        var combined=new ArrayList<WorldPatchPreview.Section>();for(var entry:bySection.entrySet()){
            WorldPatchJson.cancelled(cancelled);
            entry.getValue().sort(Comparator.comparingInt(row->local(row.position())));var key=entry.getKey();combined.add(new WorldPatchPreview.Section(key.x,key.y,key.z,entry.getValue()));
        }
        WorldPatchJson.cancelled(cancelled);
        sections=List.copyOf(combined);positions=Map.copyOf(rows);counts=Map.copyOf(totals);palette=List.copyOf(states);
        bounds=new SelectionRegion(new SelectionRegion.Point(lo[0],lo[1],lo[2]),new SelectionRegion.Point(hi[0],hi[1],hi[2]));
    }
    public static AssemblyPatchPreview from(AssemblyPatchInput original){return from(original,()->false);}
    public static AssemblyPatchPreview from(AssemblyPatchInput original,BooleanSupplier cancelled){return new AssemblyPatchPreview(Objects.requireNonNull(original),cancelled);}
    private static int local(SelectionRegion.Point p){return Math.floorMod(p.y(),16)*256+Math.floorMod(p.z(),16)*16+Math.floorMod(p.x(),16);}
    private static void fail(String reason){throw new IllegalArgumentException(reason);}
    public AssemblyPatchBinding binding(){return binding;}public List<WorldPatchPreview.Section> sections(){return sections;}
    public WorldSelection selection(){return binding.selection();}
    public List<String> palette(){return palette;}
    public WorldPatchPreview.Row at(SelectionRegion.Point point){return positions.get(point);}public int totalWrites(){return positions.size();}
    public Map<WorldPatchPreview.Difference,Integer> counts(){return counts;}public SelectionRegion bounds(){return bounds;}
    public boolean movable(){return false;}public boolean canAuthorizePlacement(){return false;}public boolean currentWorldVerified(){return false;}
    public WorldPatchPreview.Filter all(WorldPatchPreview.Mode mode){return new WorldPatchPreview.Filter(mode,bounds.min().y(),bounds.max().y(),EnumSet.allOf(WorldPatchPreview.Difference.class));}
    public WorldPatchPreview.Filter checked(WorldPatchPreview.Filter filter){Objects.requireNonNull(filter);var world=binding.selection().world();if(filter.minY()<world.minY()||filter.maxY()>world.maxY())fail("Whole layer filter outside original dimension");return filter;}
    public List<WorldPatchPreview.Row> visible(WorldPatchPreview.Filter filter){checked(filter);return sections.stream().flatMap(section->section.rows().stream()).filter(filter::includes).toList();}
}
