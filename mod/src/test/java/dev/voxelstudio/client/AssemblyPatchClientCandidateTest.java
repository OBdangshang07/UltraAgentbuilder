package dev.voxelstudio.client;

import dev.voxelstudio.Asset;
import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Modifier;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Original production synthetic whole fixtures. No Minecraft write, final
 * confirmation, installed render/frame measurement or real model claim. */
final class AssemblyPatchClientCandidateTest {
    private static ReferenceWorldAssemblyCandidateReceipt.Whole whole(com.google.gson.JsonObject f)throws Exception{
        var m=ReferenceWorldAssemblyCandidateReceiptTest.metadata(f);
        return ReferenceWorldAssemblyCandidateReceipt.whole(m,ReferenceWorldAssemblyCandidateReceiptTest.parts(f,m),()->false);
    }
    @Test void completeLiteAndUnshrunkUltraStayTypedWholeAndRetainExactOriginalBytes()throws Exception{
        for(var f:ReferenceWorldAssemblyCandidateReceiptTest.fixtures()){
            var whole=whole(f);var candidate=AssemblyPatchCheckedCandidate.prepare(whole,()->false);var binding=candidate.input().binding();
            assertFalse(WorldPatchCheckedCandidate.class.isInstance(candidate));assertFalse(Asset.class.isInstance(candidate));
            assertFalse(candidate.movable());assertFalse(candidate.canAuthorizePlacement());assertFalse(candidate.currentWorldVerified());
            assertEquals(whole.totalWrites(),candidate.preview().totalWrites());assertEquals(binding,candidate.preview().binding());
            assertEquals(whole.metadata().reference().get("requestHash").getAsString(),binding.requestHash());
            for(int i=0;i<whole.parts().size();i++){
                var part=whole.parts().get(i);var transport=candidate.input().parts().get(i);
                assertArrayEquals(part.originalProposal(),transport.proposal());assertArrayEquals(part.originalPatch(),transport.patch());assertArrayEquals(part.originalPreview(),transport.previewBytes());
                assertFalse(transport.partIsApplyScope());for(var section:part.preview().sections())for(var row:section.rows())assertEquals(row,candidate.preview().at(row.position()));
            }
            if(f.get("tier").getAsString().equals("ultra")){assertEquals(7,candidate.input().parts().size());assertEquals(54406,candidate.preview().totalWrites());assertEquals(224,binding.selection().edit().max().y()-binding.selection().edit().min().y());}
            for(var ctor:AssemblyPatchCheckedCandidate.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(ctor.getModifiers()));
        }
    }
    @Test void originalContextMatchRequiresCaptureScopeRevisionAndAllSavedHashes()throws Exception{
        var f=ReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(0);var binding=AssemblyPatchCheckedCandidate.prepare(whole(f),()->false).input().binding();
        var saved=f.getAsJsonObject("saved");var selection=binding.selection();
        assertTrue(AssemblyPatchContextMatch.matches(selection,binding.captureId(),saved,binding));
        assertTrue(AssemblyPatchContextMatch.reference(selection,binding.captureId(),saved,ReferenceWorldAssemblyReceiptTest.reference(f)));
        assertFalse(AssemblyPatchContextMatch.matches(selection,UUID.randomUUID().toString(),saved,binding));
        var changed=new WorldSelection(selection.world(),selection.revision()+1,selection.context(),selection.edit(),selection.protectedRegions());
        assertFalse(AssemblyPatchContextMatch.matches(changed,binding.captureId(),saved,binding));
        for(var field:List.of("snapshotHash","selectionHash","recordHash")){
            var swap=saved.deepCopy();swap.getAsJsonObject("record").addProperty(field,"f".repeat(64));
            assertFalse(AssemblyPatchContextMatch.matches(selection,binding.captureId(),swap,binding),field);
            assertFalse(AssemblyPatchContextMatch.reference(selection,binding.captureId(),swap,ReferenceWorldAssemblyReceiptTest.reference(f)),field);
        }
        var swap=saved.deepCopy();swap.getAsJsonObject("record").getAsJsonObject("identity").addProperty("contextRevision",binding.contextRevision()+1);
        assertFalse(AssemblyPatchContextMatch.matches(selection,binding.captureId(),swap,binding));
        assertFalse(AssemblyPatchContextMatch.matches(selection,binding.captureId(),null,binding));
        assertFalse(AssemblyPatchContextMatch.reference(selection,binding.captureId(),saved,new com.google.gson.JsonObject()));
    }
    @Test void displayFiltersNeverBecomePartialCandidateOrChangeOriginalAbsoluteScope()throws Exception{
        var f=ReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(1);var candidate=AssemblyPatchCheckedCandidate.prepare(whole(f),()->false);var original=candidate.input();var preview=candidate.preview();
        var filter=new WorldPatchPreview.Filter(WorldPatchPreview.Mode.AFTER,preview.bounds().min().y(),preview.bounds().min().y()+1,EnumSet.of(WorldPatchPreview.Difference.ADDED));
        assertTrue(preview.visible(filter).size()<preview.totalWrites());assertSame(original,candidate.input());assertEquals(54406,original.binding().totalWrites());assertFalse(preview.movable());assertFalse(preview.canAuthorizePlacement());
        assertThrows(UnsupportedOperationException.class,()->candidate.input().parts().clear());
        var bytes=candidate.input().parts().get(0).patch();byte before=bytes[0];bytes[0]=0;assertEquals(before,candidate.input().parts().get(0).patch()[0]);
    }
    @Test void cancelledPreparationCannotReturnAnyEligibleCandidateOrPartialDisplay()throws Exception{
        var f=ReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(1);var whole=whole(f);
        assertThrows(java.util.concurrent.CancellationException.class,()->AssemblyPatchCheckedCandidate.prepare(whole,()->true));
        var checks=new AtomicInteger();assertThrows(java.util.concurrent.CancellationException.class,()->AssemblyPatchCheckedCandidate.prepare(whole,()->checks.incrementAndGet()>12));
        assertFalse(whole.canAuthorizePlacement());assertEquals(54406,whole.totalWrites());
    }
}
