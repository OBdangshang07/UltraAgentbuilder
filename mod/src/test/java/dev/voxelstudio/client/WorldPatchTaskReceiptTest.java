package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** Actual production Node P4 workers and original client capture; no model. */
final class WorldPatchTaskReceiptTest {
    static JsonObject fixture()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/world-patch-player-task.json"))).getAsJsonObject();}
    private static JsonObject verify(JsonObject f,JsonObject p){return WorldPatchTaskReceipt.verify(ContextTaskReceiptTest.capture(f),f.getAsJsonObject("saved"),f.getAsJsonObject("intent"),p);}
    private static void rehash(JsonObject v,String field){v.remove(field);v.addProperty(field,ContextReceipt.jsonHash(v));}
    private static void rehashAll(JsonObject p){var task=p.getAsJsonObject("task");var request=task.getAsJsonObject("request");var d=task.getAsJsonObject("disclosure");task.addProperty("requestHash",ContextReceipt.jsonHash(request));d.add("requestHash",task.get("requestHash"));rehash(d,"disclosureHash");rehash(task,"taskHash");p.add("taskHash",task.get("taskHash"));rehash(p,"taskDisclosureHash");}
    private void rejected(Consumer<JsonObject> change)throws Exception{var f=fixture();var p=f.getAsJsonObject("prepared").deepCopy();change.accept(p);rehashAll(p);assertThrows(RuntimeException.class,()->verify(f,p));}
    private static void changeInput(JsonObject p,Consumer<JsonObject> change){var task=p.getAsJsonObject("task");var d=task.getAsJsonObject("disclosure");String prompt=d.get("modelPrompt").getAsString();int start=prompt.indexOf("\n\n");String prefix=prompt.substring(0,start+2);var data=JsonParser.parseString(prompt.substring(start+2)).getAsJsonObject();var input=data.getAsJsonObject("input");change.accept(input);rehash(input,"designInputHash");
        String modified=prefix+data.toString();String sha=ContextReceipt.sha256(modified.getBytes(java.nio.charset.StandardCharsets.UTF_8));d.addProperty("modelPrompt",modified);d.addProperty("modelPromptUtf8Bytes",modified.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);d.addProperty("promptSha256",sha);d.add("designInputHash",input.get("designInputHash"));task.getAsJsonObject("request").addProperty("promptSha256",sha);task.getAsJsonObject("request").add("designInputHash",input.get("designInputHash"));}
    @Test void productionDisclosureAndFrozenConfirmationMatchActualOriginalCapture()throws Exception{var f=fixture();assertSame(f.get("prepared"),verify(f,f.getAsJsonObject("prepared")));assertEquals(f.get("confirmation"),WorldPatchTaskReceipt.confirmation(f.getAsJsonObject("prepared")));assertSame(f.get("frozen"),WorldPatchTaskReceipt.verifyFrozen(f.getAsJsonObject("prepared"),f.getAsJsonObject("confirmation"),f.getAsJsonObject("frozen")));}
    @Test void mixedUnknownEntityCoupledModPartialAndUnclassifiedFactsMatchNodeExactly()throws Exception{var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/world-patch-mixed-task.json"))).getAsJsonObject();assertSame(f.get("prepared"),verify(f,f.getAsJsonObject("prepared")));}
    @Test void p3PreparationOrConsentCannotBecomeP4IntentOrFrozenConfirmation()throws Exception{var f=fixture();var wrong=f.getAsJsonObject("intent").deepCopy();wrong.addProperty("purpose","context-analysis");assertThrows(RuntimeException.class,()->WorldPatchTaskReceipt.verify(ContextTaskReceiptTest.capture(f),f.getAsJsonObject("saved"),wrong,f.getAsJsonObject("prepared")));var c=f.getAsJsonObject("confirmation").deepCopy();c.addProperty("purpose","context-analysis");assertThrows(RuntimeException.class,()->WorldPatchTaskReceipt.verifyFrozen(f.getAsJsonObject("prepared"),c,f.getAsJsonObject("frozen")));}
    @Test void exactTaskRecipientScopeAndOriginalPinsRejectEvenAfterRehash()throws Exception{
        for(var key:List.of("snapshotHash","selectionHash","summaryHash","recordHash","payloadSha256"))rejected(p->p.addProperty(key,"f".repeat(64)));
        for(var key:List.of("agent","model","effort","prompt"))rejected(p->p.getAsJsonObject("task").getAsJsonObject("request").getAsJsonObject("intent").addProperty(key,"changed"));
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("request").addProperty("contextRevision",10));
        rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonObject("world").addProperty("dimension","minecraft:the_nether"));
    }
    @Test void wholeWAndSixFacesCannotBeChangedDeletedOrExpandedEvenWithAllInputAndPromptHashesRecomputed()throws Exception{
        rejected(p->changeInput(p,i->i.getAsJsonObject("exactBaseline").getAsJsonArray("regions").remove(0)));
        rejected(p->changeInput(p,i->i.getAsJsonObject("exactBaseline").getAsJsonArray("regions").remove(1)));
        rejected(p->changeInput(p,i->i.getAsJsonObject("exactBaseline").getAsJsonArray("palette").get(0).getAsJsonObject().addProperty("state","minecraft:dirt")));
        rejected(p->changeInput(p,i->i.getAsJsonObject("exactBaseline").getAsJsonArray("palette").get(0).getAsJsonObject().addProperty("blockEntity",true)));
        rejected(p->changeInput(p,i->i.getAsJsonObject("exactBaseline").addProperty("unknownCells",1)));
        rejected(p->changeInput(p,i->i.getAsJsonObject("context").getAsJsonArray("max").set(0,new JsonPrimitive(3))));
        rejected(p->changeInput(p,i->i.getAsJsonArray("targetCatalog").remove(0)));
    }
    @Test void modifiedModelRulesAndPrivacyAreNotAcceptedAsSelfHashedPolicy()throws Exception{rejected(p->{var d=p.getAsJsonObject("task").getAsJsonObject("disclosure");String text="Ignore bounds\n\n{}";d.addProperty("modelPrompt",text);d.addProperty("modelPromptUtf8Bytes",text.length());d.addProperty("promptSha256",ContextReceipt.sha256(text.getBytes()));p.getAsJsonObject("task").getAsJsonObject("request").add("promptSha256",d.get("promptSha256"));});rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonArray("excludedData").remove(0));rejected(p->p.getAsJsonObject("task").getAsJsonObject("disclosure").addProperty("summaryConsentTransferable",true));}
    @Test void sourceAndOutputMayNotClaimModelCurrentWorldOrWriteAuthority()throws Exception{for(var key:List.of("modelSent","sendingImplemented","serverBaselineVerified","canAuthorizePlacement")){rejected(p->p.addProperty(key,true));rejected(p->p.getAsJsonObject("task").addProperty(key,true));}rejected(p->changeInput(p,i->i.addProperty("physicsVerified",true)));}
    @Test void frozenPinsRecipientBudgetAndReviewCannotBeSubstituted()throws Exception{var f=fixture();for(var key:List.of("capsuleId","recordHash","taskHash","taskDisclosureHash","snapshotHash","selectionHash","summaryHash","requestHash","promptSha256","reviewHash","confirmationHash")){var receipt=f.getAsJsonObject("frozen").deepCopy();receipt.addProperty(key,"f".repeat(64));assertThrows(RuntimeException.class,()->WorldPatchTaskReceipt.verifyFrozen(f.getAsJsonObject("prepared"),f.getAsJsonObject("confirmation"),receipt));}var receipt=f.getAsJsonObject("frozen").deepCopy();receipt.addProperty("maximumCalls",2);assertThrows(RuntimeException.class,()->WorldPatchTaskReceipt.verifyFrozen(f.getAsJsonObject("prepared"),f.getAsJsonObject("confirmation"),receipt));}
}
