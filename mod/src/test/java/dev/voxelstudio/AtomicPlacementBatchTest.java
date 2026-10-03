package dev.voxelstudio;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AtomicPlacementBatchTest {
    @TempDir Path root;
    private static JsonObject entry(int i){var e=new JsonObject();e.addProperty("pos",i);e.addProperty("before","minecraft:air");e.addProperty("after","minecraft:stone");return e;}
    @Test void completeDoorGroupsNeverOverflowAtAnyBatchBoundary(){
        assertEquals(512,JournalRecovery.MAX_BATCH_ENTRIES);
        for(int size=0;size<=512;size++)for(int group=1;group<=384;group++)assertEquals(size+group<=512,PlacementService.atomicGroupFitsBatch(size,group));
        assertFalse(PlacementService.atomicGroupFitsBatch(511,2));assertTrue(PlacementService.atomicGroupFitsBatch(0,2));
        assertThrows(IllegalArgumentException.class,()->PlacementService.atomicGroupFitsBatch(-1,2));
        assertThrows(IllegalArgumentException.class,()->PlacementService.atomicGroupFitsBatch(0,513));
        assertThrows(IllegalArgumentException.class,()->PlacementService.atomicGroupFitsBatch(0,0));
    }
    @Test void deferredGroupsRemainWholeAndAllReceiptsPassTheUnchangedReader()throws Exception {
        Files.writeString(root.resolve("metadata.json"),"{\"player\":\"fixture\",\"dimension\":\"minecraft:overworld\"}");
        var batches=new ArrayList<JsonArray>();JsonArray batch=new JsonArray();int next=0;
        var groupBatches=new ArrayList<List<Integer>>();
        for(int size:new int[]{511,2,512,384,256,3,2}){
            if(!PlacementService.atomicGroupFitsBatch(batch.size(),size)){batches.add(batch);batch=new JsonArray();}
            var positions=new ArrayList<Integer>();for(int i=0;i<size;i++){positions.add(next);batch.add(entry(next++));}groupBatches.add(positions);
        }
        if(!batch.isEmpty())batches.add(batch);
        for(int b=0;b<batches.size();b++){
            assertTrue(batches.get(b).size()<=512);
            for(String suffix:List.of("intent","applied"))Files.writeString(root.resolve(String.format("%06d.%s.json",b,suffix)),batches.get(b).toString());
        }
        for(var group:groupBatches)assertEquals(1,batches.stream().filter(a->a.asList().stream().anyMatch(e->e.getAsJsonObject().get("pos").getAsInt()==group.get(0))&&a.asList().stream().anyMatch(e->e.getAsJsonObject().get("pos").getAsInt()==group.get(group.size()-1))).count());
        var review=JournalRecovery.inspect(root);assertFalse(review.needsReview(),review.issue());assertEquals(next,review.entries().size());assertEquals(0,review.missingReceipts());
    }
    @Test void original513EntryJournalStillRequiresReviewAndIsNotRewritten()throws Exception {
        Files.writeString(root.resolve("metadata.json"),"{}");var data=new JsonArray();for(int i=0;i<513;i++)data.add(entry(i));
        for(String suffix:List.of("intent","applied"))Files.writeString(root.resolve("000000."+suffix+".json"),data.toString());
        var review=JournalRecovery.inspect(root);assertTrue(review.needsReview());assertEquals("Journal batch exceeds 512 entries",review.issue());assertEquals(0,review.missingReceipts());
        assertEquals(data.toString(),Files.readString(root.resolve("000000.intent.json")));
    }
}
