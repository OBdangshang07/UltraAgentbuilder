package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceArchiveActionsTest {
    @TempDir Path dir;
    private static JsonObject reference(JsonObject f,boolean maintenance){return ReferenceArchiveReceipt.actionReference(
        maintenance?f.getAsJsonObject("recordFinal").getAsJsonObject("originalIntent"):null,
        f.getAsJsonObject(maintenance?"maintenanceSnapshot":"snapshot"),f.getAsJsonObject(maintenance?"maintenanceConfirmation":"confirmation"));}
    @Test void actualWorkerArchiveRestoreAndPurgeIntentsRemainImmutableAcrossClientRestart()throws Exception{
        var store=new ReferenceArchiveActions(dir);assertEquals(List.of(),store.list());assertFalse(Files.exists(dir.resolve("client-state")));
        var saved=new ArrayList<JsonObject>();
        for(var item:ReferenceArchiveReceiptTest.cases()){
            var f=item.getAsJsonObject();for(boolean maintenance:new boolean[]{false,true}){
                var r=reference(f,maintenance);assertEquals(r,ReferenceArchiveReceipt.verifyActionReference(r));assertEquals(r,store.remember(r));
                assertEquals(f.get(maintenance?"maintenanceReceipt":"receipt"),ReferenceArchiveReceipt.actionResult(r,f.getAsJsonObject(maintenance?"maintenanceReceipt":"receipt")));
                String id=r.get("actionId").getAsString();byte[] original=Files.readAllBytes(dir.resolve("client-state/reference-archive-actions-v1/"+id+".json"));
                assertEquals(r,new ReferenceArchiveActions(dir).remember(r));assertArrayEquals(original,Files.readAllBytes(dir.resolve("client-state/reference-archive-actions-v1/"+id+".json")));
                var external=store.read(id);external.addProperty("worldWrites",1);assertEquals(r,store.read(id));saved.add(r);
            }
        }
        assertEquals(4,store.list().size());for(var r:saved)assertEquals(r,new ReferenceArchiveActions(dir).read(r.get("actionId").getAsString()));
    }
    @Test void sameActionCannotBeReboundEvenWithNewValidSnapshotAndHashes()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=reference(f,false);var store=new ReferenceArchiveActions(dir);store.remember(r);
        var s=f.getAsJsonObject("snapshot").deepCopy();s.addProperty("ownerId",UUID.randomUUID().toString());ReferenceArchiveReceiptTest.rehash(s,"snapshotHash");
        var other=ReferenceArchiveReceipt.actionReference(null,s,ReferenceArchiveReceipt.archiveConfirmation(s,r.get("actionId").getAsString()));
        assertThrows(IOException.class,()->store.remember(other));assertEquals(r,store.read(r.get("actionId").getAsString()));
    }
    @Test void corruptForeignPendingAndLinkedHistoryArePreservedAndPreventNewPublication()throws Exception{
        for(String kind:List.of("corrupt","foreign","pending","linked")){
            Path data=dir.resolve(kind);var store=new ReferenceArchiveActions(data);var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var r=reference(f,false);store.remember(r);
            Path root=data.resolve("client-state/reference-archive-actions-v1"),file=root.resolve(r.get("actionId").getAsString()+".json");
            Path preserved;
            switch(kind){
                case "corrupt"->{Files.writeString(file,"{broken");preserved=file;}
                case "foreign"->{preserved=root.resolve("unknown.txt");Files.writeString(preserved,"must remain");}
                case "pending"->{preserved=root.resolve(".pending-"+UUID.randomUUID()+".json");Files.write(preserved,Files.readAllBytes(file));}
                default->{preserved=root.resolve(UUID.randomUUID()+".json");Files.createSymbolicLink(preserved,file);}
            }
            byte[] before=Files.readAllBytes(preserved);var s=f.getAsJsonObject("snapshot");var other=ReferenceArchiveReceipt.actionReference(null,s,ReferenceArchiveReceipt.archiveConfirmation(s,UUID.randomUUID().toString()));
            assertThrows(IOException.class,()->store.remember(other),kind);assertThrows(IOException.class,store::list,kind);assertArrayEquals(before,Files.readAllBytes(preserved));
        }
    }
    @Test void independentlyRehashedScopePurposeAndAuthorityCannotBecomeLocalActionReferences()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var original=reference(f,true);
        for(String field:List.of("ownerId","actionId","archiveActionId","purpose","canAuthorizePlacement","additionalModelCalls","worldWrites")){
            var bad=original.deepCopy();if(field.endsWith("Id"))bad.addProperty(field,UUID.randomUUID().toString());else if(field.equals("purpose"))bad.addProperty(field,"purge");
            else if(field.equals("canAuthorizePlacement"))bad.addProperty(field,true);else bad.addProperty(field,1);ReferenceArchiveReceiptTest.rehash(bad,"referenceHash");
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.verifyActionReference(bad),field);
        }
        assertFalse(Files.exists(dir.resolve("client-state")));
    }
    @Test void claimPublishesOnceAndNeverConvertsAnExistingOriginalToAnotherFirstSend()throws Exception{
        var f=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var original=reference(f,false);var store=new ReferenceArchiveActions(dir);
        assertTrue(store.claim(original));String id=original.get("actionId").getAsString();Path file=dir.resolve("client-state/reference-archive-actions-v1/"+id+".json");
        byte[] before=Files.readAllBytes(file);assertFalse(store.claim(original));assertFalse(new ReferenceArchiveActions(dir).claim(original));
        assertArrayEquals(before,Files.readAllBytes(file));assertEquals(List.of(original),store.list());
        var otherSnapshot=f.getAsJsonObject("snapshot").deepCopy();otherSnapshot.addProperty("ownerId",UUID.randomUUID().toString());ReferenceArchiveReceiptTest.rehash(otherSnapshot,"snapshotHash");
        var rebound=ReferenceArchiveReceipt.actionReference(null,otherSnapshot,ReferenceArchiveReceipt.archiveConfirmation(otherSnapshot,id));
        assertThrows(IOException.class,()->store.claim(rebound));assertArrayEquals(before,Files.readAllBytes(file));
    }
    @Test void validJsonEnvelopeWithChangedContentOrChecksumIsPreservedAndBlocksReadListAndClaim()throws Exception{
        var fixture=ReferenceArchiveReceiptTest.cases().get(0).getAsJsonObject();var original=reference(fixture,false);
        for(String kind:List.of("content","checksum")){
            Path data=dir.resolve(kind);var store=new ReferenceArchiveActions(data);store.remember(original);
            String id=original.get("actionId").getAsString();Path file=data.resolve("client-state/reference-archive-actions-v1/"+id+".json");
            var envelope=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            if(kind.equals("content"))envelope.addProperty("createdAt",envelope.get("createdAt").getAsLong()-1);
            else envelope.addProperty("sha256","0".repeat(64));
            Files.writeString(file,ContextReceipt.canonicalJson(envelope));byte[] corrupted=Files.readAllBytes(file);
            assertThrows(IOException.class,()->store.read(id),kind);assertThrows(IOException.class,store::list,kind);
            assertThrows(IOException.class,()->store.claim(original),kind);assertThrows(IOException.class,()->store.remember(original),kind);
            assertArrayEquals(corrupted,Files.readAllBytes(file),"Corrupt original must not be repaired/overwritten");
            try(var files=Files.list(file.getParent())){assertEquals(List.of(id+".json"),files.map(p->p.getFileName().toString()).toList());}
        }
    }
}
