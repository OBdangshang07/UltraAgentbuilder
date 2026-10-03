package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

class ContextReceiptTest {
    private JsonObject response(SelectionReadService.Capture cap){var selection=cap.selection();var s=new JsonObject();s.add("context",selection.context().json());s.add("edit",selection.edit().json());s.add("protected",selection.json().get("protected"));
        s.addProperty("snapshotHash","b".repeat(64));s.addProperty("selectionHash",ContextReceipt.jsonHash(selection.json()));s.addProperty("totalCells",8);s.addProperty("knownCells",8);s.addProperty("unknownCells",0);s.addProperty("canAuthorizePlacement",false);s.addProperty("summaryHash",ContextReceipt.jsonHash(s));
        var r=new JsonObject();r.addProperty("format","SavedWorldContext");r.addProperty("version",1);r.addProperty("id",cap.id());byte[] raw=cap.payload().getBytes(StandardCharsets.UTF_8);r.addProperty("payloadSha256",ContextReceipt.sha256(raw));r.addProperty("payloadBytes",raw.length);
        r.addProperty("sourceAuthority","client-submitted-block-facts-not-a-server-signature");r.addProperty("privacy","block-states-only");r.addProperty("modelSent",false);r.addProperty("canAuthorizePlacement",false);
        for(var field:new String[]{"snapshotHash","selectionHash","summaryHash","totalCells","knownCells","unknownCells"})r.add(field,s.get(field));var identity=new JsonObject();identity.addProperty("worldId",selection.world().worldId());identity.addProperty("dimension",selection.world().dimension());identity.addProperty("selectionRevision",selection.revision());identity.addProperty("contextRevision",cap.contextRevision());r.add("identity",identity);
        long now=System.currentTimeMillis();r.addProperty("createdAt",now);r.addProperty("expiresAt",now+86_400_000L);var result=new JsonObject();result.add("record",r);result.add("summary",s);return result;
    }
    @Test void exactCurrentCaptureAndReceiptMatch(){var cap=ContextPublicationTest.capture();var result=response(cap);assertSame(result,ContextReceipt.verify(cap,cap.payload().getBytes(StandardCharsets.UTF_8),result));}
    private void rejected(Consumer<JsonObject> mutation){var cap=ContextPublicationTest.capture();var result=response(cap);mutation.accept(result);assertThrows(IllegalStateException.class,()->ContextReceipt.verify(cap,cap.payload().getBytes(StandardCharsets.UTF_8),result));}
    @Test void rejectsWorldAndRevisionChanges(){for(var field:new String[]{"worldId","dimension"})rejected(v->v.getAsJsonObject("record").getAsJsonObject("identity").addProperty(field,"changed"));for(var field:new String[]{"selectionRevision","contextRevision"})rejected(v->v.getAsJsonObject("record").getAsJsonObject("identity").addProperty(field,100));}
    @Test void rejectsPayloadHashAndIdentityChanges(){rejected(v->v.getAsJsonObject("record").addProperty("payloadSha256","c".repeat(64)));rejected(v->v.getAsJsonObject("record").addProperty("id",java.util.UUID.randomUUID().toString()));}
    @Test void rejectsSummaryTamperingEvenWithUnchangedHashField(){rejected(v->v.getAsJsonObject("summary").addProperty("knownCells",7));}
    @Test void rejectsAuthorityAndSourceClaims(){for(var field:new String[]{"modelSent","canAuthorizePlacement"})rejected(v->v.getAsJsonObject("record").addProperty(field,true));rejected(v->v.getAsJsonObject("record").addProperty("sourceAuthority","server-signed"));}
    @Test void rejectsExpiredReceiptAndFalseNumericStrings(){rejected(v->v.getAsJsonObject("record").addProperty("expiresAt",0));rejected(v->v.getAsJsonObject("record").getAsJsonObject("identity").addProperty("selectionRevision","3"));}
}
