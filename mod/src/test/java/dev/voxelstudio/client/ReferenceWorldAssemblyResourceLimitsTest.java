package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class ReferenceWorldAssemblyResourceLimitsTest {
    @Test void clientTransportUsesSameWholePatchAndDownloadPolicy(){
        assertEquals(AssemblyLimits.patchBytes(),ReferenceWorldAssemblyCandidateReceipt.PATCH_BYTES);
        assertEquals(AssemblyLimits.downloadBytes(),ReferenceWorldAssemblyCandidateReceipt.DOWNLOAD_BYTES);
        assertEquals(AssemblyLimits.partEnvelopeBytes(),ReferenceWorldAssemblyCandidateReceipt.PART_BYTES);
        assertEquals(AssemblyLimits.metadataBytes()+65536,ReferenceWorldAssemblyCandidateReceipt.METADATA_BYTES);
    }
    @Test void completeFileCountIncludesAll128PartsRatherThanOld32PartCeiling(){
        // Pins contain records + patch-set and patch + preview for each part;
        // final candidate metadata is transported separately, not in its pins.
        assertEquals(128,SelectionLimits.assemblyParts());assertEquals(258,ReferenceWorldAssemblyCandidateReceipt.candidateFileLimit());
        assertEquals(2+2*SelectionLimits.assemblyParts(),ReferenceWorldAssemblyCandidateReceipt.candidateFileLimit());
        assertTrue(2+2*34<=ReferenceWorldAssemblyCandidateReceipt.candidateFileLimit());
        assertEquals(16*1024*1024,AssemblyLimits.partBytes());
    }
}
