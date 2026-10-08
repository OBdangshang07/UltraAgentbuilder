package dev.voxelstudio.client;
import com.google.gson.JsonObject;
/** Joint-only defensive value; never relabel a legacy reference or status. */
record ReferenceWorldPatchSubmission(JsonObject reference,JsonObject status) {
    ReferenceWorldPatchSubmission {reference=ReferenceWorldPatchJobReceipt.verifyReference(reference.deepCopy());status=ReferenceWorldPatchJobReceipt.verify(reference,status.deepCopy());}
    @Override public JsonObject reference(){return reference.deepCopy();}
    @Override public JsonObject status(){return status.deepCopy();}
}
