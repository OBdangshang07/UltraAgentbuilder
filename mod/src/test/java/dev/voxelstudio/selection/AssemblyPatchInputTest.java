package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class AssemblyPatchInputTest {
    @Test void originalPreviewWireIsDefensivelyRetainedAndWrongBytesAreRejected()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite"));var p=input.parts().get(0);var bytes=p.previewBytes();
        var copied=new AssemblyPatchInput.Part(0,p.proposal(),p.patch(),p.preview(),bytes);bytes[0]=0;copied.previewBytes()[0]=0;assertEquals((byte)'{',copied.previewBytes()[0]);
        var invalid=p.previewBytes();invalid[0]=0;assertThrows(RuntimeException.class,()->new AssemblyPatchInput.Part(0,p.proposal(),p.patch(),p.preview(),invalid));
        assertNull(new AssemblyPatchInput.Part(0,p.proposal(),p.patch(),p.preview()).previewBytes());assertFalse(copied.canAuthorizePlacement());
    }
    @Test void fullSetCannotAdoptOmittedRepeatedReorderedOrMixedOriginalScopeParts()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("ultra"));var parts=input.parts();
        assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput(input.binding(),parts.subList(0,parts.size()-1)));
        var duplicate=new ArrayList<>(parts);duplicate.set(1,parts.get(0));assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput(input.binding(),duplicate));
        var reordered=new ArrayList<>(parts);Collections.reverse(reordered);assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput(input.binding(),reordered));
        var other=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite"));var mixed=new ArrayList<>(parts);mixed.set(0,other.parts().get(0));assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput(input.binding(),mixed));
    }
    @Test void immutableTransportClonesBothInputAndOutputBytesAndCarriesNoSinglePatchRights()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite"));var original=input.parts().get(0);byte[] proposal=original.proposal(),patch=original.patch();
        var part=new AssemblyPatchInput.Part(0,proposal,patch,original.preview());proposal[0]=0;patch[0]=0;part.proposal()[0]=0;part.patch()[0]=0;
        assertEquals((byte)'{',part.proposal()[0]);assertEquals((byte)'{',part.patch()[0]);assertFalse(part.partIsApplyScope());assertFalse(part.canAuthorizePlacement());
        assertTrue(input.completeSetTransport());assertFalse(input.canAuthorizePlacement());assertThrows(UnsupportedOperationException.class,()->input.parts().clear());
    }
    @Test void bindingRetainsOriginalProvenanceAndSmallExactV2PatchSetWithoutMovability()throws Exception{
        var f=AssemblyPatchFixtures.header("lite");var binding=AssemblyPatchFixtures.binding(f);var c=f.getAsJsonObject("metadata").getAsJsonObject("candidate");
        assertEquals(f.getAsJsonObject("metadata").get("patchSet"),binding.patchSet());assertEquals(c.get("sourceHash").getAsString(),binding.sourceHash());assertEquals(c.get("currentNativeEvidenceHash").getAsString(),binding.currentNativeEvidenceHash());
        assertEquals(c.get("referenceBindingHash").getAsString(),binding.referenceBindingHash());assertEquals(f.getAsJsonObject("prepared").get("recordHash").getAsString(),binding.contextRecordHash());
        assertEquals(f.getAsJsonObject("status").get("requestHash").getAsString(),binding.requestHash());assertFalse(binding.movable());assertFalse(binding.canAuthorizePlacement());
        binding.json().addProperty("canAuthorizePlacement",true);binding.patchSet().addProperty("operationCount",1);assertFalse(binding.json().get("canAuthorizePlacement").getAsBoolean());assertEquals(644,binding.patchSet().get("operationCount").getAsInt());
        assertThrows(UnsupportedOperationException.class,()->binding.partHashes().clear());assertThrows(UnsupportedOperationException.class,()->binding.previewHashes().clear());
    }
}
