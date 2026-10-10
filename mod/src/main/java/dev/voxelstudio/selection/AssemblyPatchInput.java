package dev.voxelstudio.selection;

import java.util.*;

/** Defensive transport data only. Downloaded facts cannot construct Compiled,
 * enter the old single-patch placement path or replace a server Capture. */
public final class AssemblyPatchInput {
    static final long PATCH_BYTES=64L*1024*1024;
    public static final class Part {
        private final int index;private final byte[] proposal,patch,previewBytes;private final WorldPatchPreview preview;
        public Part(int index,byte[] proposal,byte[] patch,WorldPatchPreview preview){
            this(index,proposal,patch,preview,null);
        }
        /** Optional original wire preview is required by the WHOLE journal.
         * Old read-only callers cannot fabricate it from a parsed display. */
        public Part(int index,byte[] proposal,byte[] patch,WorldPatchPreview preview,byte[] originalPreview){
            Objects.requireNonNull(proposal);Objects.requireNonNull(patch);this.preview=Objects.requireNonNull(preview);
            if(index<0||index>=SelectionLimits.assemblyParts()||proposal.length<1||proposal.length>SelectionLimits.snapshotBytes()
                    ||patch.length<1||patch.length>SelectionLimits.snapshotBytes())throw new IllegalArgumentException("Bounded original whole transport part required");
            this.index=index;this.proposal=proposal.clone();this.patch=patch.clone();
            if(originalPreview!=null){
                if(originalPreview.length<1||originalPreview.length>SelectionLimits.snapshotBytes())throw new IllegalArgumentException("Bounded original whole preview required");
                previewBytes=originalPreview.clone();var checked=WorldPatchPreview.parse(previewBytes,preview.binding());
                if(!checked.sections().equals(preview.sections())||!checked.palette().equals(preview.palette())||!checked.bounds().equals(preview.bounds())||!checked.counts().equals(preview.counts()))throw new IllegalArgumentException("Original whole preview bytes differ from checked display");
            }else previewBytes=null;
        }
        public int index(){return index;}public byte[] proposal(){return proposal.clone();}public byte[] patch(){return patch.clone();}
        public WorldPatchPreview preview(){return preview;}public boolean partIsApplyScope(){return false;}
        public byte[] previewBytes(){return previewBytes==null?null:previewBytes.clone();}
        public boolean canAuthorizePlacement(){return false;}
        byte[] originalProposal(){return proposal;}byte[] originalPatch(){return patch;}byte[] originalPreview(){return previewBytes;}
    }
    private final AssemblyPatchBinding binding;private final List<Part> parts;
    public AssemblyPatchInput(AssemblyPatchBinding binding,List<Part> parts){
        this.binding=Objects.requireNonNull(binding);Objects.requireNonNull(parts);
        if(parts.size()!=binding.partHashes().size())throw new IllegalArgumentException("All original whole parts required");
        long patchBytes=4096,proposalBytes=0,previewBytes=0;
        for(int i=0;i<parts.size();i++){var part=Objects.requireNonNull(parts.get(i));
            if(part.index!=i)throw new IllegalArgumentException("Whole transport parts must preserve original order");
            patchBytes+=part.patch.length;proposalBytes+=part.proposal.length;if(part.previewBytes!=null)previewBytes+=part.previewBytes.length;
            if(patchBytes>PATCH_BYTES||proposalBytes>PATCH_BYTES||previewBytes>PATCH_BYTES)throw new IllegalArgumentException("Whole transport working quota exceeded; no partial adoption");
            var expected=part.preview.binding();
            if(!expected.selection().equals(binding.selection())||expected.contextRevision()!=binding.contextRevision()
                    ||!expected.snapshotHash().equals(binding.snapshotHash())||!expected.selectionHash().equals(binding.selectionHash())
                    ||!expected.patchHash().equals(binding.partHashes().get(i))||!expected.previewHash().equals(binding.previewHashes().get(i)))throw new IllegalArgumentException("Whole transport preview belongs to another original identity");
        }
        this.parts=List.copyOf(parts);
    }
    public AssemblyPatchBinding binding(){return binding;}public List<Part> parts(){return parts;}
    public boolean completeSetTransport(){return true;}public boolean canAuthorizePlacement(){return false;}
}
