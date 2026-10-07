package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class StudioCompletionReserveTest {
    static JsonArray fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/completion-reserve-preflight.json"))).getAsJsonArray();}
    @Test void allNodeBudgetsMatchExactPlayerConsentAndReferencePreludeWithoutAddingCalls()throws Exception{
        assertEquals(5,fixtures().size());
        for(var item:fixtures()){
            var f=item.getAsJsonObject();var r=f.getAsJsonObject("request");var p=f.getAsJsonObject("policy");
            String before=r.toString(),text=StudioAssembly.confirmation(r,p);
            assertTrue(StudioCompletionReserve.verify(r,p.getAsJsonObject("assembly")));
            assertTrue(text.contains("收尾预留 v1"));assertTrue(text.contains("更早停止"));assertTrue(text.contains("三次尾程调用"));assertTrue(text.contains("3 次改稿 / 再复核 / 几何纠错预算"));
            assertEquals(r.get("assemblyCalls"),p.get("maximumCalls"));assertEquals(before,r.toString());
            assertEquals(f.get("referencePolicy"),ReferencePreparationReceipt.expectedPolicy(r,p));
            var reference=f.getAsJsonObject("referencePolicy");assertEquals(p.get("maximumCalls"),reference.get("maximumCalls"));
            assertEquals(p.getAsJsonObject("assembly").get("maxPackages"),reference.getAsJsonObject("assembly").get("maxPackages"));
            assertEquals(p.getAsJsonObject("assembly").get("completionReserve"),reference.getAsJsonObject("assembly").get("completionReserve"));
        }
    }
    @Test void optInChangesOnlyOneExactFieldAndNeverSubmitsOrAltersOtherPermissions()throws Exception{
        for(var item:fixtures()){
            var r=item.getAsJsonObject().getAsJsonObject("request").deepCopy();r.remove("assemblyCompletionReserve");var original=r.deepCopy();
            StudioCompletionReserve.configure(r,true);assertEquals(StudioCompletionReserve.MODE,r.remove("assemblyCompletionReserve").getAsString());assertEquals(original,r);
            StudioCompletionReserve.configure(r,true);StudioCompletionReserve.configure(r,false);assertEquals(original,r);
            for(String key:List.of("generationMode","sceneWorkflow","qualityTier","assemblyPrototypes","assemblyQuality","assemblyDesignReview","assemblyRecovery")){
                var wrong=original.deepCopy();wrong.addProperty(key,"other");assertThrows(IllegalArgumentException.class,()->StudioCompletionReserve.configure(wrong,true));assertFalse(wrong.has("assemblyCompletionReserve"));
            }
            for(String key:List.of("baseJobId","repairJobId","spec","scenePatch","patch","importDirectory","checkpointCalls","reviewImages","sample")){
                var wrong=original.deepCopy();wrong.addProperty(key,true);assertThrows(IllegalArgumentException.class,()->StudioCompletionReserve.configure(wrong,true));assertFalse(wrong.has("assemblyCompletionReserve"));
            }
        }
    }
    @Test void unexpectedMissingChangedOrExtraPolicyFieldsCannotGainConsent()throws Exception{
        for(var item:fixtures()){
            var f=item.getAsJsonObject();var r=f.getAsJsonObject("request");var p=f.getAsJsonObject("policy");
            var policy=p.getAsJsonObject("assembly").getAsJsonObject("completionReserve");
            for(String key:policy.keySet()){
                var missing=p.deepCopy();missing.getAsJsonObject("assembly").getAsJsonObject("completionReserve").remove(key);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,missing),key);
                var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("completionReserve").addProperty(key,"changed");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed),key);
            }
            var extra=p.deepCopy();extra.getAsJsonObject("assembly").getAsJsonObject("completionReserve").addProperty("silentRetry",true);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,extra));
            var absent=p.deepCopy();absent.getAsJsonObject("assembly").remove("completionReserve");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,absent));
            var old=r.deepCopy();old.remove("assemblyCompletionReserve");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(old,p));
            assertFalse(StudioCompletionReserve.verify(old,absent.getAsJsonObject("assembly")));String oldText=StudioAssembly.confirmation(old,absent);
            assertFalse(oldText.contains("收尾预留 v1"));assertTrue(oldText.contains("2 次改稿 / 再复核预算"));
            var changed=r.deepCopy();changed.addProperty("assemblyCompletionReserve",true);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(changed,p));
            var prior=r.deepCopy();prior.addProperty("baseJobId","old-job");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(prior,p));
        }
    }
    @Test void taskDetailsDiscloseOnlyExactReservePolicy()throws Exception{
        var p=fixtures().get(0).getAsJsonObject().getAsJsonObject("policy");var job=new JsonObject();job.add("preflight",p.deepCopy());
        assertTrue(StudioAssembly.details(job).contains("收尾预留 v1"));
        job.getAsJsonObject("preflight").getAsJsonObject("assembly").getAsJsonObject("completionReserve").addProperty("canAuthorizePlacement",true);
        assertFalse(StudioAssembly.details(job).contains("收尾预留 v1"));
    }
}
