package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioReferenceHistoryTest {
    static JsonObject job(){return JsonParser.parseString("{\"state\":\"failed\",\"referenceGeneration\":{\"version\":1,\"preparationHash\":\""+"a".repeat(64)+"\",\"input\":{\"format\":\"JobReferenceInput\",\"version\":1,\"ownerId\":\"b8a7a41a-ec28-4eec-b027-0abff5ef7bc1\",\"bindingHash\":\""+"b".repeat(64)+"\"}}}").getAsJsonObject();}
    @Test void everyReferenceTerminalIncludingCancellationAndInterruptedShowsOriginalReadOnlyIdentity(){
        var job=job();for(String state:java.util.List.of("preview-ready","failed","cancelled","interrupted")){job.addProperty("state",state);assertTrue(StudioReferenceHistory.terminal(job));}
        job.addProperty("state","generating");assertFalse(StudioReferenceHistory.terminal(job));String text=StudioReferenceHistory.details(job);assertTrue(text.contains("a".repeat(64)));assertTrue(text.contains("b".repeat(64)));assertTrue(text.contains("只查询原身份"));assertTrue(text.contains("不声称展示原图片"));assertTrue(text.contains("共用原确认预算"));
    }
    @Test void malformedReferenceIdentityCannotOfferTextOnlyFallbackOrLoseItsReferenceMarker(){
        var job=job();job.add("referenceGeneration",JsonNull.INSTANCE);assertTrue(StudioReferenceHistory.reference(job));assertTrue(StudioReferenceHistory.details(job).contains("不提供纯文字替代修订"));
        job.remove("referenceGeneration");assertFalse(StudioReferenceHistory.reference(job));assertEquals("",StudioReferenceHistory.details(job));assertFalse(StudioReferenceHistory.terminal(job));
    }
}
