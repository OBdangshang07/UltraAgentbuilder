package dev.voxelstudio;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;
class JournalRecoveryTest {
    @TempDir Path dir;
    String entry(long n){return "{\"pos\":"+n+",\"before\":\"minecraft:air\",\"after\":\"minecraft:stone\"}";}
    @BeforeEach void metadata()throws Exception{Files.writeString(dir.resolve("metadata.json"),"{\"player\":\"fixture\",\"dimension\":\"minecraft:overworld\"}");}
    @Test void intentOnlyIsAmbiguousAndPreserved()throws Exception{String text="["+entry(1)+"]";Files.writeString(dir.resolve("000000.intent.json"),text);var r=JournalRecovery.inspect(dir);assertTrue(r.needsReview());assertEquals(1,r.missingReceipts());assertEquals(0,r.entries().size());assertEquals(text,Files.readString(dir.resolve("000000.intent.json")));}
    @Test void recordedPartialPrefixIsRecognizedButNotAssumedWorldDurable()throws Exception{Files.writeString(dir.resolve("000000.intent.json"),"["+entry(1)+","+entry(2)+"]");Files.writeString(dir.resolve("000000.applied.json"),"["+entry(1)+"]");var r=JournalRecovery.inspect(dir);assertFalse(r.needsReview());assertEquals(1,r.entries().size());assertFalse(r.undone());}
    @Test void mismatchedReceiptRequiresReview()throws Exception{Files.writeString(dir.resolve("000000.intent.json"),"["+entry(1)+"]");Files.writeString(dir.resolve("000000.applied.json"),"["+entry(2)+"]");assertTrue(JournalRecovery.inspect(dir).needsReview());}
    @Test void corruptedReceiptRequiresReviewWithoutDeletingIt()throws Exception{Files.writeString(dir.resolve("000000.intent.json"),"["+entry(1)+"]");Files.writeString(dir.resolve("000000.applied.json"),"{");assertTrue(JournalRecovery.inspect(dir).needsReview());assertEquals("{",Files.readString(dir.resolve("000000.applied.json")));}
    @Test void orphanReceiptRequiresReview()throws Exception{Files.writeString(dir.resolve("000000.applied.json"),"[]");assertTrue(JournalRecovery.inspect(dir).needsReview());}
    @Test void duplicatePositionsAcrossBatchesAreRejected()throws Exception{for(int i=0;i<2;i++){Files.writeString(dir.resolve("00000"+i+".intent.json"),"["+entry(1)+"]");Files.writeString(dir.resolve("00000"+i+".applied.json"),"["+entry(1)+"]");}assertTrue(JournalRecovery.inspect(dir).needsReview());}
}
