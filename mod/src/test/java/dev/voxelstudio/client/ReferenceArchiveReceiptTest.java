package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceArchiveReceiptTest {
    static JsonArray cases()throws Exception{return ReferencePreparationReceiptTest.fixtures().getAsJsonArray("archiveCases");}
    static void rehash(JsonObject value,String field){value.remove(field);value.addProperty(field,ContextReceipt.jsonHash(value));}
    @Test void actualProductionWorkerArchiveMaintenancePendingAndFinalReceiptsBindExactOriginalConfirmations()throws Exception{
        var fixtures=ReferencePreparationReceiptTest.fixtures();assertEquals(0,fixtures.get("modelCalls").getAsInt());assertEquals(0,fixtures.get("worldWrites").getAsInt());
        assertEquals(fixtures.get("archiveCapability"),ReferenceArchiveReceipt.capabilities(fixtures.getAsJsonObject("archiveCapability")));assertEquals(2,cases().size());
        for(var item:cases()){
            var f=item.getAsJsonObject();var s=f.getAsJsonObject("snapshot");var c=f.getAsJsonObject("confirmation");var ms=f.getAsJsonObject("maintenanceSnapshot");var mc=f.getAsJsonObject("maintenanceConfirmation");
            assertEquals(s,ReferenceArchiveReceipt.snapshot(s.get("ownerId").getAsString(),s));assertEquals(c,ReferenceArchiveReceipt.archiveConfirmation(s,c.get("actionId").getAsString()));
            for(var key:List.of("pending","receipt"))assertEquals(f.get(key),ReferenceArchiveReceipt.archiveResult(s,c,f.getAsJsonObject(key)));
            assertEquals(ms,ReferenceArchiveReceipt.maintenanceSnapshot(s,c,f.get("purpose").getAsString(),ms));
            assertEquals(mc,ReferenceArchiveReceipt.maintenanceConfirmation(ms,mc.get("actionId").getAsString(),true,true));
            for(var key:List.of("maintenancePending","maintenanceReceipt"))assertEquals(f.get(key),ReferenceArchiveReceipt.maintenanceResult(s,c,ms,mc,f.getAsJsonObject(key)));
            assertEquals(f.get("current"),ReferenceArchiveReceipt.current(s,c,ms,mc,f.getAsJsonObject("current")));
            var result=ReferenceArchiveReceipt.maintenanceResult(s,c,ms,mc,f.getAsJsonObject("maintenanceReceipt"));result.addProperty("state","external edit");assertNotEquals(result,f.get("maintenanceReceipt"));
        }
    }
    @Test void rehashedInventoryOwnerUnknownStateAndAuthorityCannotReplaceAnIndependentConfirmation()throws Exception{
        for(var item:cases()){
            var f=item.getAsJsonObject();var s=f.getAsJsonObject("snapshot");var c=f.getAsJsonObject("confirmation");
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.snapshot(UUID.randomUUID().toString(),s));
            for(String mutation:List.of("path","bytes","count","duplicate","authority","unknown")){
                var bad=s.deepCopy();var file=bad.getAsJsonArray("files").get(0).getAsJsonObject();
                switch(mutation){
                    case "path"->file.addProperty("path","../../world/player.dat");
                    case "bytes"->file.addProperty("bytes",1.5);
                    case "count"->bad.addProperty("totalBytes",1);
                    case "duplicate"->bad.getAsJsonArray("files").add(file.deepCopy());
                    case "authority"->bad.addProperty("canAuthorizePlacement",true);
                    case "unknown"->bad.addProperty("cleanupEverything",true);
                }rehash(bad,"snapshotHash");assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.snapshot(s.get("ownerId").getAsString(),bad),mutation);
            }
            var altered=s.deepCopy();altered.getAsJsonArray("files").get(0).getAsJsonObject().addProperty("sha256","d".repeat(64));rehash(altered,"snapshotHash");
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.archiveResult(altered,c,f.getAsJsonObject("receipt")));
            var pending=f.getAsJsonObject("pending").deepCopy();pending.addProperty("state","safe-to-resend");assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.archiveResult(s,c,pending));
        }
    }
    @Test void purgeCannotBeConfirmedWithoutBothIndependentDeletionAndRetainedCopyAcknowledgements()throws Exception{
        var f=cases().get(1).getAsJsonObject();assertEquals("purge",f.get("purpose").getAsString());var s=f.getAsJsonObject("maintenanceSnapshot");String id=UUID.randomUUID().toString();
        for(boolean deletion:new boolean[]{false,true})for(boolean copies:new boolean[]{false,true})if(!deletion||!copies)assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.maintenanceConfirmation(s,id,deletion,copies));
        assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.maintenanceConfirmation(s,s.get("archiveActionId").getAsString(),true,true));
    }
    @Test void allEightActualPreparationVersionsRemainRestorableButNinthOrDuplicateIsRejected()throws Exception{
        var f=cases().get(0).getAsJsonObject();var s=f.getAsJsonObject("snapshot");assertEquals(8,s.getAsJsonArray("preparationHashes").size());
        assertEquals(s,ReferenceArchiveReceipt.snapshot(s.get("ownerId").getAsString(),s));
        for(boolean duplicate:new boolean[]{false,true}){
            var bad=s.deepCopy();bad.getAsJsonArray("preparationHashes").add(duplicate?s.getAsJsonArray("preparationHashes").get(0):new JsonPrimitive("a".repeat(64)));rehash(bad,"snapshotHash");
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.snapshot(s.get("ownerId").getAsString(),bad));
        }
    }
    @Test void rehashedMaintenanceReceiptsCannotTransferOwnerScopePurposeInventoryOrGenerationAuthority()throws Exception{
        for(var item:cases()){
            var f=item.getAsJsonObject();var original=f.getAsJsonObject("snapshot");var consent=f.getAsJsonObject("confirmation");var s=f.getAsJsonObject("maintenanceSnapshot");var c=f.getAsJsonObject("maintenanceConfirmation");
            for(String field:List.of("actionId","archiveActionId","ownerId","snapshotHash","archiveReceiptHash","intentHash","fileCount","totalBytes","worldWrites","additionalModelCalls","canAuthorizePlacement","restoresGenerationAuthority","retainsJobOriginals","permanentDeletion","state")){
                var r=f.getAsJsonObject("maintenanceReceipt").deepCopy();
                if(List.of("canAuthorizePlacement","restoresGenerationAuthority").contains(field))r.addProperty(field,true);
                else if(List.of("retainsJobOriginals","permanentDeletion").contains(field))r.addProperty(field,!r.get(field).getAsBoolean());
                else if(List.of("fileCount","totalBytes","worldWrites","additionalModelCalls").contains(field))r.addProperty(field,r.get(field).getAsLong()+1);
                else r.addProperty(field,field.endsWith("Id")?UUID.randomUUID().toString():field.equals("state")?"made-up":"c".repeat(64));
                rehash(r,"receiptHash");assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.maintenanceResult(original,consent,s,c,r),field);
            }
            var other=s.deepCopy();other.addProperty("purpose",f.get("purpose").getAsString().equals("purge")?"restore":"purge");rehash(other,"snapshotHash");
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.maintenanceSnapshot(original,consent,f.get("purpose").getAsString(),other));
            var wrong=c.deepCopy();wrong.addProperty("actionId",UUID.randomUUID().toString());assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.maintenanceResult(original,consent,s,wrong,f.getAsJsonObject("maintenanceReceipt")));
            var current=f.getAsJsonObject("current").deepCopy();current.addProperty("state","archived");assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.current(original,consent,s,c,current));
        }
    }
    @Test void unknownCapabilitiesOrRaisedQuotaCannotSilentlyEnableAStorageAction()throws Exception{
        var actual=ReferencePreparationReceiptTest.fixtures().getAsJsonObject("archiveCapability");
        for(String field:List.of("version","restoreTransfersGenerationAuthority","jobOriginalsAndAuditRetained","limits")){
            var bad=actual.deepCopy();switch(field){case "version"->bad.addProperty(field,4);case "restoreTransfersGenerationAuthority"->bad.addProperty(field,true);
                case "jobOriginalsAndAuditRetained"->bad.addProperty(field,false);case "limits"->bad.getAsJsonObject(field).addProperty("filesPerDraft",100);}
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.capabilities(bad));
        }
        assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.owner("../../outside"));
    }
    @Test void productionRecordsRecoverPreexistingHistoryWithoutChangingOriginalIdentityOrGrantingConsent()throws Exception{
        var fixtures=ReferencePreparationReceiptTest.fixtures();var list=fixtures.getAsJsonObject("archiveListing");
        assertEquals(list,ReferenceArchiveReceipt.listing(list));assertEquals(2,list.getAsJsonArray("actions").size());
        for(var item:cases()){
            var f=item.getAsJsonObject();var s=f.getAsJsonObject("snapshot");String owner=s.get("ownerId").getAsString(),action=f.getAsJsonObject("confirmation").get("actionId").getAsString(),hash=s.get("snapshotHash").getAsString();
            for(var key:List.of("recordPending","recordArchived","recordMaintenancePending","recordFinal")){
                var r=f.getAsJsonObject(key);assertEquals(r,ReferenceArchiveReceipt.record(owner,action,hash,r));
                assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.record(UUID.randomUUID().toString(),action,hash,r));
                assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.record(owner,UUID.randomUUID().toString(),hash,r));
                assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.record(owner,action,"a".repeat(64),r));
                var copy=ReferenceArchiveReceipt.record(owner,action,hash,r);copy.addProperty("worldWrites",1);assertEquals(0,r.get("worldWrites").getAsInt());
            }
        }
    }
    @Test void rehashedRecordsCannotSubstituteHistoricalConsentSnapshotStatusMaintenanceOrAuthority()throws Exception{
        for(var item:cases()){
            var f=item.getAsJsonObject();var s=f.getAsJsonObject("snapshot");String owner=s.get("ownerId").getAsString(),action=f.getAsJsonObject("confirmation").get("actionId").getAsString(),hash=s.get("snapshotHash").getAsString();
            for(var field:List.of("originalIntent","maintenance","status","permission","confirmation")){
                var r=f.getAsJsonObject("recordFinal").deepCopy();var intent=r.getAsJsonObject("originalIntent");
                switch(field){
                    case "originalIntent"->{intent.addProperty("ownerId",UUID.randomUUID().toString());rehash(intent,"intentHash");}
                    case "maintenance"->{var mi=r.getAsJsonObject("maintenance").getAsJsonObject("intent");mi.addProperty("purpose",f.get("purpose").getAsString().equals("purge")?"restore":"purge");rehash(mi,"intentHash");}
                    case "status"->r.getAsJsonObject("status").addProperty("state","archived");
                    case "permission"->r.addProperty("canAuthorizePlacement",true);
                    case "confirmation"->{var c=intent.getAsJsonObject("confirmation");c.addProperty("accepted",false);intent.addProperty("confirmationHash",ContextReceipt.jsonHash(c));rehash(intent,"intentHash");}
                }rehash(r,"recordHash");assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.record(owner,action,hash,r),field);
            }
            var nullMaintenance=f.getAsJsonObject("recordFinal").deepCopy();nullMaintenance.add("maintenance",JsonNull.INSTANCE);rehash(nullMaintenance,"recordHash");
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.record(owner,action,hash,nullMaintenance));
        }
    }
    @Test void listingIsBoundedDiscoveryOnlyAndOldV2CapabilitiesCannotClaimRecordSupport()throws Exception{
        var fixtures=ReferencePreparationReceiptTest.fixtures();var cap=fixtures.getAsJsonObject("archiveCapability");assertEquals(3,cap.get("version").getAsInt());
        var v2=cap.deepCopy();v2.addProperty("version",2);v2.remove("originalRecordVersion");v2.remove("originalRecordReadOnly");assertEquals(v2,ReferenceArchiveReceipt.capabilities(v2));
        for(var field:List.of("originalRecordVersion","originalRecordReadOnly")){
            var bad=cap.deepCopy();if(field.endsWith("Version"))bad.addProperty(field,2);else bad.addProperty(field,false);assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.capabilities(bad));
        }
        var listed=fixtures.getAsJsonObject("archiveListing");
        for(var field:List.of("duplicate","owner","state","maintenance","authority","foreign")){
            var bad=listed.deepCopy();var a=bad.getAsJsonArray("actions").get(0).getAsJsonObject();
            switch(field){case "duplicate"->bad.getAsJsonArray("actions").add(a.deepCopy());case "owner"->a.addProperty("ownerId","../../world");
                case "state"->a.addProperty("state","can-resend");case "maintenance"->a.add("maintenanceActionId",JsonNull.INSTANCE);
                case "authority"->bad.addProperty("additionalModelCalls",1);case "foreign"->bad.addProperty("deleteAll",true);}
            assertThrows(IllegalStateException.class,()->ReferenceArchiveReceipt.listing(bad),field);
        }
    }
}
