package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;

/** Defensive COMPLETE new transport. No constructor from a report, one part,
 * old preview, disk ownership marker or matching hash can grant world writes. */
public final class CoupledAssemblyInput {
    public static final class Part {
        private final int index;private final byte[] part,previewBytes;private final WorldPatchPreview preview;
        public Part(CoupledAssemblyBinding binding,int index,byte[] partBytes,byte[] previewBytes){
            Objects.requireNonNull(binding);Objects.requireNonNull(partBytes);Objects.requireNonNull(previewBytes);
            if(index<0||index>=binding.partHashes().size()||partBytes.length<1||partBytes.length>AssemblyLimits.partBytes()||previewBytes.length<1||previewBytes.length>AssemblyLimits.partBytes())throw new IllegalArgumentException("Bounded complete coupled part required");
            this.index=index;part=partBytes.clone();this.previewBytes=previewBytes.clone();var raw=WorldPatchJson.parse(part,()->false);
            WorldPatchJson.keys(raw,"format","version","policy","planHash","snapshotHash","selectionHash","assetHash","cellsHash","index","offset","totalWrites","writes","guards","provisional","partIsApplyScope","completePlanRequired","canAuthorizePlacement","worldWrites","partHash");
            eq(raw,"format","AssemblyCoupledPart");WorldPatchJson.integer(raw.get("version"),1,1);eq(raw,"policy",AssemblyCoupledPolicy.POLICY);eq(raw,"planHash",binding.couplingPlanHash());eq(raw,"snapshotHash",binding.snapshotHash());eq(raw,"selectionHash",binding.selectionHash());eq(raw,"assetHash",binding.assetHash());eq(raw,"cellsHash",binding.cellsHash());eq(raw,"partHash",binding.partHashes().get(index));
            WorldPatchJson.integer(raw.get("index"),index,index);WorldPatchJson.integer(raw.get("offset"),(long)index*8192,(long)index*8192);WorldPatchJson.integer(raw.get("totalWrites"),binding.totalWrites(),binding.totalWrites());WorldPatchJson.integer(raw.get("worldWrites"),0,0);
            flag(raw,"provisional",true);flag(raw,"completePlanRequired",true);flag(raw,"partIsApplyScope",false);flag(raw,"canAuthorizePlacement",false);
            int count=Math.min(8192,binding.totalWrites()-index*8192);if(raw.getAsJsonArray("writes").size()!=count)throw new IllegalArgumentException("Coupled transport omitted native operations");
            var content=raw.deepCopy();content.remove("partHash");if(!SelectionBaseline.hash(content).equals(binding.partHashes().get(index)))throw new IllegalArgumentException("Coupled part content hash changed");
            preview=WorldPatchPreview.parse(this.previewBytes,binding.previewBinding(index));if(preview.totalWrites()!=count)throw new IllegalArgumentException("Coupled display count differs from whole input");
        }
        public int index(){return index;}public byte[] bytes(){return part.clone();}public byte[] previewBytes(){return previewBytes.clone();}public WorldPatchPreview preview(){return preview;}
        public boolean partIsApplyScope(){return false;}public boolean canAuthorizePlacement(){return false;}
        byte[] originalPart(){return part;}
    }
    private final CoupledAssemblyBinding binding;private final List<Part> parts;private final byte[] manifest,cells,plan;
    public CoupledAssemblyInput(CoupledAssemblyBinding binding,byte[] nativeManifest,byte[] nativeCells,byte[] originalPlan,List<Part> parts){
        this.binding=Objects.requireNonNull(binding);Objects.requireNonNull(nativeManifest);Objects.requireNonNull(nativeCells);Objects.requireNonNull(originalPlan);Objects.requireNonNull(parts);
        if(nativeManifest.length<1||nativeManifest.length>AssemblyLimits.metadataBytes()||originalPlan.length<1||originalPlan.length>AssemblyLimits.metadataBytes()||nativeCells.length<2||nativeCells.length%2!=0||nativeCells.length>SelectionLimits.editCells()*2L||parts.size()!=binding.partHashes().size())throw new IllegalArgumentException("Complete bounded original native/plan/all-parts required");
        long total=4096L+nativeManifest.length+nativeCells.length+originalPlan.length,patchBytes=4096,previewBytes=0;
        for(int i=0;i<parts.size();i++){var p=Objects.requireNonNull(parts.get(i));if(p.index!=i||!p.preview.binding().equals(binding.previewBinding(i)))throw new IllegalArgumentException("Coupled transport part belongs to another whole identity");
            total+=p.part.length+p.previewBytes.length;patchBytes+=p.part.length;previewBytes+=p.previewBytes.length;
            if(total>AssemblyLimits.candidateBytes()||patchBytes>AssemblyLimits.patchBytes()||previewBytes>AssemblyLimits.previewBytes())throw new IllegalArgumentException("Complete coupled transport aggregate quota; no partial adoption");
        }
        manifest=nativeManifest.clone();cells=nativeCells.clone();plan=originalPlan.clone();this.parts=List.copyOf(parts);
    }
    public CoupledAssemblyBinding binding(){return binding;}public List<Part> parts(){return parts;}public byte[] nativeManifest(){return manifest.clone();}public byte[] nativeCells(){return cells.clone();}public byte[] plan(){return plan.clone();}
    public boolean canAuthorizePlacement(){return false;}public boolean completeSetTransport(){return true;}
    byte[] originalManifest(){return manifest;}byte[] originalCells(){return cells;}byte[] originalPlan(){return plan;}
    private static void eq(JsonObject v,String key,String expected){if(!WorldPatchJson.text(v.get(key)).equals(expected))throw new IllegalArgumentException("Original coupled part identity changed");}
    private static void flag(JsonObject v,String key,boolean value){var f=v.get(key);if(f==null||!f.isJsonPrimitive()||!f.getAsJsonPrimitive().isBoolean()||f.getAsBoolean()!=value)throw new IllegalArgumentException("Coupled part cannot change authority/completeness flags");}
}
