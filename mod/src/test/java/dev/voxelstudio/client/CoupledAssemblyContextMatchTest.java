package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Pure display tuple matching only. Minimal saved fields are NOT a server
 * signature, Capture, native lease, image observation or final consent. */
final class CoupledAssemblyContextMatchTest {
    private static JsonObject fixture()throws Exception{return CoupledReferenceWorldAssemblyCandidateReceiptTest.fixtures().get(0);}
    private static CoupledAssemblyBinding binding(JsonObject fixture){return CoupledReferenceWorldAssemblyCandidateReceiptTest.metadata(fixture).binding();}
    private static JsonObject saved(CoupledAssemblyBinding binding){
        var value=new JsonObject();var record=new JsonObject();var identity=new JsonObject();identity.addProperty("contextRevision",binding.contextRevision());record.add("identity",identity);
        record.addProperty("snapshotHash",binding.snapshotHash());record.addProperty("selectionHash",binding.selectionHash());record.addProperty("recordHash",binding.contextRecordHash());value.add("record",record);return value;
    }
    @Test void originalCompleteBindingMatchesOnlyItsRetainedDisplayTuple()throws Exception{
        var b=binding(fixture());var saved=saved(b);assertTrue(CoupledAssemblyContextMatch.matches(b.selection(),b.captureId(),saved,b));
        assertFalse(CoupledAssemblyContextMatch.matches(b.selection(),UUID.randomUUID().toString(),saved,b));
        var changed=b.selection().json();changed.getAsJsonObject("world").addProperty("dimension","minecraft:the_nether");
        assertFalse(CoupledAssemblyContextMatch.matches(WorldPatchJobReceipt.selection(changed),b.captureId(),saved,b));
        assertFalse(b.canAuthorizePlacement());assertFalse(b.canAuthorizeModelSend());assertFalse(b.movable());
    }
    @Test void missingOrChangedSnapshotRecordAndContextEpochNeverRebindTheDisplay()throws Exception{
        var b=binding(fixture());
        for(var key:List.of("snapshotHash","selectionHash","recordHash","identity")){
            var changed=saved(b);changed.getAsJsonObject("record").remove(key);assertFalse(CoupledAssemblyContextMatch.matches(b.selection(),b.captureId(),changed,b),key);
        }
        var changed=saved(b);changed.getAsJsonObject("record").getAsJsonObject("identity").addProperty("contextRevision",b.contextRevision()+1);
        assertFalse(CoupledAssemblyContextMatch.matches(b.selection(),b.captureId(),changed,b));
        assertFalse(CoupledAssemblyContextMatch.matches(null,b.captureId(),saved(b),b));assertFalse(CoupledAssemblyContextMatch.matches(b.selection(),b.captureId(),null,b));
    }
    @Test void referenceDisplayRequiresTheIndependentOriginalCoupledReceipt()throws Exception{
        var fixture=fixture();var b=binding(fixture);var reference=CoupledReferenceWorldAssemblyCandidateReceiptTest.reference(fixture);
        assertTrue(CoupledAssemblyContextMatch.reference(b.selection(),b.captureId(),saved(b),reference));
        var legacy=reference.deepCopy();legacy.addProperty("format","OriginalReferenceWorldAssemblyReference");assertFalse(CoupledAssemblyContextMatch.reference(b.selection(),b.captureId(),saved(b),legacy));
        var changed=reference.deepCopy();changed.getAsJsonObject("prepared").addProperty("legacyFullConsentTransferable",true);assertFalse(CoupledAssemblyContextMatch.reference(b.selection(),b.captureId(),saved(b),changed));
        assertFalse(CoupledAssemblyContextMatch.reference(b.selection(),UUID.randomUUID().toString(),saved(b),reference));
    }
}
