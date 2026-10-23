package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.lang.reflect.Modifier;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static dev.voxelstudio.selection.CoupledAssemblyUndoTestFixtures.*;

final class CoupledAssemblyUndoJournalTest {
    @TempDir Path temp;
    private List<CoupledAssemblyUndoJournal.Entry> entries(CoupledAssemblyUndoJournal.Intent i,CoupledAssemblyUndoJournal.Disposition d){return i.packet().writes().stream().map(w->new CoupledAssemblyUndoJournal.Entry(w,d)).toList();}
    @Test void inverseOrderKeepsWholeDoorUpperThenLowerBeforeItsSupportAndRetainsOriginalFacts()throws Exception{
        var f=forward(temp,"complete-new-door");var live=CoupledAssemblyUndoJournal.create(temp,f.engine().undoOrigin());var p=live.plan();assertEquals(2,p.groups().size());assertEquals("door-pair",p.groups().get(0).kind());assertTrue(p.writes().get(0).before().contains("half=upper"));assertTrue(p.writes().get(1).before().contains("half=lower"));assertEquals("minecraft:stone",p.writes().get(2).before());assertFalse(p.canAuthorizePlacement());
        var parent=CoupledAssemblyJournal.inspect(f.live().directory());assertFalse(parent.needsReview(),parent.issue());assertEquals(f.live().plan().hash(),parent.planHash());assertEquals(f.live().plan().player(),parent.player());assertEquals(f.live().plan().compiled().groups(),parent.confirmedSchedule());
    }
    @Test void halfAndMixedDispositionReceiptsCannotSealButCompleteGroupsCan()throws Exception{
        var f=forward(temp,"complete-new-door");var live=CoupledAssemblyUndoJournal.create(temp,f.engine().undoOrigin());var i=live.intent();var all=entries(i,CoupledAssemblyUndoJournal.Disposition.RESTORED);
        assertThrows(IllegalArgumentException.class,()->live.evaluated(i,all.subList(0,1),CoupledAssemblyJournal.ReceiptState.CANCELLED));var mixed=new ArrayList<>(all);mixed.set(1,new CoupledAssemblyUndoJournal.Entry(mixed.get(1).write(),CoupledAssemblyUndoJournal.Disposition.PRESERVED_TARGET));assertThrows(IllegalArgumentException.class,()->live.evaluated(i,mixed,CoupledAssemblyJournal.ReceiptState.COMPLETE));assertFalse(Files.exists(live.directory().resolve("000001.evaluated.json")));
        live.evaluated(i,all,CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);var r=CoupledAssemblyUndoJournal.inspect(live.directory());assertFalse(r.needsReview(),r.issue());assertEquals(all,r.evaluated());assertEquals(2,r.evaluatedGroups());assertFalse(r.canAuthorizePlacement());assertFalse(r.worldDurabilityVerified());
    }
    @Test void inversePacketsAtNative8192BoundaryNeverSplitAGroupAndReadOnlyInspectionRebuildsAll()throws Exception{
        var f=forward(temp,"door-crosses-8192");var live=CoupledAssemblyUndoJournal.create(temp,f.engine().undoOrigin());int count=0,groups=0;boolean pair=false;
        while(count<live.plan().writes().size()){var i=live.intent();assertEquals(count,i.packet().offset());assertEquals(groups,i.packet().groupOffset());assertTrue(i.packet().writes().size()<=512);for(var g:i.packet().groups())if(g.kind().equals("door-pair")){pair=true;assertEquals(2,g.writes().size());assertTrue(g.writes().get(0).before().contains("half=upper"));}var rows=entries(i,CoupledAssemblyUndoJournal.Disposition.RESTORED);live.evaluated(i,rows,CoupledAssemblyJournal.ReceiptState.COMPLETE);count+=rows.size();groups+=i.packet().groups().size();}
        assertTrue(pair);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);var r=CoupledAssemblyUndoJournal.inspect(live.directory());assertFalse(r.needsReview(),r.issue());assertEquals(count,r.evaluated().size());assertEquals(groups,r.evaluatedGroups());
    }
    @Test void cancellationOnlyClosesWholeInversePrefixAndCannotResume()throws Exception{
        var f=forward(temp,"complete-new-door");var live=CoupledAssemblyUndoJournal.create(temp,f.engine().undoOrigin());var i=live.intent();live.evaluated(i,entries(i,CoupledAssemblyUndoJournal.Disposition.PRESERVED_TARGET).subList(0,2),CoupledAssemblyJournal.ReceiptState.CANCELLED);live.finish(CoupledAssemblyJournal.Outcome.CANCELLED);var r=CoupledAssemblyUndoJournal.inspect(live.directory());assertFalse(r.needsReview(),r.issue());assertEquals(1,r.evaluatedGroups());assertEquals(2,r.evaluated().size());assertThrows(Exception.class,live::intent);
    }
    @Test void unknownMissingAmbiguousAndSelfRehashedMixedReceiptsRemainReviewOnly()throws Exception{
        for(int kind=0;kind<4;kind++){var f=forward(temp,"complete-new-door");var live=CoupledAssemblyUndoJournal.create(temp,f.engine().undoOrigin());var i=live.intent();if(kind==1)live.ambiguous(i,"Synthetic inverse second member unknown");if(kind==2)Files.writeString(live.directory().resolve("retained.partial"),"Synthetic partial");if(kind==3){live.evaluated(i,entries(i,CoupledAssemblyUndoJournal.Disposition.RESTORED),CoupledAssemblyJournal.ReceiptState.COMPLETE);live.finish(CoupledAssemblyJournal.Outcome.COMPLETED);var file=live.directory().resolve("000001.evaluated.json");var e=JsonParser.parseString(Files.readString(file)).getAsJsonObject();e.getAsJsonObject("value").getAsJsonArray("entries").get(1).getAsJsonObject().addProperty("disposition","PRESERVED_TARGET");e.addProperty("sha256",SelectionBaseline.hash(e.get("value")));Files.writeString(file,e.toString());}assertTrue(CoupledAssemblyUndoJournal.inspect(live.directory()).needsReview());}
    }
    @Test void originalLiveWitnessIsOneUseAndChangedParentCannotGrantInverseWork()throws Exception{
        var f=forward(temp,"complete-new-door");var origin=f.engine().undoOrigin();var live=CoupledAssemblyUndoJournal.create(temp,origin);assertThrows(IllegalStateException.class,()->CoupledAssemblyUndoJournal.create(temp,origin));Files.writeString(f.live().directory().resolve("source.json"),"{}");assertThrows(Exception.class,live::intent);assertTrue(CoupledAssemblyUndoJournal.inspect(live.directory()).needsReview());
        for(var type:List.of(CoupledAssemblyUndoJournal.Plan.class,CoupledAssemblyUndoJournal.Live.class,CoupledAssemblyUndoJournal.Intent.class))for(var c:type.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));
    }
}
