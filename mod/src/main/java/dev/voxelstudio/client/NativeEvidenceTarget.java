package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.NativeEvidenceRequest;
import java.util.Set;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Transport identity only, never a job reservation or placement capability.
 * Full-task pins come from the original SEND receipt, not a downloaded request. */
record NativeEvidenceTarget(Namespace namespace,String jobId,String evidenceId,String originalRequestHash) {
    enum Namespace { LEGACY, FULL_ASSEMBLY }
    NativeEvidenceTarget {
        if(namespace==null||jobId==null||!jobId.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
            ||evidenceId==null||!evidenceId.matches("[a-f0-9]{64}")
            ||namespace==Namespace.FULL_ASSEMBLY&&(originalRequestHash==null||!originalRequestHash.matches("[a-f0-9]{64}"))
            ||namespace==Namespace.LEGACY&&originalRequestHash!=null)throw new IllegalArgumentException("Invalid original native transport identity");
    }
    static NativeEvidenceTarget legacy(String job,String evidence){return new NativeEvidenceTarget(Namespace.LEGACY,job,evidence,null);}
    int statusBytes(){return namespace==Namespace.FULL_ASSEMBLY?16384:4*1024*1024;}
    String jobRoute(){return (namespace==Namespace.LEGACY?"/v1/jobs/":"/v1/reference-world-assembly/jobs/")+jobId;}
    String memberRoute(String member){
        if(!Set.of("request","manifest","cells","upload").contains(member))throw new IllegalArgumentException("Invalid native member");
        return jobRoute()+"/native-evidence/"+evidenceId+"/"+member;
    }
    static NativeEvidenceTarget assembly(String originalJob,String originalRequest,JsonObject status){
        verifyAssemblyStatus(originalJob,originalRequest,status);
        if(!text(status,"format").equals("ReferenceWorldAssemblyRunnerStatus")||!text(status,"state").equals("running"))return null;
        var e=status.get("nativeEvidence");if(e==null||e.isJsonNull())return null;
        var evidence=e.getAsJsonObject();String state=text(evidence,"state");
        if(state.equals("complete")){keys(evidence,"id","state","evidenceHash");digest(evidence,"id");digest(evidence,"evidenceHash");return null;}
        keys(evidence,"id","state");if(!state.equals("waiting"))throw new IllegalStateException("Unsupported original native evidence state");
        digest(evidence,"id");return new NativeEvidenceTarget(Namespace.FULL_ASSEMBLY,originalJob,text(evidence,"id"),originalRequest);
    }
    private static void verifyAssemblyStatus(String job,String request,JsonObject s){
        if(job==null||request==null||!request.matches("[a-f0-9]{64}")||!job.equals(text(s,"id"))||!request.equals(text(s,"requestHash"))
            ||number(s,"version")!=2||!text(s,"purpose").equals("reference-world-assembly"))throw new IllegalStateException("Original full native task changed");
        no(s,"canAuthorizePlacement","allowsNewModelCall","serverBaselineVerified","providerReceiptsIndependentlyAudited");
        if(number(s,"automaticRetries")!=0||number(s,"worldWrites")!=0)throw new IllegalStateException("Native observation cannot create authority");
        if(text(s,"format").equals("ReferenceWorldAssemblyRetainedJob")){
            if(!flag(s,"originalHistoryOnly")||!flag(s,"reservationInspectionOnly"))throw new IllegalStateException("Not original read-only history");
            no(s,"originalLiveExecutionOnly","canResume");return;
        }
        keys(s,"format","version","purpose","id","state","stageEventsObserved","reservedCalls","maximumCalls","tier","preparationHash","requestHash",
            "candidate","nativeEvidence","originalLiveExecutionOnly","automaticRetries","providerReceiptsIndependentlyAudited","serverBaselineVerified","allowsNewModelCall","canAuthorizePlacement","worldWrites");
        if(!text(s,"format").equals("ReferenceWorldAssemblyRunnerStatus")||!flag(s,"originalLiveExecutionOnly")
            ||!Set.of("running","preview-ready","cancelled-needs-original-inspection","failed-needs-original-inspection","start-rejected").contains(text(s,"state")))throw new IllegalStateException("Not an original full runner status");
        digest(s,"preparationHash");number(s,"stageEventsObserved");
        int maximum=switch(text(s,"tier")){case "lite"->8;case "pro"->14;case "max"->20;case "ultra"->26;default->throw new IllegalStateException("Invalid full native tier");};
        var reserved=s.get("reservedCalls");
        // The accepted runner may be observed before its first stage reports
        // a count. This is a valid idle observation, not a render permission.
        boolean unreported=reserved.isJsonNull();
        if(number(s,"maximumCalls")!=maximum||!unreported&&number(s,"reservedCalls")>maximum
            ||unreported&&(!s.get("nativeEvidence").isJsonNull()||!s.get("candidate").isJsonNull()))throw new IllegalStateException("Full native call budget changed");
    }
    boolean stillWaiting(JsonObject status){
        if(namespace==Namespace.FULL_ASSEMBLY)return equals(assembly(jobId,originalRequestHash,status));
        if(status.has("format")&&text(status,"format").startsWith("ReferenceWorldAssembly"))throw new IllegalStateException("Full task cannot use legacy native transport");
        if(!jobId.equals(text(status,"id")))throw new IllegalStateException("Original render job changed");
        if(Set.of("failed","cancelled","interrupted","preview-ready").contains(text(status,"state")))return false;
        var value=status.get("nativeEvidence");if(value==null||value.isJsonNull())return false;
        var e=value.getAsJsonObject();return text(e,"state").equals("waiting")&&text(e,"id").equals(evidenceId);
    }
    NativeEvidenceRequest parseRequest(JsonObject value)throws Exception{
        keys(value,"format","version","renderer","sourceHash","assetHash","cellsHash","dimensions","views","canAuthorizePlacement","requestHash");
        keys(value.getAsJsonObject("dimensions"),"width","height","length");
        for(var view:value.getAsJsonArray("views"))keys(view.getAsJsonObject(),"id","purpose","yaw","pitch","min","max","width","height");
        no(value,"canAuthorizePlacement");var request=NativeEvidenceRequest.parse(value);
        if(!request.hash().equals(evidenceId))throw new IllegalStateException("Original native request changed");return request;
    }
    void requireRequest(NativeEvidenceRequest request){if(request==null||!request.hash().equals(evidenceId))throw new IllegalArgumentException("Wrong original native request");}
    JsonObject verifyUploadReceipt(JsonObject receipt){
        if(namespace==Namespace.FULL_ASSEMBLY){keys(receipt,"accepted","requestHash","evidenceHash","worldCaptured","canAuthorizePlacement");no(receipt,"worldCaptured","canAuthorizePlacement");}
        else keys(receipt,"accepted","requestHash","evidenceHash");
        digest(receipt,"evidenceHash");
        if(!flag(receipt,"accepted")||!text(receipt,"requestHash").equals(evidenceId))throw new IllegalStateException("Native upload receipt changed");return receipt;
    }
}
