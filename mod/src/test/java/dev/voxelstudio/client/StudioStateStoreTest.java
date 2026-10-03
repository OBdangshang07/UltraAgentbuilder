package dev.voxelstudio.client;
import com.google.gson.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
class StudioStateStoreTest {
    @TempDir Path dir;
    JsonObject draft(String world){return JsonParser.parseString("{\"world\":\""+world+"\",\"job\":\"11111111-1111-1111-1111-111111111111\",\"hash\":\""+"a".repeat(64)+"\",\"x\":-12,\"y\":64,\"z\":0,\"rotation\":1,\"mirror\":true}").getAsJsonObject();}
    @Test void sameNamedWorldsAndDimensionsRemainSeparate()throws Exception{var s=new StudioStateStore(dir.resolve("中文 路径"));for(String scope:new String[]{"/a/world|overworld","/b/world|overworld","/a/world|nether"}){s.saveDraft(draft(scope)).get();assertEquals(scope,s.draft(scope,dir.resolve("missing")).get().get("world").getAsString());}}
    @Test void legacyMatchingDraftIsReadWithoutDeletingOriginal()throws Exception{var s=new StudioStateStore(dir);Path legacy=dir.resolve("legacy.json");String text=draft("world|overworld").toString();Files.writeString(legacy,text);var d=s.draft("world|overworld",legacy).get();assertTrue(d.get("legacy").getAsBoolean());s.saveDraft(d).get();assertEquals(text,Files.readString(legacy));assertThrows(ExecutionException.class,()->s.draft("other",legacy).get());}
    @Test void corruptionAndDiskFailureAreVisible()throws Exception{var s=new StudioStateStore(dir);Files.writeString(dir.resolve("active-task.json"),"{");assertThrows(ExecutionException.class,()->s.task().get());Path blocker=dir.resolve("blocked");Files.writeString(blocker,"not a directory");var bad=new StudioStateStore(blocker);assertThrows(ExecutionException.class,()->bad.saveDraft(draft("world")).get());}
    @Test void taskIdentitySurvivesRestartAndArchiveIsNonDestructive()throws Exception{var s=new StudioStateStore(dir);var task=new JsonObject();task.addProperty("key","stable-key");task.addProperty("state","submitting");s.task(task).get();assertEquals("stable-key",new StudioStateStore(dir).task().get().get("key").getAsString());s.archiveTask(task).get();assertEquals("archived-unknown",s.task().get().get("state").getAsString());try(var files=Files.list(dir.resolve("task-archive"))){assertEquals(1,files.count());}}
    @Test void futureSchemaIsRejectedAndPreserved()throws Exception{Files.writeString(dir.resolve("active-task.json"),"{\"schemaVersion\":99}");assertThrows(ExecutionException.class,()->new StudioStateStore(dir).task().get());assertTrue(Files.readString(dir.resolve("active-task.json")).contains("99"));}
}
