package dev.voxelstudio;
import com.google.gson.*;import org.junit.jupiter.api.Test;import static org.junit.jupiter.api.Assertions.*;
class NavigationReviewTest {
    JsonObject manifest(String status,boolean ack){return JsonParser.parseString("{\"quality\":{\"version\":1,\"navigation\":\""+status+"\",\"requiresAcknowledgement\":"+ack+"}}").getAsJsonObject();}
    @Test void unverifiedNotRequestedAndLegacyRequireFreshAcknowledgement(){assertTrue(NavigationReview.required(manifest("unverified",true)));assertTrue(NavigationReview.required(manifest("not-requested",true)));assertTrue(NavigationReview.required(new JsonObject()));assertFalse(NavigationReview.required(manifest("verified",false)));}
    @Test void missingAcknowledgementRejectsBeforeAnyWorldOperation(){assertThrows(IllegalStateException.class,()->NavigationReview.requireAcknowledged(true,false));assertDoesNotThrow(()->NavigationReview.requireAcknowledged(true,true));assertDoesNotThrow(()->NavigationReview.requireAcknowledged(false,false));}
    @Test void inconsistentMetadataCannotEraseWarning(){assertThrows(IllegalArgumentException.class,()->NavigationReview.required(manifest("unverified",false)));assertThrows(IllegalArgumentException.class,()->NavigationReview.required(manifest("unknown",false)));}
}
