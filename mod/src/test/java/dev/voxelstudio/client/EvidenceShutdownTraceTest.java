package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class EvidenceShutdownTraceTest {
    @Test void controlledSuccessIsOnlyAnObservationNotAnAcceptance() {
        var trace = new EvidenceShutdownTrace();
        trace.controlled(EvidenceShutdownTrace.Controlled.RESULT_WRITTEN);
        var request = trace.observe(false, false, false, false, null);
        assertEquals("result_written", request.get("controlledReceipt").getAsString());
        assertFalse(request.get("priorScheduleStopObserved").getAsBoolean());
        assertFalse(request.get("renderingPassed").getAsBoolean());
        assertFalse(request.get("canAuthorizePlacement").getAsBoolean());
        assertFalse(request.get("shutdownCauseVerified").getAsBoolean());
        assertTrue(trace.observe(true, false, false, false, null).get("priorScheduleStopObserved").getAsBoolean());
    }
    @Test void windowCloseFlagDoesNotProveWhoClosedItOrLifetimeWorldState() {
        var event = new EvidenceShutdownTrace().observe(false, true, true, true, null);
        assertTrue(event.get("windowCloseFlagAtObservation").getAsBoolean());
        assertTrue(event.get("worldPresentAtObservation").getAsBoolean());
        assertTrue(event.get("serverPresentAtObservation").getAsBoolean());
        assertFalse(event.get("lifetimeWorldStateVerified").getAsBoolean());
        assertEquals("none", event.get("controlledReceipt").getAsString());
    }
    @Test void lifecycleWithoutRequestAndControlledFailureRemainDistinct() {
        var trace = new EvidenceShutdownTrace();
        var first = trace.observe(true, false, false, false, null);
        assertEquals("client-stopping", first.get("event").getAsString());
        assertFalse(first.get("priorScheduleStopObserved").getAsBoolean());
        trace.controlled(EvidenceShutdownTrace.Controlled.FAILURE_WRITTEN);
        assertEquals("failure_written", trace.observe(false, false, false, false, null).get("controlledReceipt").getAsString());
    }
    @Test void repeatedRequestsAreBoundedWithOneFinalLifecycleSlot() {
        var trace = new EvidenceShutdownTrace();
        for (int i = 0; i < 3; i++) assertEquals(i, trace.observe(false, false, false, false, null).get("sequence").getAsInt());
        assertNull(trace.observe(false, false, false, false, null));
        assertEquals(3, trace.observe(true, false, false, false, null).get("sequence").getAsInt());
        assertNull(trace.observe(true, false, false, false, null));
    }
    @Test void stackContainsOnlyBoundedClassAndMethodNames() {
        var frames = new StackTraceElement[30];
        frames[0] = new StackTraceElement("net.minecraft.client.MinecraftClient", "scheduleStop", "private-file", 987);
        frames[1] = new StackTraceElement("untrusted.mod.Private", "stop", "secret", 4);
        frames[2] = new StackTraceElement("dev.voxelstudio.client.Test", "bad/path", "secret", 4);
        frames[3] = new StackTraceElement("java.lang.Test$$Lambda$123/0x123", "run", "secret", 4);
        for (int i = 4; i < frames.length; i++) frames[i] = frames[0];
        var result = new EvidenceShutdownTrace().observe(false, false, false, false, frames);
        var saved = result.getAsJsonArray("frames"); assertEquals(16, saved.size());
        assertEquals("scheduleStop", saved.get(0).getAsJsonObject().get("method").getAsString());
        for (int i = 1; i < 4; i++) assertEquals("redacted", saved.get(i).getAsJsonObject().get("class").getAsString());
        assertFalse(result.toString().contains("private-file"));
        assertFalse(result.toString().contains("secret"));
        assertFalse(result.toString().contains("987"));
    }
}
