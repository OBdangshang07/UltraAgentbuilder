package dev.voxelstudio.selection;

import java.util.*;
import java.util.function.BooleanSupplier;

/** Whole-set reconstruction on the bounded server worker. Reuses the PURE
 * static proposal compiler, never legacy leases, consent, apply or journals.
 * Current supported-state policy is retained, not silently broadened. */
final class AssemblyPatchCompiler {
    private static final Comparator<SelectionRegion.Point> ORDER=Comparator.comparingInt(SelectionRegion.Point::y)
            .thenComparingInt(SelectionRegion.Point::z).thenComparingInt(SelectionRegion.Point::x);
    static final class Compiled {
        private final SelectionBaseline baseline;private final AssemblyPatchInput original;
        private final List<WorldPatchCompiler.Write> writes;private final List<WorldPatchCompiler.Guard> guards;
        private Compiled(SelectionBaseline baseline,AssemblyPatchInput original,List<WorldPatchCompiler.Write> writes,List<WorldPatchCompiler.Guard> guards){
            this.baseline=baseline;this.original=original;this.writes=List.copyOf(writes);this.guards=List.copyOf(guards);
        }
        SelectionBaseline baseline(){return baseline;}AssemblyPatchInput original(){return original;}
        AssemblyPatchBinding binding(){return original.binding();}List<WorldPatchCompiler.Write> writes(){return writes;}List<WorldPatchCompiler.Guard> guards(){return guards;}
        boolean completeSetRebuilt(){return true;}boolean canAuthorizePlacement(){return false;}boolean physicsVerified(){return false;}
    }
    static Compiled compile(SelectionBaseline original,AssemblyPatchInput input,BooleanSupplier cancelled){
        Objects.requireNonNull(original);Objects.requireNonNull(input);Objects.requireNonNull(cancelled);WorldPatchJson.cancelled(cancelled);
        var binding=input.binding();
        if(!original.selection.equals(binding.selection())||original.contextRevision!=binding.contextRevision()
                ||!original.snapshotHash.equals(binding.snapshotHash())||!original.selectionHash.equals(binding.selectionHash()))throw new IllegalArgumentException("Whole assembly belongs to another original server baseline");
        var writes=new ArrayList<WorldPatchCompiler.Write>();var points=new HashSet<SelectionRegion.Point>();
        var guards=new TreeMap<SelectionRegion.Point,WorldPatchCompiler.Guard>(ORDER);SelectionRegion.Point previous=null;
        for(int index=0;index<input.parts().size();index++){
            WorldPatchJson.cancelled(cancelled);var part=input.parts().get(index);
            var proposal=WorldPatchJson.parse(part.originalProposal(),cancelled);
            var rebuilt=WorldPatchCompiler.compile(original,proposal,cancelled);
            if(!rebuilt.patchHash().equals(binding.partHashes().get(index)))throw new IllegalArgumentException("Original whole part differs from server reconstruction");
            WorldPatchCompiler.verifyDownloaded(rebuilt,WorldPatchJson.parse(part.originalPatch(),cancelled));
            WorldPatchCompiler.verifyPreview(rebuilt,part.preview(),part.preview().binding());
            int expected=Math.min(8192,binding.totalWrites()-8192*index);
            if(rebuilt.writes().size()!=expected)throw new IllegalArgumentException("Original whole part omits operations");
            for(var write:rebuilt.writes()){
                if((writes.size()&1023)==0)WorldPatchJson.cancelled(cancelled);
                if(!points.add(write.position())||previous!=null&&ORDER.compare(previous,write.position())>=0)throw new IllegalArgumentException("Whole operation set repeats or reorders original native coordinates");
                writes.add(write);previous=write.position();
            }
            for(var guard:rebuilt.guards()){
                var prior=guards.get(guard.position());
                if(prior==null)guards.put(guard.position(),guard);
                else{
                    if(!prior.before().equals(guard.before())||prior.blockEntity()!=guard.blockEntity())throw new IllegalArgumentException("Whole parts disagree on original neighbor facts");
                    var roles=new TreeSet<>(prior.roles());roles.addAll(guard.roles());guards.put(guard.position(),new WorldPatchCompiler.Guard(guard.position(),guard.before(),guard.blockEntity(),new ArrayList<>(roles)));
                }
            }
        }
        if(writes.size()!=binding.totalWrites())throw new IllegalArgumentException("Whole original operation count incomplete");
        WorldPatchJson.cancelled(cancelled);return new Compiled(original,input,writes,new ArrayList<>(guards.values()));
    }
    private AssemblyPatchCompiler(){}
}
