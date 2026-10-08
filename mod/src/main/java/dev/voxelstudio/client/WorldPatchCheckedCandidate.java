package dev.voxelstudio.client;

import dev.voxelstudio.selection.WorldPatchPreview;

/** Only the two independently checked, immutable downloads can reach the
 * common original-server audit/transaction path. This is display/input data,
 * never a world-write capability, a SEND receipt or a current baseline. */
sealed interface WorldPatchCheckedCandidate permits WorldPatchCandidateReceipt.AuditableDownload,ReferenceWorldPatchCandidateReceipt.AuditableDownload {
    WorldPatchPreview preview();
    byte[] originalResponse();
    String originalResponseHash();
    boolean canAuthorizePlacement();
}
