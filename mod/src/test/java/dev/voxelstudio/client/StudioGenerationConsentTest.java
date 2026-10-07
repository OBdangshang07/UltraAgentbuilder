package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class StudioGenerationConsentTest {
    @Test void exactConsentRequiresEveryCurrentSettingAndTheSameWorldIdleAndKey(){
        var original=JsonParser.parseString("{\"key\":\"same-task\",\"agent\":\"codex\",\"model\":\"model\",\"effort\":\"max\",\"prompt\":\"original\",\"generationMode\":\"scene\",\"sceneWorkflow\":\"components\",\"qualityTier\":\"ultra\",\"assemblyCalls\":26,\"assemblyDesignReview\":\"native\",\"assemblyQuality\":\"v4\",\"assemblyPrototypes\":\"staged\",\"assemblyRecovery\":\"safe\",\"assemblyProviderRecovery\":\"bounded\",\"assemblyCompletionReserve\":\"design-correction-v1\",\"worldHeight\":384,\"maxRepairs\":0}").getAsJsonObject();
        var confirmed=original.deepCopy();confirmed.addProperty("assemblyConfirmed",true);assertTrue(StudioGenerationConsent.matches(confirmed,original,"world","world",true));
        for(String field:original.keySet()){
            var changed=original.deepCopy();changed.remove(field);assertFalse(StudioGenerationConsent.matches(confirmed,changed,"world","world",true),field);
            changed=original.deepCopy();changed.addProperty(field,"changed");assertFalse(StudioGenerationConsent.matches(confirmed,changed,"world","world",true),field);
        }
        assertFalse(StudioGenerationConsent.matches(confirmed,original,"world","another",true));assertFalse(StudioGenerationConsent.matches(confirmed,original,"world","world",false));
        var extra=original.deepCopy();extra.addProperty("reviewImages",true);assertFalse(StudioGenerationConsent.matches(confirmed,extra,"world","world",true));
        assertTrue(confirmed.has("assemblyConfirmed"));assertFalse(original.has("assemblyConfirmed"));
    }
    @Test void checkpointConfirmationFlagsDoNotIgnoreBudgetOutputTokensOrRevisionScope(){
        var request=JsonParser.parseString("{\"key\":\"checkpoint\",\"checkpointCalls\":4,\"maxOutputTokens\":12000,\"baseHash\":\"original\",\"sceneScope\":{\"components\":[\"entry\"]}}").getAsJsonObject();
        var confirmed=request.deepCopy();confirmed.addProperty("checkpointConfirmed",true);assertTrue(StudioGenerationConsent.matches(confirmed,request,"world","world",true));
        var changed=request.deepCopy();changed.getAsJsonObject("sceneScope").getAsJsonArray("components").add("another");assertFalse(StudioGenerationConsent.matches(confirmed,changed,"world","world",true));
        for(String field:List.of("checkpointCalls","maxOutputTokens","baseHash")){changed=request.deepCopy();changed.addProperty(field,1);assertFalse(StudioGenerationConsent.matches(confirmed,changed,"world","world",true));}
    }
}
