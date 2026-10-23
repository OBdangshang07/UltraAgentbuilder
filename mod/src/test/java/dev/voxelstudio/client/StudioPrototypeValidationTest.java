package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class StudioPrototypeValidationTest {
    private static JsonArray fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/prototype-validation-preflight.json"))).getAsJsonArray();}
    @Test void nodePoliciesMatchOrdinaryAndReferenceConsentForEveryBudgetAndComposedOption()throws Exception{
        assertEquals(10,fixtures().size());
        for(var item:fixtures()){
            var f=item.getAsJsonObject();var r=f.getAsJsonObject("request");var p=f.getAsJsonObject("policy");String before=r.toString();
            assertTrue(StudioPrototypeValidation.verify(r,p.getAsJsonObject("assembly")));
            String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("展开校验 v1"));assertTrue(text.contains("全部展开后"));assertTrue(text.contains("缺层、短配方或通路退化不通过"));
            assertTrue(text.contains("0 次新增模型调用"));assertEquals(before,r.toString());
            assertEquals(r.get("assemblyCalls"),p.get("maximumCalls"));assertEquals(f.get("referencePolicy"),ReferencePreparationReceipt.expectedPolicy(r,p));
            assertEquals(p.getAsJsonObject("assembly").getAsJsonObject("prototypes").get("validation"),f.getAsJsonObject("referencePolicy").getAsJsonObject("assembly").getAsJsonObject("prototypes").get("validation"));
        }
    }
    @Test void exactNewRequestOptInDoesNotSubmitOrChangeAnyOtherField()throws Exception{
        for(var item:fixtures()){
            var r=item.getAsJsonObject().getAsJsonObject("request").deepCopy();r.remove("assemblyPrototypeValidation");var before=r.deepCopy();
            StudioPrototypeValidation.configure(r,true);assertEquals(StudioPrototypeValidation.MODE,r.remove("assemblyPrototypeValidation").getAsString());assertEquals(before,r);
            StudioPrototypeValidation.configure(r,true);StudioPrototypeValidation.configure(r,false);assertEquals(before,r);
            for(String key:List.of("generationMode","sceneWorkflow","qualityTier","assemblyPrototypes","assemblyQuality","assemblyDesignReview","assemblyRecovery")){
                var wrong=before.deepCopy();wrong.addProperty(key,"other");assertThrows(IllegalArgumentException.class,()->StudioPrototypeValidation.configure(wrong,true));assertFalse(wrong.has("assemblyPrototypeValidation"));
            }
            for(String key:List.of("baseJobId","repairJobId","spec","scenePatch","patch","importDirectory","checkpointCalls","checkpointConfirmed","reviewImages","sample")){
                var old=before.deepCopy();old.addProperty(key,true);assertThrows(IllegalArgumentException.class,()->StudioPrototypeValidation.configure(old,true));assertFalse(old.has("assemblyPrototypeValidation"));
            }
        }
    }
    @Test void legacyVersionAndUnselectedOrMutatedValidationNeverGainConsent()throws Exception{
        for(var item:fixtures()){
            var f=item.getAsJsonObject();var r=f.getAsJsonObject("request");var p=f.getAsJsonObject("policy");
            var validation=p.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("validation");
            for(String key:validation.keySet()){
                var missing=p.deepCopy();missing.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("validation").remove(key);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,missing),key);
                var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("validation").addProperty(key,"changed");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed),key);
            }
            var extra=p.deepCopy();extra.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("validation").addProperty("skipRoutes",true);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,extra));
            var old=r.deepCopy();old.remove("assemblyPrototypeValidation");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(old,p));
            var legacy=p.deepCopy();legacy.getAsJsonObject("assembly").getAsJsonObject("prototypes").remove("validation");legacy.getAsJsonObject("assembly").getAsJsonObject("prototypes").addProperty("version",5);
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,legacy));assertFalse(StudioAssembly.confirmation(old,legacy).contains("展开校验 v1"));
            for(var invalid:List.of(new JsonPrimitive(true),new JsonPrimitive("automatic"),JsonNull.INSTANCE)){
                var changed=r.deepCopy();changed.add("assemblyPrototypeValidation",invalid);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(changed,p));
            }
            var prior=r.deepCopy();prior.addProperty("baseJobId","old-job");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(prior,p));
        }
    }
    @Test void detailsDiscloseOnlyTheExactVersionSixPolicy()throws Exception{
        var p=fixtures().get(0).getAsJsonObject().getAsJsonObject("policy");var job=new JsonObject();job.add("preflight",p.deepCopy());
        assertTrue(StudioAssembly.details(job).contains("展开校验 v1"));
        job.getAsJsonObject("preflight").getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("validation").addProperty("canAuthorizePlacement",true);
        assertFalse(StudioAssembly.details(job).contains("展开校验 v1"));
    }
}
