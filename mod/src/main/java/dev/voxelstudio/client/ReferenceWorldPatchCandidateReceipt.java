package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.WorldPatchPreview;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Joint download protocol, not a renamed legacy text download. The expected
 * pins must be retained independently from the checked joint SEND/status.
 * Download bytes cannot nominate their own source, images or world baseline. */
final class ReferenceWorldPatchCandidateReceipt {
    static final int MAX_BYTES=WorldPatchCandidateReceipt.MAX_BYTES;
    static final int MAX_CANDIDATE_BYTES=WorldPatchCandidateReceipt.MAX_CANDIDATE_BYTES;
    record Reference(String capsuleId,String manifestHash,String submissionHash,String runtimeHash,String responseHash,String candidateHash,
                     String referenceSetHash,String imageCapabilityHash,WorldPatchPreview.Binding binding) {
        Reference {
            Objects.requireNonNull(binding);
            for(var value:List.of(capsuleId,manifestHash,submissionHash,runtimeHash,responseHash,candidateHash,referenceSetHash,imageCapabilityHash))
                if(!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("联合候选独立 hash 无效");
        }
    }
    record Download(Reference reference,String downloadHash,WorldPatchPreview preview) {
        boolean canAuthorizePlacement(){return false;}
        boolean currentWorldVerified(){return false;}
    }
    static final class AuditableDownload implements WorldPatchCheckedCandidate {
        private final Download display;private final byte[] response;
        private AuditableDownload(Download display,byte[] response){this.display=display;this.response=response.clone();}
        Download display(){return display;}Reference reference(){return display.reference();}
        public WorldPatchPreview preview(){return display.preview();}
        public byte[] originalResponse(){return response.clone();}
        public String originalResponseHash(){return display.reference().responseHash();}
        public boolean canAuthorizePlacement(){return false;}
    }
    static Download parse(byte[] bytes,Reference expected,BooleanSupplier cancelled){
        var value=checked(bytes,expected,cancelled,false);return display(value,expected,cancelled);
    }
    static AuditableDownload parseCandidate(byte[] bytes,Reference expected,BooleanSupplier cancelled){
        var value=checked(bytes,expected,cancelled,true);var proposal=value.get("proposal");
        if(!proposal.isJsonObject()||!ContextReceipt.jsonHash(proposal).equals(expected.responseHash()))
            throw new IllegalStateException("联合下载不能替换原模型响应");
        byte[] response=proposal.toString().getBytes(StandardCharsets.UTF_8);
        if(response.length==0||response.length>WorldPatchCandidateReceipt.MAX_RESPONSE_BYTES)throw new IllegalStateException("联合原响应下载超额");
        var result=display(value,expected,cancelled);allowed(cancelled);return new AuditableDownload(result,response);
    }
    private static Download display(JsonObject value,Reference expected,BooleanSupplier cancelled){
        var preview=WorldPatchPreview.parse(value.get("preview").toString().getBytes(StandardCharsets.UTF_8),expected.binding(),cancelled);
        allowed(cancelled);return new Download(expected,text(value,"downloadHash"),preview);
    }
    private static JsonObject checked(byte[] bytes,Reference expected,BooleanSupplier cancelled,boolean proposal){
        Objects.requireNonNull(bytes);Objects.requireNonNull(expected);Objects.requireNonNull(cancelled);
        if(bytes.length==0||bytes.length>(proposal?MAX_CANDIDATE_BYTES:MAX_BYTES))throw new IllegalStateException("联合候选下载超额，不截断");
        allowed(cancelled);final String json;
        try{json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException error){throw new IllegalStateException("联合候选不是完整 UTF-8",error);}
        var value=WorldPatchCandidateReceipt.strictJson(json,cancelled).getAsJsonObject();
        var fields=new HashSet<>(Set.of("format","version","purpose","capsuleId","manifestHash","submissionHash","runtimeHash","responseHash","candidateHash",
            "referenceSetHash","imageCapabilityHash","snapshotHash","selectionHash","patchHash","previewHash","selection","contextRevision","preview",
            "archivedSourceOnly","originalResponseReverified","candidateFilesReverified","serverBaselineVerified","canAuthorizePlacement","additionalModelCalls","worldWrites","downloadHash"));
        if(proposal)fields.add("proposal");if(!value.keySet().equals(fields))throw new IllegalStateException("联合候选精确字段不一致");
        eq(value,"format",proposal?"FrozenReferenceWorldPatchCandidateDownload":"FrozenReferenceWorldPatchPreviewDownload");
        eq(value,"purpose","reference-world-patch-design");integer(value,"version",1);
        eq(value,"capsuleId",expected.capsuleId());eq(value,"manifestHash",expected.manifestHash());eq(value,"submissionHash",expected.submissionHash());
        eq(value,"runtimeHash",expected.runtimeHash());eq(value,"responseHash",expected.responseHash());eq(value,"candidateHash",expected.candidateHash());
        eq(value,"referenceSetHash",expected.referenceSetHash());eq(value,"imageCapabilityHash",expected.imageCapabilityHash());
        var binding=expected.binding();eq(value,"snapshotHash",binding.snapshotHash());eq(value,"selectionHash",binding.selectionHash());
        eq(value,"patchHash",binding.patchHash());eq(value,"previewHash",binding.previewHash());
        same(value.get("selection"),binding.selection().json());integer(value,"contextRevision",binding.contextRevision());
        for(var key:List.of("archivedSourceOnly","originalResponseReverified","candidateFilesReverified"))if(!flag(value,key))throw new IllegalStateException("联合原来源未经下载重验");
        no(value,"serverBaselineVerified","canAuthorizePlacement");integer(value,"additionalModelCalls",0);integer(value,"worldWrites",0);
        hash(value,"downloadHash");allowed(cancelled);return value;
    }
    private static void eq(JsonObject value,String key,String expected){if(!text(value,key).equals(expected))throw new IllegalStateException("联合原候选身份改变："+key);}
    private static void integer(JsonObject value,String key,long expected){if(number(value,key)!=expected)throw new IllegalStateException("联合候选数值改变："+key);}
    private static void allowed(BooleanSupplier cancelled){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("联合候选加载已取消");}
    private ReferenceWorldPatchCandidateReceipt(){}
}
