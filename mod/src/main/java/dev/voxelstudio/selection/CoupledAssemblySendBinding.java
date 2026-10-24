package dev.voxelstudio.selection;

import java.util.*;

/** Independent original v1 SEND pins. This is not a legacy patch binding,
 * a server baseline certificate, a final ticket or a world-write capability. */
public record CoupledAssemblySendBinding(String contextId,String jobId,String snapshotHash,String selectionHash,long contextRevision,
        String preparationHash,String contextRecordHash,String requestHash,String runtimeHash,String worldContextHash,
        String referenceSetHash,String referenceBindingHash,String generationProtocolHash,String couplingPolicyHash) {
    public CoupledAssemblySendBinding {
        if(contextId==null||!contextId.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")||jobId==null||!jobId.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")||contextRevision<0||contextRevision>9007199254740991L)
            throw new IllegalArgumentException("Exact original coupled capture required");
        for(var value:Arrays.asList(snapshotHash,selectionHash,preparationHash,contextRecordHash,requestHash,runtimeHash,worldContextHash,
                referenceSetHash,referenceBindingHash,generationProtocolHash,couplingPolicyHash))
            if(value==null||!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Exact original coupled SEND hashes required");
        if(!policyHash().equals(couplingPolicyHash))throw new IllegalArgumentException("Original fixed coupled policy required");
    }
    public static String policyHash(){return AssemblyCoupledPolicy.HASH;}
    boolean matches(CoupledAssemblyBinding candidate){
        return candidate!=null&&contextId.equals(candidate.captureId())&&jobId.equals(candidate.jobId())&&snapshotHash.equals(candidate.snapshotHash())
            &&selectionHash.equals(candidate.selectionHash())&&contextRevision==candidate.contextRevision()
            &&preparationHash.equals(candidate.preparationHash())&&contextRecordHash.equals(candidate.contextRecordHash())
            &&requestHash.equals(candidate.requestHash())&&runtimeHash.equals(candidate.runtimeHash())
            &&worldContextHash.equals(candidate.worldContextHash())&&referenceSetHash.equals(candidate.referenceSetHash())
            &&referenceBindingHash.equals(candidate.referenceBindingHash())&&couplingPolicyHash.equals(candidate.couplingPolicyHash());
    }
    public boolean canAuthorizePlacement(){return false;}
}
