package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** Cross-language statuses come from the production Node runner with injected
 * free adapters. They are NOT evidence of a real model reading a game world. */
class ContextAnalysisReceiptTest {
    static JsonArray cases()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/context-analysis.json"))).getAsJsonObject().getAsJsonArray("analysisCases");}
    @Test void verifiesActualNodeCompletedRejectedFailedUnknownAndRunning()throws Exception{
        var states=new HashSet<String>();for(var item:cases()){var value=item.getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var status=value.getAsJsonObject("status");
            assertSame(status,ContextAnalysisReceipt.verify(reference,status));states.add(status.get("state").getAsString());
            var details=ContextAnalysisReceipt.details(reference,status);assertTrue(details.contains("所有 AI 结论未经事实验证"));assertTrue(details.contains("不产生补丁、建造或世界权限"));
            if(status.get("state").getAsString().equals("completed"))assertTrue(details.contains("中文 🏢 与 <文本>"));
            if(status.get("state").getAsString().equals("unknown"))assertTrue(status.get("canObserveOriginal").getAsBoolean());}
        assertEquals(Set.of("completed","completed-rejected","failed","unknown","running"),states);
    }
    @Test void rejectsIdentityRecipientProtocolOrBudgetRebind()throws Exception{var value=cases().get(0).getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var original=value.getAsJsonObject("status");
        for(var field:new String[]{"id","requestHash","snapshotHash","summaryHash","contextId","protocolHash"}){var changed=original.deepCopy();changed.addProperty(field,"a".repeat(64));assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
        for(var field:new String[]{"requestVersion","maximumCalls","automaticRetries","callsReserved"}){var changed=original.deepCopy();changed.addProperty(field,26);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
        for(var field:new String[]{"agent","model","effort"}){var changed=original.deepCopy();changed.getAsJsonObject("recipient").addProperty(field,"changed");assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
    }
    @Test void rejectsVerifiedOrExecutableFieldsAndZeroCostUnknown()throws Exception{for(var item:cases()){var value=item.getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var original=value.getAsJsonObject("status");
        for(var field:new String[]{"analysisClaimsVerified","canAuthorizePlacement"}){var changed=original.deepCopy();changed.addProperty(field,true);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
        var changed=original.deepCopy();changed.addProperty("command","/fill");assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));
        var zero=original.deepCopy();zero.addProperty("modelSent",false);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,zero));}
    }
    @Test void rejectsIncompleteProseOriginalObservationRejectionAndUnboundedDiagnostics()throws Exception{for(var item:cases()){var value=item.getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var status=value.getAsJsonObject("status");
        if(!status.get("state").getAsString().equals("unknown")){var changed=status.deepCopy();changed.addProperty("canObserveOriginal",true);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
        if(!status.get("state").getAsString().equals("completed")){var changed=status.deepCopy();changed.add("analysis",cases().get(0).getAsJsonObject().getAsJsonObject("status").get("analysis"));assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
        var changed=status.deepCopy();changed.addProperty("rejection","arbitrary-private-error");assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));
        var bad=status.deepCopy();var detail=new JsonObject();detail.addProperty("category","private-session-dump");bad.add("localStop",detail);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,bad));}
    }
    @Test void boundedTextAndHashesDoNotBecomeActionsOrVerifiedFacts()throws Exception{var value=cases().get(0).getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));var original=value.getAsJsonObject("status");
        for(Consumer<JsonObject> mutate:List.<Consumer<JsonObject>>of(a->a.addProperty("worldPatch","not-prose"),a->a.addProperty("snapshotHash","a".repeat(64)),
            a->a.getAsJsonArray("observations").add("\u00a0\u3000"),a->a.getAsJsonArray("unknowns").add("x".repeat(2001)),a->a.getAsJsonArray("recommendations").add("text\0data"),
            a->a.getAsJsonArray("observations").add(new JsonObject()),a->{for(int i=0;i<33;i++)a.getAsJsonArray("inferences").add("text");})){
            var changed=original.deepCopy();mutate.accept(changed.getAsJsonObject("analysis"));assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verify(reference,changed));}
        var changed=original.deepCopy();changed.getAsJsonObject("analysis").getAsJsonArray("recommendations").add("不执行：/fill，只是文本。任何内容都不授予世界权限。");
        assertSame(changed,ContextAnalysisReceipt.verify(reference,changed));assertTrue(ContextAnalysisReceipt.details(reference,changed).contains("不执行：/fill"));
    }
    @Test void noLegacyReferenceOrAuthorityUpgrade()throws Exception{var value=cases().get(0).getAsJsonObject();var reference=ContextAnalysisReceipt.reference(value.getAsJsonObject("prepared"));
        for(var field:new String[]{"version","requestVersion"}){var changed=reference.deepCopy();changed.addProperty(field,0);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verifyReference(changed));}
        var changed=reference.deepCopy();changed.addProperty("canAuthorizePlacement",true);assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.verifyReference(changed));
        var legacy=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/context-task.json"))).getAsJsonObject().getAsJsonArray("cases").get(0).getAsJsonObject().getAsJsonObject("prepared");
        assertThrows(RuntimeException.class,()->ContextAnalysisReceipt.reference(legacy));
    }
}
