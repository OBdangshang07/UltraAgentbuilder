package dev.voxelstudio.client;

import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;

/** Development telemetry only. Never use for world journals or final receipts. */
final class SelfTestProgressWriter {
    @FunctionalInterface interface Move { void run(Path from, Path to) throws IOException; }
    @FunctionalInterface interface Wait { void run(long millis) throws InterruptedException; }
    record Publication(boolean latestUpdated, Path evidenceFile, int attempts, String warning) {}

    static Publication publish(Path latest, String contents) throws IOException, InterruptedException {
        return publish(latest, contents,
            (from,to)->Files.move(from,to,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE),
            Thread::sleep);
    }

    static Publication publish(Path latest, String contents, Move move, Wait wait) throws IOException, InterruptedException {
        if(!latest.getFileName().toString().matches("[a-f0-9]{32}\\.progress\\.json"))
            throw new IllegalArgumentException("Only isolated progress telemetry is supported");
        // A unique complete snapshot survives even if a Windows reader denies
        // replacement of the latest pointer. Never truncate the readable file.
        Path pending=latest.resolveSibling(latest.getFileName()+".snapshot-"+UUID.randomUUID()+".json");
        Files.writeString(pending,contents,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
        for(int attempt=1;attempt<=3;attempt++) {
            try { move.run(pending,latest); return new Publication(true,latest,attempt,null); }
            catch(AccessDeniedException denied) {
                if(attempt==3)return new Publication(false,pending,attempt,denied.toString());
                wait.run(25L*attempt);
            }
        }
        throw new AssertionError("Unreachable progress publication state");
    }
}
