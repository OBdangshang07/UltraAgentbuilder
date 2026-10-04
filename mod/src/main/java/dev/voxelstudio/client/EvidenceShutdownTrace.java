package dev.voxelstudio.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.Objects;

/** Bounded diagnostic observations, never a renderer result or world authority. */
final class EvidenceShutdownTrace {
    enum Controlled { NONE, RESULT_WRITTEN, FAILURE_WRITTEN }
    private int sequence;
    private boolean requestObserved;
    private Controlled controlled = Controlled.NONE;

    void controlled(Controlled value) { controlled = Objects.requireNonNull(value); }

    JsonObject observe(boolean stopping, boolean windowClose, boolean worldPresent,
                       boolean serverPresent, StackTraceElement[] stack) {
        // Reserve a separate final lifecycle event even if scheduleStop repeats.
        if ((!stopping && sequence >= 3) || sequence >= 4) return null;
        boolean priorRequest = requestObserved;
        if (!stopping) requestObserved = true;
        var value = new JsonObject();
        value.addProperty("type", "isolated-evidence-shutdown-observation");
        value.addProperty("version", 1);
        value.addProperty("sequence", sequence++);
        value.addProperty("event", stopping ? "client-stopping" : "schedule-stop");
        value.addProperty("priorScheduleStopObserved", priorRequest);
        value.addProperty("controlledReceipt", controlled.name().toLowerCase(java.util.Locale.ROOT));
        value.addProperty("windowCloseFlagAtObservation", windowClose);
        value.addProperty("worldPresentAtObservation", worldPresent);
        value.addProperty("serverPresentAtObservation", serverPresent);
        value.addProperty("lifetimeWorldStateVerified", false);
        value.addProperty("shutdownCauseVerified", false);
        value.addProperty("renderingPassed", false);
        value.addProperty("canAuthorizePlacement", false);
        var frames = new JsonArray();
        for (int i = 0; stack != null && i < Math.min(16, stack.length); i++) {
            var f = stack[i];
            if (f == null) continue;
            String cls = f.getClassName(), method = f.getMethodName();
            // No raw throwable, file, line, path, prompt or arbitrary mod label.
            boolean safe = cls.length() <= 160 && method.length() <= 100
                && cls.matches("(?:dev\\.voxelstudio\\.|net\\.minecraft\\.|net\\.fabricmc\\.|org\\.lwjgl\\.|java\\.lang\\.)[A-Za-z0-9_.$]+")
                && method.matches("[A-Za-z0-9_$<>]+")
                && !cls.contains("$$Lambda$");
            var frame = new JsonObject();
            frame.addProperty("class", safe ? cls : "redacted");
            frame.addProperty("method", safe ? method : "redacted");
            frames.add(frame);
        }
        value.add("frames", frames);
        return value;
    }
}
