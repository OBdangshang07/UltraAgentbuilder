package dev.voxelstudio.client;
import com.google.gson.JsonObject;
/** The original reference comes from the checked capture/freeze/runtime,
 * never from status or a downloaded candidate. */
record WorldPatchSubmission(JsonObject reference,JsonObject status) {
    WorldPatchSubmission {reference=WorldPatchJobReceipt.verifyReference(reference.deepCopy());status=WorldPatchJobReceipt.verify(reference,status.deepCopy());}
    @Override public JsonObject reference(){return reference.deepCopy();}
    @Override public JsonObject status(){return status.deepCopy();}
}
