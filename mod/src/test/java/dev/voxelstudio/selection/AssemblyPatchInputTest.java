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
    @Test void largerPartIndicesStayBoundedAndCannotBecomeCompleteOrAuthorizePlacement()throws Exception{
        var original=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite")).parts().get(0);
        for(int index:new int[]{32,127}){
            var part=new AssemblyPatchInput.Part(index,original.proposal(),original.patch(),original.preview(),original.previewBytes());
            assertEquals(index,part.index());assertFalse(part.partIsApplyScope());assertFalse(part.canAuthorizePlacement());
        }
        for(int index:new int[]{-1,128})assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput.Part(index,original.proposal(),original.patch(),original.preview()));
        assertThrows(IllegalArgumentException.class,()->new AssemblyPatchInput.Part(32,new byte[SelectionLimits.snapshotBytes()+1],original.patch(),original.preview()));
        assertEquals(AssemblyLimits.patchBytes(),AssemblyPatchInput.PATCH_BYTES);
        assertEquals(64L*1024*1024,AssemblyLimits.proposalBytes());assertEquals(64L*1024*1024,AssemblyLimits.previewBytes());
    }
    @Test void metadataOnlyLargerHashListsRetainExactCountsAndNoWriteAuthority()throws Exception{
        var original=AssemblyPatchFixtures.binding(AssemblyPatchFixtures.header("lite"));
        for(int count:new int[]{33,128}){
            // Synthetic metadata ONLY, not a produced/downloaded whole asset.
            var selection=new WorldSelection(original.selection().world(),1,
                    new SelectionRegion(new SelectionRegion.Point(-64,0,-64),new SelectionRegion.Point(64,128,64)),
                    new SelectionRegion(new SelectionRegion.Point(-64,0,-64),new SelectionRegion.Point(64,64,64)),List.of());
            var json=original.json();json.add("selection",selection.json());json.addProperty("selectionHash",SelectionBaseline.hash(selection.json()));json.add("origin",selection.edit().min().json());
            var hashes=new com.google.gson.JsonArray();var previews=new com.google.gson.JsonArray();for(int i=0;i<count;i++){hashes.add(SelectionBaseline.hash(new com.google.gson.JsonPrimitive("part-"+i)));previews.add(SelectionBaseline.hash(new com.google.gson.JsonPrimitive("preview-"+i)));}
            json.add("partHashes",hashes);json.add("previewHashes",previews);json.addProperty("totalWrites",count*8192);
            var set=original.patchSet();set.remove("patchSetHash");set.add("origin",selection.edit().min().json());set.add("selectionHash",json.get("selectionHash"));set.add("partHashes",hashes.deepCopy());set.addProperty("partCount",count);set.addProperty("operationCount",count*8192);json.addProperty("patchSetHash",SelectionBaseline.hash(set));
            var binding=AssemblyPatchBinding.parse(json);assertEquals(count,binding.partHashes().size());assertEquals(count*8192,binding.totalWrites());assertFalse(binding.canAuthorizePlacement());assertFalse(binding.movable());assertEquals(binding,AssemblyPatchBinding.parse(binding.json()));
            var omitted=json.deepCopy();omitted.getAsJsonArray("partHashes").remove(count-1);assertThrows(IllegalArgumentException.class,()->AssemblyPatchBinding.parse(omitted));
            var wrong=json.deepCopy();wrong.addProperty("totalWrites",count*8192+1);assertThrows(IllegalArgumentException.class,()->AssemblyPatchBinding.parse(wrong));
            var elevated=json.deepCopy();elevated.addProperty("canAuthorizePlacement",true);assertThrows(IllegalArgumentException.class,()->AssemblyPatchBinding.parse(elevated));
        }
    }
}
