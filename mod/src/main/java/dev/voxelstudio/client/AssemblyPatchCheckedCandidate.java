package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** A single complete original download, not a v1 candidate, Asset, current
 * baseline or writer. Prepared on the bounded transport lane, not a tick. */
final class AssemblyPatchCheckedCandidate {
    private final AssemblyPatchInput input;
    private final AssemblyPatchPreview preview;
    private AssemblyPatchCheckedCandidate(ReferenceWorldAssemblyCandidateReceipt.Whole whole,BooleanSupplier cancelled){
        input=Objects.requireNonNull(whole).worldInput(cancelled);
        preview=AssemblyPatchPreview.from(input,cancelled);
        if(whole.totalWrites()!=preview.totalWrites())throw new IllegalStateException("原整组差异不完整；不采用部分成果");
    }
    static AssemblyPatchCheckedCandidate prepare(ReferenceWorldAssemblyCandidateReceipt.Whole whole,BooleanSupplier cancelled){return new AssemblyPatchCheckedCandidate(whole,Objects.requireNonNull(cancelled));}
    AssemblyPatchInput input(){return input;}AssemblyPatchPreview preview(){return preview;}
    boolean movable(){return false;}boolean canAuthorizePlacement(){return false;}
    boolean currentWorldVerified(){return false;}
}
