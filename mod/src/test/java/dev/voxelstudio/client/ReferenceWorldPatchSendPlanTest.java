package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

/** Pure joint player handoff against independently generated Node receipts.
 * Not a game/UI, real model, design quality or world-write acceptance. */
final class ReferenceWorldPatchSendPlanTest {
    private static ReferenceWorldPatchSendPlan plan(JsonObject f){return new ReferenceWorldPatchSendPlan(f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"));}
    private static JsonObject state(JsonObject f,String name,long calls){var s=f.getAsJsonObject("status").deepCopy();s.addProperty("state",name);s.addProperty("callsReserved",calls);
        s.add("modelSent",calls==0?new JsonPrimitive(false):new JsonPrimitive("possibly-or-confirmed"));s.add("responseCheck",JsonNull.INSTANCE);s.add("candidateHash",JsonNull.INSTANCE);s.addProperty("candidatePublished",false);s.addProperty("canObserveOriginal",false);return s;}
    @Test void originalHandoffRetainsExactPicturesCapabilityAndNoPlacementAuthority()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var p=plan(f);assertEquals(f.get("prepared"),p.prepared());assertEquals(f.get("frozen"),p.frozen());
        assertEquals(f.get("referenceManifest"),p.manifest());assertEquals(f.get("capability"),p.capability());assertEquals(f.getAsJsonObject("frozen").get("recipient"),p.recipient());
        assertFalse(p.frozen().get("canAuthorizePlacement").getAsBoolean());assertFalse(p.frozen().get("modelSent").getAsBoolean());
    }
    @Test void inputAndGetterMutationCannotChangeImmutableApproval()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var p=plan(f);var original=p.prepared();
        f.getAsJsonObject("prepared").addProperty("canAuthorizePlacement",true);f.getAsJsonObject("frozen").addProperty("maximumCalls",2);f.getAsJsonObject("referenceManifest").addProperty("mode","inspire");f.getAsJsonObject("capability").addProperty("supportsImages",false);
        for(var value:List.of(p.prepared(),p.frozen(),p.manifest(),p.capability(),p.recipient()))value.addProperty("changed",true);
        assertEquals(original,p.prepared());assertEquals(1,p.frozen().get("maximumCalls").getAsInt());assertTrue(p.capability().get("supportsImages").getAsBoolean());assertFalse(p.recipient().has("changed"));
    }
    @Test void differentImageOwnerSetModePixelsOrAnnotationsCannotReplaceFrozenAttachments()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();
        for(var key:List.of("ownerId","setHash","mode","references","pixels","bytes","metadataRemoved","worldCaptured")){var m=f.getAsJsonObject("referenceManifest").deepCopy();
            switch(key){case "ownerId"->m.addProperty(key,"00000000-0000-4000-8000-000000000000");case "setHash"->m.addProperty(key,"f".repeat(64));case "mode"->m.addProperty(key,m.get(key).getAsString().equals("inspire")?"reconstruct":"inspire");
                case "references"->m.getAsJsonArray(key).get(0).getAsJsonObject().getAsJsonObject("annotation").addProperty("caption","changed");
                case "metadataRemoved"->m.addProperty(key,false);case "worldCaptured"->m.addProperty(key,true);default->m.addProperty(key,1);}
            assertNotEquals(f.get("referenceManifest"),m,"Fixture must actually change: "+key);
            assertThrows(RuntimeException.class,()->new ReferenceWorldPatchSendPlan(f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),m,f.getAsJsonObject("capability")),key);
        }
    }
    @Test void selectedModelEffortRuntimeAndActualAdvertisementCannotBeReplaced()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();
        for(var key:List.of("model","effort","runtimeHash","supportsImages","advertisedEfforts")){var c=f.getAsJsonObject("capability").deepCopy();
            switch(key){case "model"->c.addProperty(key,"different-model");case "effort"->c.addProperty(key,"high");case "runtimeHash"->c.addProperty(key,"f".repeat(64));case "supportsImages"->c.addProperty(key,false);default->c.add(key,JsonParser.parseString("[\"max\"]"));}
            assertThrows(RuntimeException.class,()->new ReferenceWorldPatchSendPlan(f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),f.getAsJsonObject("referenceManifest"),c),key);
        }
    }
    @Test void laterAdvertisementMustMatchExactlyNotOnlyModelName()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var p=plan(f);assertEquals(f.getAsJsonObject("frozen").get("runtimeHash").getAsString(),p.runtimeFor(f.getAsJsonObject("capability").deepCopy()));
        for(var key:List.of("model","runtimeHash","supportsImages","advertisedEfforts")){var changed=p.capability();if(key.equals("advertisedEfforts"))changed.add(key,JsonParser.parseString("[\"max\"]"));else if(key.equals("supportsImages"))changed.addProperty(key,false);else changed.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->p.runtimeFor(changed),key);}
    }
    @Test void futureTierOrWorldWriteClaimsCannotEnterV1Handoff()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();for(var key:List.of("maximumCalls","canAuthorizePlacement","modelSent","summaryConsentTransferable","referenceConsentTransferable")){var frozen=f.getAsJsonObject("frozen").deepCopy();if(key.equals("maximumCalls"))frozen.addProperty(key,26);else frozen.addProperty(key,true);
            assertThrows(RuntimeException.class,()->new ReferenceWorldPatchSendPlan(f.getAsJsonObject("prepared"),frozen,f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability")),key);}
    }
    @Test void jointApprovalCannotBecomeLegacyOrSilentlyDetachPictures()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var legacy=f.getAsJsonObject("frozen").deepCopy();legacy.addProperty("format","FrozenWorldPatchTaskReceipt");
        assertThrows(RuntimeException.class,()->new ReferenceWorldPatchSendPlan(f.getAsJsonObject("prepared"),legacy,f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability")));
        assertThrows(RuntimeException.class,()->new ReferenceWorldPatchSendPlan(f.getAsJsonObject("prepared"),f.getAsJsonObject("frozen"),null,f.getAsJsonObject("capability")));
    }
    @Test void sendDisclosureNamesOriginalImagesScopeAndHonestDevelopmentBudget()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var p=plan(f);String details=p.details();
        for(var word:List.of("最多调用原模型 1 次","不是 Lite/Pro/Max/Ultra","未知","BEFORE",p.manifest().get("setHash").getAsString(),p.frozen().get("capsuleId").getAsString()))assertTrue(details.contains(word),word);
        for(var value:p.manifest().getAsJsonArray("references"))assertTrue(details.contains(value.getAsJsonObject().get("sha256").getAsString()));
    }
    @Test void unknownResultDoesNotClaimRefundAutomaticPollingOrPlacement()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var r=ReferenceWorldPatchReferencesTest.reference(f);var s=state(f,"unknown",1);s.addProperty("canObserveOriginal",true);
        String details=ReferenceWorldPatchJobReceipt.details(r,s);assertTrue(details.contains("费用不能称零"));assertTrue(details.contains("调用预留：1 / 1"));assertTrue(details.contains("世界写入：0"));assertFalse(ReferenceWorldPatchJobReceipt.polling(s));
    }
    @Test void lifecycleMessagesRetainSourcePinsWithoutQualityCertification()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var r=ReferenceWorldPatchReferencesTest.reference(f);
        for(var name:List.of("reserved-not-dispatched","running","checking","response-retained","failed","completed-rejected")){var s=state(f,name,name.equals("reserved-not-dispatched")?0:1);var details=ReferenceWorldPatchJobReceipt.details(r,s);assertTrue(details.contains(name));assertTrue(details.contains(r.get("referenceSetHash").getAsString()));assertTrue(details.contains("本页没有放置授权"));}
        var completed=ReferenceWorldPatchJobReceipt.details(r,f.getAsJsonObject("status"));assertTrue(completed.contains("不是设计品质"));assertTrue(completed.contains(f.getAsJsonObject("status").get("candidateHash").getAsString()));
    }
    @Test void formatterRejectsReboundStatusBeforeRendering()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();var r=ReferenceWorldPatchReferencesTest.reference(f);var changed=f.getAsJsonObject("status").deepCopy();changed.addProperty("runtimeHash","f".repeat(64));
        assertThrows(RuntimeException.class,()->ReferenceWorldPatchJobReceipt.details(r,changed));
    }
    @Test void automaticReadsOnlyRunAndCheckNeverUnknownRecovery()throws Exception{
        var f=ReferenceWorldPatchReferencesTest.fixture();for(var name:List.of("running","checking","reserved-not-dispatched","response-retained","unknown","failed","completed-rejected"))assertEquals(List.of("running","checking").contains(name),ReferenceWorldPatchJobReceipt.polling(state(f,name,name.equals("reserved-not-dispatched")?0:1)));
    }
}
