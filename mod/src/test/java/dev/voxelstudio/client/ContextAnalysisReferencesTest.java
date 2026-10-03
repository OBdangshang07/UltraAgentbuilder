package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ContextAnalysisReferencesTest {
    @TempDir Path temp;
    private JsonObject reference()throws Exception{return ContextAnalysisReceipt.reference(ContextAnalysisReceiptTest.cases().get(0).getAsJsonObject().getAsJsonObject("prepared"));}
    @Test void immutableReferenceSurvivesRestartWithoutConsentOrSubmission()throws Exception{
        var root=temp.resolve("data");var store=new ContextAnalysisReferences(root);var reference=reference();assertTrue(store.list().isEmpty());
        assertEquals(reference,store.remember(reference));assertEquals(reference,store.remember(reference));
        var restored=new ContextAnalysisReferences(root);assertEquals(reference,restored.read(reference.get("requestHash").getAsString()));assertEquals(List.of(reference),restored.list());
        var changed=restored.list().get(0);changed.addProperty("canAuthorizePlacement",true);assertFalse(restored.list().get(0).get("canAuthorizePlacement").getAsBoolean());
    }
    @Test void sameRequestCannotAcquireDifferentBaselineAndTamperingIsPreserved()throws Exception{
        var root=temp.resolve("data");var store=new ContextAnalysisReferences(root);var reference=reference();store.remember(reference);
        var changed=reference.deepCopy();changed.addProperty("snapshotHash","a".repeat(64));assertThrows(IOException.class,()->store.remember(changed));assertEquals(reference,store.read(reference.get("requestHash").getAsString()));
        var file=root.resolve("context-analysis-references").resolve(reference.get("requestHash").getAsString()+".json");Files.writeString(file,"tampered");assertThrows(IOException.class,store::list);assertEquals("tampered",Files.readString(file));
    }
    @Test void quotaPreservesHistoryAndPendingIsNotAdoptedOrDeleted()throws Exception{
        var root=temp.resolve("data");var store=new ContextAnalysisReferences(root);var reference=reference();
        for(int i=1;i<=31;i++){var next=reference.deepCopy();next.addProperty("requestHash",String.format("%064x",i));store.remember(next);}
        var pending=root.resolve("context-analysis-references").resolve(".pending-"+UUID.randomUUID()+".json");Files.writeString(pending,"incomplete");assertEquals(31,store.list().size());
        assertThrows(IOException.class,()->store.remember(reference));assertEquals("incomplete",Files.readString(pending));assertEquals(31,store.list().size());
        var extra=root.resolve("context-analysis-references").resolve(".pending-"+UUID.randomUUID()+".json");Files.writeString(extra,"preserve-over-quota");
        assertThrows(IOException.class,store::list);assertEquals("preserve-over-quota",Files.readString(extra));
    }
    @Test void pathInjectionWrongTypesAndUnrelatedEntriesNeverBecomeQueries()throws Exception{
        var root=temp.resolve("data");var store=new ContextAnalysisReferences(root);assertThrows(IllegalArgumentException.class,()->store.read("../private"));
        Files.createDirectories(root);Files.writeString(root.resolve("context-analysis-references"),"do-not-overwrite");assertThrows(IOException.class,()->store.remember(reference()));assertEquals("do-not-overwrite",Files.readString(root.resolve("context-analysis-references")));
        var other=new ContextAnalysisReferences(temp.resolve("other-data"));other.remember(reference());var foreign=temp.resolve("other-data/context-analysis-references/private-file");Files.writeString(foreign,"preserve");assertThrows(IOException.class,other::list);assertEquals("preserve",Files.readString(foreign));
    }
    @Test void onlyFirstDurableClaimCanAuthorizeAnAttemptAcrossRestart()throws Exception{
        var root=temp.resolve("data");var store=new ContextAnalysisReferences(root);var reference=reference();
        assertTrue(store.claim(reference));assertFalse(store.claim(reference));assertFalse(new ContextAnalysisReferences(root).claim(reference));
        assertEquals(List.of(reference),store.list());var changed=reference.deepCopy();changed.addProperty("snapshotHash","f".repeat(64));assertThrows(IOException.class,()->store.claim(changed));
    }
}
