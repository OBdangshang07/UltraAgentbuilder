package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.lang.reflect.Modifier;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real disk helpers and synthetic cells; no native world, model or save. */
final class CoupledAssemblyJournalTest {
    @TempDir Path temp;
    @Test void completeNewDoorClosesOnlyAsCompleteOriginalGroups()throws Exception{
        var p=CoupledAssemblyTestFixtures.plan("complete-new-door");var live=CoupledAssemblyJournal.create(temp,p);var i=live.intent();
        assertEquals(3,i.packet().writes().size());assertEquals(2,i.packet().groups().size());assertEquals("door-pair",i.packet().groups().get(1).kind());
        assertThrows(IllegalArgumentException.class,()->live.applied(i,i.packet().writes().subList(0,2),CoupledAssemblyJournal.ReceiptState.CANCELLED));
        assertFalse(Files.exists(live.directory().resolve("000001.applied.json")));
        live.applied(i,i.packet().writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);
        var r=CoupledAssemblyJournal.inspect(live.directory());assertFalse(r.needsReview(),r.issue());assertEquals(3,r.confirmed().size());assertEquals(2,r.confirmedGroups());assertFalse(r.canAuthorizePlacement());assertFalse(r.worldDurabilityVerified());
    }
    @Test void originalDoorAcross8192TransportBoundaryCannotCross512WriteIntentBoundary()throws Exception{
        var p=CoupledAssemblyTestFixtures.plan("door-crosses-8192");assertEquals(2,p.binding().partHashes().size());
        var live=CoupledAssemblyJournal.create(temp,p);int count=0,groups=0;boolean found=false,shortPacket=false;
        while(count<p.binding().totalWrites()){
            var i=live.intent();var packet=i.packet();assertEquals(count,packet.offset());assertEquals(groups,packet.groupOffset());assertTrue(packet.writes().size()<=512);
            for(var g:packet.groups())if(g.kind().equals("door-pair")){found=true;assertEquals(List.of(8191,8192),g.operationIndices());assertTrue(packet.writes().stream().anyMatch(w->w.after().contains("half=lower")));assertTrue(packet.writes().stream().anyMatch(w->w.after().contains("half=upper")));}
            if(packet.writes().size()==511)shortPacket=true;count+=packet.writes().size();groups+=packet.groups().size();live.applied(i,packet.writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE);
        }
        assertTrue(found);assertTrue(shortPacket);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);var r=CoupledAssemblyJournal.inspect(live.directory());assertFalse(r.needsReview(),r.issue());assertEquals(count,r.confirmed().size());assertEquals(groups,r.confirmedGroups());
    }
    @Test void cancellingBeforeDoorClosesSupportOnlyAndDoesNotAdoptHalfDoor()throws Exception{
        var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan("complete-new-door"));var i=live.intent();
        live.applied(i,i.packet().writes().subList(0,1),CoupledAssemblyJournal.ReceiptState.CANCELLED);live.finish(CoupledAssemblyJournal.Outcome.CANCELLED);
        var r=CoupledAssemblyJournal.inspect(live.directory());assertFalse(r.needsReview(),r.issue());assertEquals(1,r.confirmed().size());assertEquals(1,r.confirmedGroups());assertThrows(Exception.class,live::intent);
    }
    @Test void selfRehashedHalfReceiptRemainsInvalidAndCannotBecomeConfirmedPrefix()throws Exception{
        var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan("complete-new-door"));var i=live.intent();live.applied(i,i.packet().writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);
        var file=live.directory().resolve("000001.applied.json");var e=JsonParser.parseString(Files.readString(file)).getAsJsonObject();var v=e.getAsJsonObject("value");v.addProperty("confirmedWrites",2);v.addProperty("state","CANCELLED");v.getAsJsonArray("writes").remove(2);e.addProperty("sha256",SelectionBaseline.hash(v));Files.writeString(file,e.toString());
        var r=CoupledAssemblyJournal.inspect(live.directory());assertTrue(r.needsReview());assertTrue(r.confirmed().isEmpty());assertFalse(r.canAuthorizePlacement());
    }
    @Test void missingReceiptExplicitAmbiguityChangedSourceAndUnknownFilesRequireReview()throws Exception{
        for(int kind=0;kind<4;kind++){
            var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan("complete-new-door"));var i=live.intent();
            if(kind==1)live.ambiguous(i,"synthetic upper-half outcome unknown");
            if(kind==2){Files.writeString(live.directory().resolve("source.json"),"{}");assertThrows(Exception.class,()->live.applied(i,i.packet().writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE));}
            if(kind==3)Files.writeString(live.directory().resolve("unknown.partial"),"retained synthetic partial record");
            var r=CoupledAssemblyJournal.inspect(live.directory());assertTrue(r.needsReview());assertTrue(r.confirmed().isEmpty());
        }
    }
    @Test void failedExistingPublicationIsNotReplacedAndReadOnlyReviewCannotCreateLiveOwner()throws Exception{
        var p=CoupledAssemblyTestFixtures.plan("complete-new-door");var live=CoupledAssemblyJournal.create(temp,p);var original=Files.readAllBytes(live.directory().resolve("plan.json"));
        assertThrows(FileAlreadyExistsException.class,()->CoupledAssemblyJournal.create(temp,p));assertArrayEquals(original,Files.readAllBytes(live.directory().resolve("plan.json")));
        for(var c:CoupledAssemblyJournal.Live.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));
        for(var c:CoupledAssemblyJournal.Intent.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));assertFalse(p.canAuthorizePlacement());
    }
    @Test void sealedWitnessRequiresThisClosedLiveOriginalAndCompleteGroupPrefix()throws Exception{
        var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan("complete-new-door"));var i=live.intent();assertThrows(IllegalStateException.class,()->live.sealed(i.packet().writes(),2));
        live.applied(i,i.packet().writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);var sealed=live.sealed(i.packet().writes(),2);sealed.verify();assertFalse(sealed.canAuthorizePlacement());
        assertTrue(sealed.matches(live.plan(),live.directory(),i.packet().writes(),2));assertFalse(sealed.matches(CoupledAssemblyTestFixtures.plan("complete-new-door"),live.directory(),i.packet().writes(),2));
        assertThrows(IllegalStateException.class,()->live.sealed(i.packet().writes().subList(0,2),2));assertThrows(IllegalStateException.class,()->live.sealed(i.packet().writes(),1));
        for(var c:CoupledAssemblyJournal.Sealed.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));
    }
    @Test void alteredOrUnknownClosedEventCannotPassOriginalLiveWitnessEvenAfterRehashing()throws Exception{
        var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan("complete-new-door"));var i=live.intent();live.applied(i,i.packet().writes(),CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);var sealed=live.sealed(i.packet().writes(),2);
        var file=live.directory().resolve("outcome.json");var first=Files.readAllBytes(file);var e=JsonParser.parseString(Files.readString(file)).getAsJsonObject();e.getAsJsonObject("value").addProperty("outcome","CANCELLED");e.addProperty("sha256",SelectionBaseline.hash(e.get("value")));Files.writeString(file,e.toString());assertThrows(Exception.class,sealed::verify);
        Files.write(file,first);sealed.verify();Files.writeString(live.directory().resolve("unrecognized.json"),"retained synthetic unknown");assertThrows(Exception.class,sealed::verify);
    }
}
