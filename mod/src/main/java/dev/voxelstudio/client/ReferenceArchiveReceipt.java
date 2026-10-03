package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.*;
import static dev.voxelstudio.client.ReferencePreparationReceipt.*;

/** Exact draft-storage identity, not generation, privacy-erasure or world
 * authority. Reconstruct receipts from the separately confirmed inventory;
 * never adopt a different owner/action just because a new hash is valid. */
final class ReferenceArchiveReceipt {
    static final int MAX_FILES=36,MAX_ACTIONS=256;
    static final long MAX_BYTES=134217728;
    private static final String UUID_PATTERN="[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
    static String owner(String value){if(value==null||!value.matches(UUID_PATTERN))throw new IllegalStateException("必须选定准确的原草稿／操作身份");return value;}
    private static void exact(boolean condition){if(!condition)throw new IllegalStateException("草稿归档、恢复或清理回执与原确认不符；保留记录，不改用新操作");}
    private static void quiet(JsonObject value){exact(number(value,"additionalModelCalls")==0&&number(value,"worldWrites")==0&&!flag(value,"canAuthorizePlacement"));}
    private static void retained(JsonObject value,String purpose){quiet(value);exact(flag(value,"permanentDeletion")==purpose.equals("purge")&&flag(value,"retainsJobOriginals")&&flag(value,"retainsAuditRecords")&&!flag(value,"restoresGenerationAuthority"));}
    static JsonObject capabilities(JsonObject c){
        long version=number(c,"version");exact(version==2||version==3);
        var expected=new ArrayList<>(List.of("format","version","implemented","explicitExactConfirmation","stableActionRecovery","storage","freesActiveDraftQuota","permanentDeletionImplemented","restoreImplemented",
            "maintenanceVersion","permanentDeletionScope","jobOriginalsAndAuditRetained","restoreTransfersGenerationAuthority","submittedOwnersRequireOriginalTerminalReceipts","unknownOutcomesProtected",
            "additionalModelCalls","worldWrites","canAuthorizePlacement","limits"));
        if(version==3){expected.addAll(List.of("originalRecordVersion","originalRecordReadOnly"));exact(number(c,"originalRecordVersion")==1&&flag(c,"originalRecordReadOnly"));}
        keys(c,expected.toArray(String[]::new));
        quiet(c);exact(text(c,"format").equals("ReferenceDraftArchiveCapabilities")&&number(c,"maintenanceVersion")==1
            &&text(c,"storage").equals("same-volume-preserving-move")&&text(c,"permanentDeletionScope").equals("exact-archived-draft-files-only")&&!flag(c,"restoreTransfersGenerationAuthority"));
        for(var k:List.of("implemented","explicitExactConfirmation","stableActionRecovery","freesActiveDraftQuota","permanentDeletionImplemented","restoreImplemented","jobOriginalsAndAuditRetained","submittedOwnersRequireOriginalTerminalReceipts","unknownOutcomesProtected"))exact(flag(c,k));
        var l=c.getAsJsonObject("limits");keys(l,"inputBytes","actions","filesPerDraft","bytesPerDraft","receiptBytes","maintenancePerArchive");
        exact(number(l,"inputBytes")==4096&&number(l,"actions")==MAX_ACTIONS&&number(l,"filesPerDraft")==MAX_FILES&&number(l,"bytesPerDraft")==MAX_BYTES&&number(l,"receiptBytes")==131072&&number(l,"maintenancePerArchive")==1);return c.deepCopy();
    }
    private static void protection(JsonObject p){
        if(text(p,"state").equals("unsubmitted")){keys(p,"state");return;}
        keys(p,"state","jobId","jobState","requestHash","jobSha256","bindingHash","originalRecordsHash","knownCalls");
        exact(text(p,"state").equals("known-terminal")&&Set.of("preview-ready","failed","cancelled").contains(text(p,"jobState")));owner(text(p,"jobId"));
        for(var k:List.of("requestHash","jobSha256","bindingHash","originalRecordsHash"))digest(p,k);number(p,"knownCalls");
    }
    private static JsonObject inventory(JsonObject value){
        var result=new JsonObject();for(var k:List.of("topDirectories","setHashes","preparationHashes","files","totalBytes"))result.add(k,value.get(k));return result;
    }
    private static List<String> sorted(JsonArray array,String pattern,int maximum){
        exact(array.size()<=maximum);var list=new ArrayList<String>();for(var e:array){exact(e.isJsonPrimitive()&&e.getAsJsonPrimitive().isString());String value=e.getAsString();exact(value.matches(pattern));list.add(value);}
        var expected=new ArrayList<>(new TreeSet<>(list));exact(list.equals(expected));return list;
    }
    private static void verifyInventory(JsonObject i){
        keys(i,"topDirectories","setHashes","preparationHashes","files","totalBytes");
        var top=sorted(i.getAsJsonArray("topDirectories"),"preparations|reference-sets",2);
        var sets=sorted(i.getAsJsonArray("setHashes"),"[a-f0-9]{64}",4);var preparations=sorted(i.getAsJsonArray("preparationHashes"),"[a-f0-9]{64}",8);
        exact((sets.isEmpty()||top.contains("reference-sets"))&&(preparations.isEmpty()||top.contains("preparations")));
        var files=i.getAsJsonArray("files");exact(files.size()<=MAX_FILES);var names=new ArrayList<String>();long bytes=0;
        for(var entry:files){var file=entry.getAsJsonObject();keys(file,"path","bytes","sha256");String name=text(file,"path");digest(file,"sha256");long size=number(file,"bytes");exact(size>0&&size<=MAX_BYTES);bytes+=size;
            var segments=name.split("/",-1);exact(segments.length==3);
            exact(segments[0].equals("reference-sets")?sets.contains(segments[1])&&segments[2].matches("manifest\\.json|image-[0-3]\\.png"):
                segments[0].equals("preparations")&&preparations.contains(segments[1])&&segments[2].matches("preparation\\.json|confirmation\\.json"));names.add(name);
        }
        exact(names.equals(new ArrayList<>(new TreeSet<>(names)))&&bytes==number(i,"totalBytes")&&bytes<=MAX_BYTES);
        for(var set:sets)exact(names.contains("reference-sets/"+set+"/manifest.json"));
        for(var preparation:preparations)exact(names.contains("preparations/"+preparation+"/preparation.json"));
    }
    static JsonObject snapshot(String selectedOwner,JsonObject s){
        owner(selectedOwner);keys(s,"format","version","ownerId","topDirectories","setHashes","preparationHashes","files","totalBytes","submissionProtection","additionalModelCalls","worldWrites","canAuthorizePlacement","snapshotHash");
        exact(text(s,"format").equals("ReferenceDraftArchiveSnapshot")&&number(s,"version")==1&&text(s,"ownerId").equals(selectedOwner));quiet(s);hash(s,"snapshotHash");verifyInventory(inventory(s));protection(s.getAsJsonObject("submissionProtection"));return s.deepCopy();
    }
    static JsonObject archiveConfirmation(JsonObject s,String actionId){
        snapshot(text(s,"ownerId"),s);owner(actionId);var c=new JsonObject();c.addProperty("format","ReferenceDraftArchiveConfirmation");c.addProperty("version",1);c.addProperty("action","archive-reference-draft");
        c.addProperty("actionId",actionId);c.add("ownerId",s.get("ownerId"));c.add("snapshotHash",s.get("snapshotHash"));c.addProperty("accepted",true);return c;
    }
    private static JsonObject archiveIntent(JsonObject s,JsonObject c){
        same(c,archiveConfirmation(s,text(c,"actionId")));var i=new JsonObject();i.addProperty("format","ReferenceDraftArchiveIntent");i.addProperty("version",1);
        i.add("actionId",c.get("actionId"));i.add("ownerId",s.get("ownerId"));i.add("confirmation",c);i.addProperty("confirmationHash",ContextReceipt.jsonHash(c));i.add("snapshot",s);return i;
    }
    private static JsonObject archiveReceipt(JsonObject s,JsonObject c){
        var r=new JsonObject();r.addProperty("format","ReferenceDraftArchiveReceipt");r.addProperty("version",1);r.add("actionId",c.get("actionId"));r.add("ownerId",s.get("ownerId"));
        r.addProperty("intentHash",ContextReceipt.jsonHash(archiveIntent(s,c)));r.add("snapshotHash",s.get("snapshotHash"));r.addProperty("state","archived");r.addProperty("fileCount",s.getAsJsonArray("files").size());r.add("totalBytes",s.get("totalBytes"));
        r.addProperty("activeQuotaReleased",true);r.addProperty("permanentlyDeleted",false);r.addProperty("additionalModelCalls",0);r.addProperty("worldWrites",0);r.addProperty("canAuthorizePlacement",false);r.addProperty("receiptHash",ContextReceipt.jsonHash(r));return r;
    }
    /** Lists are discovery only. Obtain and confirm an exact snapshot before
     * starting anything; even a saved accepted consent grants no new action. */
    static JsonObject listing(JsonObject value){
        keys(value,"format","version","drafts","actions","additionalModelCalls","worldWrites","canAuthorizePlacement");quiet(value);
        exact(text(value,"format").equals("ReferenceDraftArchiveList")&&number(value,"version")==1);
        var drafts=value.getAsJsonArray("drafts");var actions=value.getAsJsonArray("actions");exact(drafts.size()<=64&&actions.size()<=MAX_ACTIONS);
        var owners=new HashSet<String>();var ids=new HashSet<String>();
        for(var entry:drafts){var d=entry.getAsJsonObject();owner(text(d,"ownerId"));exact(owners.add(text(d,"ownerId")));
            if(flag(d,"archiveAllowed")){
                keys(d,"ownerId","archiveAllowed","snapshotHash","totalBytes","fileCount","submissionProtection");digest(d,"snapshotHash");
                exact(number(d,"totalBytes")<=MAX_BYTES&&number(d,"fileCount")<=MAX_FILES&&Set.of("unsubmitted","known-terminal").contains(text(d,"submissionProtection")));
            }else if(d.has("originalActionId")){keys(d,"ownerId","archiveAllowed","originalActionId");owner(text(d,"originalActionId"));}
            else{keys(d,"ownerId","archiveAllowed","reason");exact(!text(d,"reason").isBlank()&&text(d,"reason").length()<=512);}
        }
        var maintenanceStates=Set.of("restored","purged","restore-pending","restore-moved-awaiting-receipt","purge-pending","purged-awaiting-receipt");
        for(var entry:actions){var a=entry.getAsJsonObject();keys(a,"ownerId","actionId","snapshotHash","state","maintenanceActionId");
            owner(text(a,"ownerId"));owner(text(a,"actionId"));exact(ids.add(text(a,"actionId")));digest(a,"snapshotHash");String state=text(a,"state");
            exact(maintenanceStates.contains(state)||Set.of("archived","pending","moved-awaiting-receipt","unavailable").contains(state));
            boolean maintenance=!a.get("maintenanceActionId").isJsonNull();exact(maintenanceStates.contains(state)==maintenance||state.equals("unavailable"));
            if(maintenance){owner(text(a,"maintenanceActionId"));exact(!text(a,"maintenanceActionId").equals(text(a,"actionId")));}
        }
        for(var entry:drafts){var d=entry.getAsJsonObject();if(d.has("originalActionId"))exact(actions.asList().stream().anyMatch(e->{var a=e.getAsJsonObject();return text(a,"actionId").equals(text(d,"originalActionId"))&&text(a,"ownerId").equals(text(d,"ownerId"));}));}
        return value.deepCopy();
    }
    /** Recovered server history, NOT a user's new confirmation. The selected
     * list-row snapshot hash prevents silently substituting another history. */
    static JsonObject record(String selectedOwner,String selectedAction,String selectedSnapshotHash,JsonObject value){
        owner(selectedOwner);owner(selectedAction);exact(selectedSnapshotHash!=null&&selectedSnapshotHash.matches("[a-f0-9]{64}"));
        keys(value,"format","version","ownerId","actionId","originalIntent","status","maintenance","additionalModelCalls","worldWrites","canAuthorizePlacement","recordHash");
        quiet(value);hash(value,"recordHash");exact(text(value,"format").equals("ReferenceDraftArchiveRecord")&&number(value,"version")==1&&text(value,"ownerId").equals(selectedOwner)&&text(value,"actionId").equals(selectedAction));
        var intent=value.getAsJsonObject("originalIntent");keys(intent,"format","version","actionId","ownerId","confirmation","confirmationHash","snapshot","intentHash");hash(intent,"intentHash");
        var s=snapshot(selectedOwner,intent.getAsJsonObject("snapshot"));var c=intent.getAsJsonObject("confirmation");exact(text(s,"snapshotHash").equals(selectedSnapshotHash)&&text(c,"actionId").equals(selectedAction));
        var reconstructed=archiveIntent(s,c);reconstructed.addProperty("intentHash",ContextReceipt.jsonHash(reconstructed));same(intent,reconstructed);
        var status=value.getAsJsonObject("status");
        if(value.get("maintenance").isJsonNull())archiveResult(s,c,status);
        else{
            var m=value.getAsJsonObject("maintenance");keys(m,"intent","status");var mi=m.getAsJsonObject("intent");
            keys(mi,"format","version","actionId","archiveActionId","ownerId","purpose","confirmation","confirmationHash","snapshot","intentHash");hash(mi,"intentHash");
            var ms=maintenanceSnapshot(s,c,text(mi,"purpose"),mi.getAsJsonObject("snapshot"));var mc=mi.getAsJsonObject("confirmation");
            var expected=maintenanceIntent(s,c,ms,mc);expected.addProperty("intentHash",ContextReceipt.jsonHash(expected));same(mi,expected);
            var mr=maintenanceResult(s,c,ms,mc,m.getAsJsonObject("status"));current(s,c,ms,mc,status);same(status.get("maintenance"),mr);
        }
        return value.deepCopy();
    }
    static JsonObject archiveResult(JsonObject s,JsonObject c,JsonObject value){
        var expected=archiveReceipt(s,c);
        if(text(value,"format").equals("ReferenceDraftArchiveReceipt")){same(value,expected);return value.deepCopy();}
        keys(value,"format","version","actionId","ownerId","snapshotHash","state","resumeSameAction","activeQuotaReleased","permanentlyDeleted","additionalModelCalls","worldWrites","canAuthorizePlacement");quiet(value);
        String state=text(value,"state");exact(text(value,"format").equals("ReferenceDraftArchiveStatus")&&number(value,"version")==1&&Set.of("pending","moved-awaiting-receipt").contains(state)
            &&flag(value,"resumeSameAction")&&!flag(value,"permanentlyDeleted")&&flag(value,"activeQuotaReleased")==state.equals("moved-awaiting-receipt"));
        for(var k:List.of("actionId","ownerId","snapshotHash"))same(value.get(k),expected.get(k));return value.deepCopy();
    }
    static JsonObject maintenanceSnapshot(JsonObject original,JsonObject originalConsent,String selectedPurpose,JsonObject s){
        exact(Set.of("restore","purge").contains(selectedPurpose));var archive=archiveReceipt(original,originalConsent);
        keys(s,"format","version","purpose","ownerId","archiveActionId","archiveReceiptHash","inventory","submissionProtection","permanentDeletion","retainsJobOriginals","retainsAuditRecords","restoresGenerationAuthority","additionalModelCalls","worldWrites","canAuthorizePlacement","snapshotHash");
        hash(s,"snapshotHash");retained(s,selectedPurpose);exact(text(s,"format").equals("ReferenceArchiveMaintenanceSnapshot")&&number(s,"version")==1&&text(s,"purpose").equals(selectedPurpose));
        same(s.get("ownerId"),original.get("ownerId"));same(s.get("archiveActionId"),originalConsent.get("actionId"));same(s.get("archiveReceiptHash"),archive.get("receiptHash"));
        verifyInventory(s.getAsJsonObject("inventory"));same(s.get("inventory"),inventory(original));protection(s.getAsJsonObject("submissionProtection"));return s.deepCopy();
    }
    static JsonObject maintenanceConfirmation(JsonObject s,String actionId,boolean permanentAccepted,boolean copiesAccepted){
        owner(actionId);owner(text(s,"ownerId"));owner(text(s,"archiveActionId"));exact(!actionId.equals(text(s,"archiveActionId")));
        String purpose=text(s,"purpose");exact(Set.of("restore","purge").contains(purpose));boolean purge=purpose.equals("purge");exact(!purge||permanentAccepted&&copiesAccepted);
        var c=new JsonObject();c.addProperty("format","ReferenceArchiveMaintenanceConfirmation");c.addProperty("version",1);c.addProperty("action",purge?"permanently-purge-archived-reference":"restore-archived-reference");
        c.addProperty("actionId",actionId);for(var k:List.of("archiveActionId","ownerId","snapshotHash"))c.add(k,s.get(k));c.addProperty("accepted",true);
        if(purge){c.addProperty("permanentDeletionAccepted",true);c.addProperty("retainedCopiesAcknowledged",true);}return c;
    }
    private static JsonObject maintenanceIntent(JsonObject original,JsonObject originalConsent,JsonObject s,JsonObject c){
        String purpose=text(s,"purpose");maintenanceSnapshot(original,originalConsent,purpose,s);same(c,maintenanceConfirmation(s,text(c,"actionId"),true,true));
        var i=new JsonObject();i.addProperty("format","ReferenceArchiveMaintenanceIntent");i.addProperty("version",1);for(var k:List.of("actionId","archiveActionId","ownerId"))i.add(k,c.get(k));
        i.addProperty("purpose",purpose);i.add("confirmation",c);i.addProperty("confirmationHash",ContextReceipt.jsonHash(c));i.add("snapshot",s);
        return i;
    }
    static JsonObject maintenanceResult(JsonObject original,JsonObject originalConsent,JsonObject s,JsonObject c,JsonObject value){
        String purpose=text(s,"purpose");var i=maintenanceIntent(original,originalConsent,s,c);
        String format=text(value,"format");retained(value,purpose);
        for(var k:List.of("actionId","archiveActionId","ownerId","snapshotHash"))same(value.get(k),c.get(k));
        if(format.equals("ReferenceArchiveMaintenanceReceipt")){
            keys(value,"format","version","actionId","archiveActionId","ownerId","intentHash","snapshotHash","archiveReceiptHash","state","fileCount","totalBytes","permanentDeletion","retainsJobOriginals","retainsAuditRecords","restoresGenerationAuthority","additionalModelCalls","worldWrites","canAuthorizePlacement","receiptHash");
            hash(value,"receiptHash");same(value.get("archiveReceiptHash"),s.get("archiveReceiptHash"));exact(number(value,"version")==1&&text(value,"intentHash").equals(ContextReceipt.jsonHash(i))
                &&text(value,"state").equals(purpose.equals("purge")?"purged":"restored")&&number(value,"fileCount")==s.getAsJsonObject("inventory").getAsJsonArray("files").size());same(value.get("totalBytes"),s.getAsJsonObject("inventory").get("totalBytes"));
        }else{
            keys(value,"format","version","actionId","archiveActionId","ownerId","snapshotHash","purpose","state","removedFiles","resumeSameAction","permanentDeletion","retainsJobOriginals","retainsAuditRecords","restoresGenerationAuthority","additionalModelCalls","worldWrites","canAuthorizePlacement");
            exact(format.equals("ReferenceArchiveMaintenanceStatus")&&number(value,"version")==1&&text(value,"purpose").equals(purpose)&&flag(value,"resumeSameAction")
                &&(purpose.equals("restore")?Set.of("restore-pending","restore-moved-awaiting-receipt"):Set.of("purge-pending","purged-awaiting-receipt")).contains(text(value,"state")));
            long removed=number(value,"removedFiles");exact(purpose.equals("restore")?removed==0:removed<=s.getAsJsonObject("inventory").getAsJsonArray("files").size());
        }
        return value.deepCopy();
    }
    static JsonObject current(JsonObject original,JsonObject originalConsent,JsonObject s,JsonObject c,JsonObject value){
        keys(value,"format","version","actionId","ownerId","snapshotHash","state","originalArchiveReceipt","maintenance","additionalModelCalls","worldWrites","canAuthorizePlacement");quiet(value);
        exact(text(value,"format").equals("ReferenceDraftArchiveCurrentStatus")&&number(value,"version")==1);same(value.get("actionId"),originalConsent.get("actionId"));same(value.get("ownerId"),original.get("ownerId"));same(value.get("snapshotHash"),original.get("snapshotHash"));
        archiveResult(original,originalConsent,value.getAsJsonObject("originalArchiveReceipt"));var maintenance=maintenanceResult(original,originalConsent,s,c,value.getAsJsonObject("maintenance"));same(value.get("state"),maintenance.get("state"));return value.deepCopy();
    }
    /** Freeze an explicit action locally before any eventual POST. This is
     * not a model reservation and cannot authorize placement or hidden retry. */
    static JsonObject actionReference(JsonObject originalIntent,JsonObject s,JsonObject c){
        String purpose,archiveId;
        if(text(s,"format").equals("ReferenceDraftArchiveSnapshot")){
            exact(originalIntent==null);snapshot(text(s,"ownerId"),s);archiveIntent(s,c);purpose="archive";archiveId=text(c,"actionId");
        }else{
            exact(originalIntent!=null);keys(originalIntent,"format","version","actionId","ownerId","confirmation","confirmationHash","snapshot","intentHash");hash(originalIntent,"intentHash");
            var os=snapshot(text(s,"ownerId"),originalIntent.getAsJsonObject("snapshot"));var oc=originalIntent.getAsJsonObject("confirmation");var expected=archiveIntent(os,oc);
            expected.addProperty("intentHash",ContextReceipt.jsonHash(expected));same(originalIntent,expected);
            maintenanceIntent(os,oc,s,c);purpose=text(s,"purpose");archiveId=text(s,"archiveActionId");
        }
        var r=new JsonObject();r.addProperty("format","ReferenceArchiveActionReference");r.addProperty("version",1);r.addProperty("purpose",purpose);
        r.addProperty("ownerId",text(s,"ownerId"));r.addProperty("actionId",text(c,"actionId"));r.addProperty("archiveActionId",archiveId);
        r.add("originalIntent",originalIntent==null?JsonNull.INSTANCE:originalIntent.deepCopy());r.add("snapshot",s.deepCopy());r.add("confirmation",c.deepCopy());
        r.addProperty("additionalModelCalls",0);r.addProperty("worldWrites",0);r.addProperty("canAuthorizePlacement",false);r.addProperty("referenceHash",ContextReceipt.jsonHash(r));return r;
    }
    static JsonObject verifyActionReference(JsonObject r){
        keys(r,"format","version","purpose","ownerId","actionId","archiveActionId","originalIntent","snapshot","confirmation","additionalModelCalls","worldWrites","canAuthorizePlacement","referenceHash");
        quiet(r);hash(r,"referenceHash");same(r,actionReference(r.get("originalIntent").isJsonNull()?null:r.getAsJsonObject("originalIntent"),r.getAsJsonObject("snapshot"),r.getAsJsonObject("confirmation")));return r.deepCopy();
    }
    static JsonObject actionResult(JsonObject reference,JsonObject value){
        var r=verifyActionReference(reference);var s=r.getAsJsonObject("snapshot");var c=r.getAsJsonObject("confirmation");
        if(text(r,"purpose").equals("archive"))return archiveResult(s,c,value);
        var i=r.getAsJsonObject("originalIntent");return maintenanceResult(i.getAsJsonObject("snapshot"),i.getAsJsonObject("confirmation"),s,c,value);
    }
    private ReferenceArchiveReceipt(){}
}
