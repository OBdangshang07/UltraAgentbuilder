package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** One complete independent new download. Never an old Asset, legacy Whole,
 * fresh server baseline, native lease or world-write authorization. */
final class CoupledAssemblyCheckedCandidate {
    private final CoupledAssemblyInput input;private final CoupledAssemblyPreview preview;
    private CoupledAssemblyCheckedCandidate(CoupledReferenceWorldAssemblyCandidateReceipt.Whole whole,BooleanSupplier cancelled){
        input=Objects.requireNonNull(whole).worldInput();preview=CoupledAssemblyPreview.from(input,Objects.requireNonNull(cancelled));
        if(preview.totalWrites()!=input.binding().totalWrites())throw new IllegalStateException("原成组完整预览缺少操作");
    }
    static CoupledAssemblyCheckedCandidate prepare(CoupledReferenceWorldAssemblyCandidateReceipt.Whole whole,BooleanSupplier cancelled){return new CoupledAssemblyCheckedCandidate(whole,cancelled);}
    CoupledAssemblyInput input(){return input;}CoupledAssemblyPreview preview(){return preview;}
    boolean canAuthorizePlacement(){return false;}boolean currentWorldVerified(){return false;}
}
