package dev.voxelstudio.selection;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Pure consent ledger tests; no live server/world authorization claimed. */
final class WorldPatchConsentTest {
    private WorldPatchPreview.Binding binding()throws Exception{
        var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/world-patch-journal.json"))).getAsJsonObject();var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var selection=new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),List.of());var original=SelectionBaseline.fromSealedCapture(selection,f.getAsJsonObject("capture"));var p=f.getAsJsonObject("preview");return new WorldPatchPreview.Binding(selection,original.contextRevision,original.snapshotHash,original.selectionHash,p.get("patchHash").getAsString(),p.get("previewHash").getAsString());
    }
    private SelectionRegion region(JsonObject v){return new SelectionRegion(point(v.getAsJsonArray("min")),point(v.getAsJsonArray("max")));}
    private SelectionRegion.Point point(JsonArray v){return new SelectionRegion.Point(v.get(0).getAsInt(),v.get(1).getAsInt(),v.get(2).getAsInt());}
    @Test void matchingLiveOwnerConsumesExactlyOnceButTicketItselfGrantsNoWrites()throws Exception{
        var owner=new Object();var player=UUID.randomUUID();var b=binding();var t=WorldPatchConsent.issue(owner,player,b,1);assertFalse(t.canAuthorizePlacement());assertTrue(WorldPatchConsent.available(t,owner,player,b,2));WorldPatchConsent.consume(t,owner,player,b,2);assertFalse(WorldPatchConsent.available(t,owner,player,b,3));assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(t,owner,player,b,3));
    }
    @Test void equalButDifferentOwnerDoesNotOwnTheFinalTicket()throws Exception{
        var owner=new String("same");var replacement=new String("same");var player=UUID.randomUUID();var b=binding();var t=WorldPatchConsent.issue(owner,player,b,0);assertEquals(owner,replacement);assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(t,replacement,player,b,1));assertTrue(WorldPatchConsent.available(t,owner,player,b,1));
    }
    @Test void differentPlayerCannotConsumeOrInvalidateTheOriginalTicket()throws Exception{
        var owner=new Object();var player=UUID.randomUUID();var b=binding();var t=WorldPatchConsent.issue(owner,player,b,0);assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(t,owner,UUID.randomUUID(),b,1));assertTrue(WorldPatchConsent.available(t,owner,player,b,1));WorldPatchConsent.revoke(t,new Object());assertTrue(WorldPatchConsent.available(t,owner,player,b,1));
    }
    @Test void originalSnapshotPatchAndPreviewPinsCannotBeChanged()throws Exception{
        var owner=new Object();var player=UUID.randomUUID();var b=binding();var t=WorldPatchConsent.issue(owner,player,b,0);for(int kind=0;kind<4;kind++){var changed=new WorldPatchPreview.Binding(b.selection(),b.contextRevision()+(kind==0?1:0),kind==1?"0".repeat(64):b.snapshotHash(),b.selectionHash(),kind==2?"0".repeat(64):b.patchHash(),kind==3?"0".repeat(64):b.previewHash());assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(t,owner,player,changed,1));}assertTrue(WorldPatchConsent.available(t,owner,player,b,1));
    }
    @Test void ticketExpiresAtExactTtlAndBackwardTimeCannotReviveIt()throws Exception{
        var owner=new Object();var player=UUID.randomUUID();var b=binding();var t=WorldPatchConsent.issue(owner,player,b,100);assertFalse(WorldPatchConsent.available(t,owner,player,b,99));assertTrue(WorldPatchConsent.available(t,owner,player,b,100+WorldPatchConsent.TTL_NANOS-1));assertFalse(WorldPatchConsent.available(t,owner,player,b,100+WorldPatchConsent.TTL_NANOS));assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(t,owner,player,b,100+WorldPatchConsent.TTL_NANOS));
    }
    @Test void explicitCloseAndRelayoutRevocationCannotBeUndone()throws Exception{
        var owner=new Object();var player=UUID.randomUUID();var b=binding();var t=WorldPatchConsent.issue(owner,player,b,0);WorldPatchConsent.revoke(t,owner);WorldPatchConsent.revoke(t,owner);assertFalse(WorldPatchConsent.available(t,owner,player,b,1));assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(t,owner,player,b,1));
    }
    @Test void replacedPreparationCannotUseTheOldTicketEvenWithAllEqualPins()throws Exception{
        var old=new Object();var current=new Object();var player=UUID.randomUUID();var b=binding();var oldTicket=WorldPatchConsent.issue(old,player,b,0);var newTicket=WorldPatchConsent.issue(current,player,b,1);assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(oldTicket,current,player,b,2));WorldPatchConsent.consume(newTicket,current,player,b,2);WorldPatchConsent.revoke(oldTicket,old);assertFalse(WorldPatchConsent.available(oldTicket,old,player,b,2));
    }
    @Test void absentConsentNeverBecomesAvailableBySupplyingMatchingFields()throws Exception{
        var owner=new Object();var player=UUID.randomUUID();var b=binding();assertFalse(WorldPatchConsent.available(null,owner,player,b,1));assertThrows(IllegalStateException.class,()->WorldPatchConsent.consume(null,owner,player,b,1));assertThrows(NullPointerException.class,()->WorldPatchConsent.issue(null,player,b,0));
    }
}
