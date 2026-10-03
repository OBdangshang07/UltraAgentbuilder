package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class StudioProviderRecoveryTest {
    static JsonObject object(String text){return JsonParser.parseString(text).getAsJsonObject();}
    static JsonArray fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/provider-recovery-preflight.json"))).getAsJsonArray();}
    @Test void exactNodeContractsMatchClientConsentAcrossTiersAndEveryStagedBudget()throws Exception{
        var cases=fixtures();assertEquals(14,cases.size());int enabled=0;
        for(var e:cases){var c=e.getAsJsonObject();var r=c.getAsJsonObject("request");var p=c.getAsJsonObject("policy");
            boolean selected=r.has("assemblyProviderRecovery");assertEquals(selected,StudioProviderRecovery.verify(r,p.getAsJsonObject("assembly")));
            String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("推理：max"));assertTrue(text.contains("最多 "+r.get("assemblyCalls").getAsString()+" 次"));
            if(selected){enabled++;assertTrue(text.contains(StudioProviderRecovery.WARNING));assertTrue(text.contains("不换模型或推理强度"));assertTrue(text.contains("原失败和每次恢复都可能计费"));}
            else{assertTrue(text.contains("容量恢复：关闭（默认）"));assertFalse(text.contains(StudioProviderRecovery.WARNING));}
        }
        assertEquals(10,enabled);
    }
    @Test void missingModifiedOrExtendedAuthorityCannotPassConsent()throws Exception{
        var c=fixtures().get(1).getAsJsonObject();var r=c.getAsJsonObject("request");var p=c.getAsJsonObject("policy");
        for(String key:p.getAsJsonObject("assembly").getAsJsonObject("providerRecovery").keySet()){
            var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("providerRecovery").remove(key);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed),key);
        }
        for(var edit:List.of(object("{\"maximumRetries\":3}"),object("{\"waitMs\":[0,30000]}"),object("{\"unknownOutcomeRetries\":1}"),object("{\"partialOutputRetries\":1}"),object("{\"changeModel\":true}"),object("{\"refundFailedCalls\":true}"),object("{\"increaseCallLimit\":true}"),object("{\"shrinkRequiredScope\":true}"),object("{\"changeModel\":\"false\"}"),object("{\"worldAuthority\":true}"))){
            var changed=p.deepCopy();var a=changed.getAsJsonObject("assembly");edit.entrySet().forEach(v->a.getAsJsonObject("providerRecovery").add(v.getKey(),v.getValue()));assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
        }
        for(var value:List.of(new JsonPrimitive(0),new JsonPrimitive(3),new JsonPrimitive("2"),JsonNull.INSTANCE)){
            var changed=p.deepCopy();changed.getAsJsonObject("assembly").add("providerRetries",value);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
        }
        var omitted=p.deepCopy();omitted.getAsJsonObject("assembly").remove("providerRecovery");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,omitted));
        var old=r.deepCopy();old.remove("assemblyProviderRecovery");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(old,p));
    }
    @Test void selectionIsExplicitAndCannotResolveDefaultsRaiseBudgetOrMutateOnFailure()throws Exception{
        var c=fixtures().get(0).getAsJsonObject();var r=c.getAsJsonObject("request").deepCopy();var original=r.deepCopy();
        StudioProviderRecovery.configure(r,false,List.of());assertEquals(original,r);
        StudioProviderRecovery.configure(r,true,List.of("max"));assertEquals("bounded",r.get("assemblyProviderRecovery").getAsString());
        assertEquals(original.get("assemblyCalls"),r.get("assemblyCalls"));assertEquals(original.get("model"),r.get("model"));assertEquals(original.get("effort"),r.get("effort"));
        StudioProviderRecovery.configure(r,false,List.of());assertEquals(original,r);
        for(String field:List.of("agent","model","effort","assemblyRecovery","generationMode","sceneWorkflow")){
            var invalid=original.deepCopy();invalid.remove(field);var before=invalid.deepCopy();assertThrows(IllegalArgumentException.class,()->StudioProviderRecovery.configure(invalid,true,List.of("max")),field);assertEquals(before,invalid);
        }
        assertFalse(StudioProviderRecovery.canSelect("codex","model","default",List.of("default")));
        assertFalse(StudioProviderRecovery.canSelect("codex","model","max",List.of("high")));
        assertFalse(StudioProviderRecovery.canSelect("deepseek","model","max",List.of("max")));
        assertFalse(StudioProviderRecovery.canSelect("codex","model",null,List.of("max")));
        assertThrows(IllegalArgumentException.class,()->StudioProviderRecovery.configure(original.deepCopy(),true,List.of("high")));
    }
    @Test void waitingIsNotCountedAsDispatchedOrSuccessAndOriginalFailuresStayVisible(){
        var job=object("{\"state\":\"validating\",\"preflight\":{\"maximumCalls\":26,\"assembly\":{\"id\":\"ultra\",\"providerRecovery\":{}}},\"assemblyCallsReserved\":1,\"generations\":[{}],\"recovery\":{\"state\":\"provider-capacity-wait\",\"ordinal\":1,\"waitMs\":10000},\"assemblyStages\":[{\"index\":1,\"phase\":\"plan\",\"state\":\"failed\"},{\"index\":2,\"phase\":\"plan\",\"state\":\"accepted\",\"providerRetryOf\":1}]}");
        assertTrue(StudioAssembly.progress(job).contains("等待 10 秒"));assertTrue(StudioAssembly.progress(job).contains("已预留 1/26"));assertTrue(StudioAssembly.progress(job).contains("不是剩余时间倒计时"));
        String detail=StudioAssembly.details(job);assertTrue(detail.contains("原失败调用 1"));assertTrue(detail.contains("失败"));assertTrue(detail.contains("另占原总额度"));
        for(String state:List.of("preview-ready","failed","cancelled","interrupted")){job.addProperty("state",state);assertEquals("",StudioProviderRecovery.waitStatus(job));}
        job.addProperty("state","generating");job.getAsJsonObject("recovery").addProperty("state","provider-capacity-dispatched");assertEquals("",StudioProviderRecovery.waitStatus(job));
        job.getAsJsonObject("recovery").addProperty("state","provider-capacity-wait");job.getAsJsonObject("recovery").addProperty("ordinal",2);job.getAsJsonObject("recovery").addProperty("waitMs",30000);assertTrue(StudioProviderRecovery.waitStatus(job).contains("30 秒"));
    }
    @Test void realFreeReferencePreparationsBindBoundedConsentAcrossAllTiersAndStagedBudgets()throws Exception{
        var root=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-player-recovery/cases.json"))).getAsJsonObject();
        assertEquals(0,root.get("modelCalls").getAsInt());assertEquals(0,root.get("worldWrites").getAsInt());assertEquals(0,root.get("syntheticAssemblyCalls").getAsInt());assertEquals(10,root.getAsJsonArray("cases").size());
        for(var e:root.getAsJsonArray("cases")){var c=e.getAsJsonObject();var g=c.getAsJsonObject("generation");var p=c.getAsJsonObject("preparation");var ordinary=c.getAsJsonObject("ordinaryPolicy");
            var snapshot=ReferencePreparationReceiptTest.snapshot(c);assertEquals(p,ReferencePreparationReceipt.verify(snapshot,g,ordinary,p));assertEquals(c.get("submission"),ReferencePreparationReceipt.send(p));
            assertTrue(ReferencePreparationReceipt.details(p).contains(StudioProviderRecovery.WARNING));
            for(String field:List.of("assemblyProviderRecovery","effort","model","assemblyCalls")){
                var changed=g.deepCopy();changed.remove(field);assertThrows(RuntimeException.class,()->ReferencePreparationReceipt.verify(snapshot,changed,ordinary,p),field);
            }
        }
    }
}
