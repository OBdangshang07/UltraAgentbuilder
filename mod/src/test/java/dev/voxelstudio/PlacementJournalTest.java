package dev.voxelstudio;

import com.google.gson.JsonParser;
import net.minecraft.server.MinecraftServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import static org.junit.jupiter.api.Assertions.*;

/** Disk-only lifecycle tests: no game world or player is created or modified. */
public class PlacementJournalTest {
    @TempDir Path directory;
    private static void set(Object task, String name, Object value) throws Exception {
        Field field = task.getClass().getDeclaredField(name); field.setAccessible(true); field.set(task, value);
    }
    @SuppressWarnings("unchecked")
    private static Map<MinecraftServer,Object> tasks() throws Exception {
        Field field = PlacementService.class.getDeclaredField("TASKS"); field.setAccessible(true);
        return (Map<MinecraftServer,Object>)field.get(null);
    }
    private Object task() throws Exception {
        Constructor<?> ctor = Class.forName("dev.voxelstudio.PlacementService$Task").getDeclaredConstructor(); ctor.setAccessible(true);
        Object task = ctor.newInstance(); set(task, "dir", directory); return task;
    }
    private static Object entry(long pos) throws Exception {
        Constructor<?> ctor = Class.forName("dev.voxelstudio.PlacementService$Entry").getDeclaredConstructor(long.class,String.class,String.class); ctor.setAccessible(true);
        return ctor.newInstance(pos,"minecraft:air","minecraft:stone");
    }
    @Test void normalShutdownReceiptsOnlyTheAppliedPrefix() throws Exception {
        Object task = task(), first = entry(1), second = entry(2);
        set(task,"pending",List.of(first,second)); set(task,"pendingApplied",List.of(first));
        set(task,"disk",CompletableFuture.completedFuture(null)); tasks().put(null,task);
        try {
            PlacementService.stopping(null);
            var receipt = JsonParser.parseString(Files.readString(directory.resolve("000000.applied.json"))).getAsJsonArray();
            assertEquals(1,receipt.size()); assertEquals(1,receipt.get(0).getAsJsonObject().get("pos").getAsLong());
            assertFalse(tasks().containsKey(null));
        } finally { tasks().remove(null); }
    }
    @Test void normalShutdownDoesNotOverwriteACommittedReceipt() throws Exception {
        Path receipt=directory.resolve("000000.applied.json"); Files.writeString(receipt,"[]");
        Object task=task(); set(task,"pending",List.of(entry(1))); set(task,"pendingApplied",List.of(entry(1)));
        set(task,"awaitingCommit",true); set(task,"disk",CompletableFuture.completedFuture(null)); tasks().put(null,task);
        try { PlacementService.stopping(null); assertEquals("[]",Files.readString(receipt)); }
        finally { tasks().remove(null); }
    }
}
