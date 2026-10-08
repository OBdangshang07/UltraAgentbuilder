package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.SelectionReadService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

final class ReferenceWorldPatchReferencesTest {
    @TempDir Path temp;
    static JsonObject fixture()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/reference-world-patch-client-task.json"))).getAsJsonObject();}
    static SelectionReadService.Capture capture(JsonObject f){return new SelectionReadService.Capture(f.get("contextId").getAsString(),WorldPatchJobReceipt.selection(f.getAsJsonObject("selection")),f.get("contextRevision").getAsLong(),f.get("payload").getAsString(),null,false);}
    static JsonObject reference(JsonObject f){
        var c=capture(f);var p=ReferenceWorldPatchTaskReceipt.verify(c,f.getAsJsonObject("saved"),f.getAsJsonObject("intent"),f.getAsJsonObject("referenceManifest"),f.getAsJsonObject("capability"),f.getAsJsonObject("prepared"));
        return ReferenceWorldPatchJobReceipt.reference(c,p,f.getAsJsonObject("frozen"),ReferenceWorldPatchJobReceipt.capabilitiesRuntime(f.getAsJsonObject("capabilities")));
    }
    private Path file(JsonObject r){return temp.resolve("reference-world-patch-references/"+r.get("capsuleId").getAsString()+".json");}
    private JsonObject another(JsonObject r,int index){var copy=r.deepCopy();String id=String.format("%064x",index);copy.addProperty("capsuleId",id);copy.getAsJsonObject("send").addProperty("capsuleId",id);copy.addProperty("submissionHash",ContextReceipt.jsonHash(copy.get("send")));return copy;}
    @Test void restartKeepsExactIndependentClaimAndDefensiveCopies()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);assertEquals(List.of(),store.list());assertTrue(store.claim(r));assertFalse(store.claim(r));assertFalse(new ReferenceWorldPatchReferences(temp).claim(r));
        assertEquals(List.of(r),store.list());var copy=store.read(r.get("capsuleId").getAsString());copy.addProperty("canAuthorizePlacement",true);assertEquals(r,store.list().get(0));
        var envelope=JsonParser.parseString(Files.readString(file(r))).getAsJsonObject();assertEquals("SavedReferenceWorldPatchReference",envelope.get("format").getAsString());assertFalse(Files.exists(temp.resolve("world-patch-references")));
    }
    @Test void textAndJointReferencesNeverShareProtocolOrHistory()throws Exception{
        var joint=reference(fixture());var old=WorldPatchTaskReceiptTest.fixture();var text=WorldPatchJobReceipt.reference(ContextTaskReceiptTest.capture(old),old.getAsJsonObject("prepared"),old.getAsJsonObject("frozen"),old.get("runtimeHash").getAsString());
        var store=new ReferenceWorldPatchReferences(temp);var legacy=new WorldPatchReferences(temp);assertThrows(RuntimeException.class,()->store.claim(text));assertThrows(RuntimeException.class,()->legacy.claim(joint));
        assertTrue(store.claim(joint));assertEquals(List.of(),legacy.list());assertTrue(legacy.claim(text));assertEquals(List.of(joint),store.list());assertEquals(List.of(text),legacy.list());
    }
    @Test void corruptedOriginalIsPreservedAndCannotClaimAgain()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);store.claim(r);Files.writeString(file(r),"original-corruption");
        assertThrows(IOException.class,store::list);assertThrows(IOException.class,()->store.claim(r));assertEquals("original-corruption",Files.readString(file(r)));
    }
    @Test void envelopeSwapEvenRehashedCannotPromoteLegacyOrAuthority()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);store.claim(r);String original=Files.readString(file(r));
        for(var key:List.of("format","createdAt","reference")){
            var v=JsonParser.parseString(original).getAsJsonObject();if(key.equals("format"))v.addProperty(key,"SavedWorldPatchReference");
            else if(key.equals("createdAt"))v.addProperty(key,"1");else v.getAsJsonObject(key).addProperty("canAuthorizePlacement",true);
            v.remove("sha256");v.addProperty("sha256",ContextReceipt.jsonHash(v));Files.writeString(file(r),v.toString());assertThrows(IOException.class,store::list,key);
        }
    }
    @Test void pendingWithoutPublishedOriginalCannotBeAdoptedOrPermitAnotherClaim()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);store.claim(r);Path pending=file(r).resolveSibling(".pending-"+UUID.randomUUID()+".json");Files.move(file(r),pending);byte[] before=Files.readAllBytes(pending);
        assertEquals(List.of(),store.list());assertThrows(IOException.class,()->store.claim(r));assertThrows(IOException.class,()->store.claim(another(r,1)));assertArrayEquals(before,Files.readAllBytes(pending));assertFalse(Files.exists(file(r)));
    }
    @Test void quotaDoesNotDeleteOriginalsOrIgnorePendingRecords()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);for(int i=1;i<=8;i++)assertTrue(store.claim(another(r,i)));
        assertThrows(IOException.class,()->store.claim(r));assertEquals(8,store.list().size());
        assertFalse(new ReferenceWorldPatchReferences(temp).claim(another(r,1)));try(var files=Files.list(temp.resolve("reference-world-patch-references"))){assertEquals(8,files.count());}
    }
    @Test void duplicatesMalformedUtf8QuotaAndForeignEntryCannotBeRegenerated()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);store.claim(r);String original=Files.readString(file(r));
        for(var bytes:List.of(("{\"version\":1,"+original.substring(1)).getBytes(java.nio.charset.StandardCharsets.UTF_8),new byte[]{(byte)0xc0,(byte)0x80},new byte[16385])){
            Files.write(file(r),bytes);assertThrows(IOException.class,store::list);assertThrows(IOException.class,()->store.claim(r));assertArrayEquals(bytes,Files.readAllBytes(file(r)));
        }
        Files.writeString(file(r),original);Path foreign=file(r).resolveSibling("unknown-preserved");Files.writeString(foreign,"keep");assertThrows(IOException.class,store::list);assertThrows(IOException.class,()->store.claim(another(r,1)));assertEquals("keep",Files.readString(foreign));
    }
    @Test void traversalWrongRootAndReboundPinsRejectWithoutReplacement()throws Exception{
        var r=reference(fixture());var store=new ReferenceWorldPatchReferences(temp);assertThrows(IllegalArgumentException.class,()->store.read("../private"));
        Files.writeString(temp.resolve("reference-world-patch-references"),"wrong-root");assertThrows(IOException.class,()->store.claim(r));assertEquals("wrong-root",Files.readString(temp.resolve("reference-world-patch-references")));
        var other=new ReferenceWorldPatchReferences(temp.resolve("other"));assertTrue(other.claim(r));var changed=r.deepCopy();changed.getAsJsonObject("recipient").addProperty("model","different-model");assertThrows(IOException.class,()->other.claim(changed));assertEquals(r,other.read(r.get("capsuleId").getAsString()));
    }
    @Test void concurrentIndependentStoresCannotBothOwnTheSameSend()throws Exception{
        var r=reference(fixture());var start=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try{var tasks=new ArrayList<Future<Boolean>>();for(int i=0;i<2;i++)tasks.add(pool.submit(()->{start.await();try{return new ReferenceWorldPatchReferences(temp).claim(r);}catch(IOException preserved){return false;}}));
            start.countDown();int owners=0;for(var task:tasks)if(task.get(5,TimeUnit.SECONDS))owners++;assertEquals(1,owners);assertEquals(r,new ReferenceWorldPatchReferences(temp).read(r.get("capsuleId").getAsString()));
        }finally{pool.shutdownNow();}
    }
}
