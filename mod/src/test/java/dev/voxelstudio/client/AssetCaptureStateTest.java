package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AssetCaptureStateTest {
    private static final class Fake implements AssetCaptureState.Access {
        final List<String> calls = new ArrayList<>();
        final Map<String, RuntimeException> failures = new HashMap<>();
        int draw=13, read=17;
        int[] viewport={5,7,800,600}, box={11,19,64,77};
        boolean enabled, cachedEnabled;
        int drawState=42;
        Fake(boolean enabled) { this.enabled=enabled; cachedEnabled=enabled; }
        @Override public AssetCaptureState.Snapshot snapshot() {
            calls.add("snapshot");
            return new AssetCaptureState.Snapshot(draw,read,viewport,enabled,box);
        }
        @Override public Runnable captureDrawState() {
            calls.add("captureDrawState");int before=drawState;
            return () -> { run("drawState");drawState=before; };
        }
        private void run(String key) { calls.add(key);if(failures.containsKey(key))throw failures.get(key); }
        @Override public void framebuffers(int draw,int read) { run("framebuffers");this.draw=draw;this.read=read; }
        @Override public void viewport(int[] value) { run("viewport");viewport=value.clone(); }
        @Override public void scissor(boolean value,int[] box) {
            run("scissor");this.box=box.clone();
            if(cachedEnabled!=value){cachedEnabled=value;enabled=value;}
        }
        void mutateForCapture() {
            draw=91;read=92;viewport=new int[]{0,0,512,512};box=new int[]{1,2,30,40};
            enabled=false;cachedEnabled=false;drawState=99;
        }
        void disableNext() { if(cachedEnabled){cachedEnabled=false;enabled=false;} }
        void enableNext() { if(!cachedEnabled){cachedEnabled=true;enabled=true;} }
    }
    @Test void restoresEnabledScissorAndItsCacheForTheNextGuiDisable() {
        var graphics=new Fake(true);
        try(var state=new AssetCaptureState(graphics)){graphics.mutateForCapture();}
        assertTrue(graphics.enabled);assertTrue(graphics.cachedEnabled);
        assertArrayEquals(new int[]{11,19,64,77},graphics.box);
        graphics.disableNext();assertFalse(graphics.enabled);
    }
    @Test void restoresDisabledScissorBoxAndAllowsTheNextEnable() {
        var graphics=new Fake(false);
        try(var state=new AssetCaptureState(graphics)){graphics.mutateForCapture();}
        assertFalse(graphics.enabled);assertFalse(graphics.cachedEnabled);
        assertArrayEquals(new int[]{11,19,64,77},graphics.box);
        graphics.enableNext();assertTrue(graphics.enabled);
    }
    @Test void callerStateIsSavedBeforeFramebufferConstructionMutatesIt() {
        var graphics=new Fake(true);
        try(var state=new AssetCaptureState(graphics)){graphics.mutateForCapture();}
        assertEquals(13,graphics.draw);assertEquals(17,graphics.read);assertEquals(42,graphics.drawState);
        assertArrayEquals(new int[]{5,7,800,600},graphics.viewport);
        assertEquals(List.of("snapshot","captureDrawState","drawState","framebuffers","viewport","scissor"),graphics.calls);
    }
    @Test void allocationFailureStillRestoresCallerState() {
        var graphics=new Fake(true);var allocation=new IllegalStateException("synthetic allocation failure");
        assertSame(allocation,assertThrows(IllegalStateException.class,()->{
            try(var state=new AssetCaptureState(graphics)){graphics.mutateForCapture();throw allocation;}
        }));
        assertEquals(13,graphics.draw);assertEquals(17,graphics.read);assertTrue(graphics.enabled);
    }
    @Test void deletionFailureStillClosesTheOuterScope() {
        var graphics=new Fake(true);var deletion=new IllegalStateException("synthetic delete failure");
        assertSame(deletion,assertThrows(IllegalStateException.class,()->{
            try(var state=new AssetCaptureState(graphics)){
                try(AutoCloseable framebuffer=()->{throw deletion;}){graphics.mutateForCapture();}
            }
        }));
        assertEquals(42,graphics.drawState);assertArrayEquals(new int[]{5,7,800,600},graphics.viewport);
        assertTrue(graphics.enabled);
    }
    @Test void captureAndDeletionFailureKeepOriginalAndSuppressBothCleanupFailures() {
        var graphics=new Fake(true);var original=new IllegalStateException("synthetic capture failure");
        var deletion=new IllegalStateException("synthetic delete failure");
        var restoration=new IllegalStateException("synthetic state restore failure");
        graphics.failures.put("drawState",restoration);
        assertSame(original,assertThrows(IllegalStateException.class,()->{
            try(var state=new AssetCaptureState(graphics)){
                try(AutoCloseable framebuffer=()->{throw deletion;}){
                    graphics.mutateForCapture();throw original;
                }
            }
        }));
        assertArrayEquals(new Throwable[]{deletion,restoration},original.getSuppressed());
        assertEquals(13,graphics.draw);assertEquals(17,graphics.read);
        assertArrayEquals(new int[]{5,7,800,600},graphics.viewport);assertTrue(graphics.enabled);
    }
    @Test void attemptsEveryRestorationAndPreservesFirstCleanupError() {
        var graphics=new Fake(true);var first=new IllegalStateException("synthetic draw restoration");
        var second=new IllegalStateException("synthetic framebuffer restoration");
        graphics.failures.put("drawState",first);graphics.failures.put("framebuffers",second);
        var state=new AssetCaptureState(graphics);graphics.mutateForCapture();
        assertSame(first,assertThrows(IllegalStateException.class,state::close));
        assertArrayEquals(new Throwable[]{second},first.getSuppressed());
        assertArrayEquals(new int[]{5,7,800,600},graphics.viewport);assertTrue(graphics.enabled);
    }
    @Test void originalCaptureErrorIsNotReplacedByCleanupError() {
        var graphics=new Fake(true);var original=new IllegalStateException("synthetic readback");
        var cleanup=new IllegalStateException("synthetic cleanup");graphics.failures.put("drawState",cleanup);
        assertSame(original,assertThrows(IllegalStateException.class,()->{
            try(var state=new AssetCaptureState(graphics)){graphics.mutateForCapture();throw original;}
        }));
        assertArrayEquals(new Throwable[]{cleanup},original.getSuppressed());assertTrue(graphics.enabled);
    }
    @Test void closeDoesNotRepeatRestorations() {
        var graphics=new Fake(false);var state=new AssetCaptureState(graphics);graphics.mutateForCapture();
        state.close();var calls=List.copyOf(graphics.calls);state.close();assertEquals(calls,graphics.calls);
    }
    @Test void nestedScopesRestoreTheirOwnStatesWithoutLeakingTheInnerBox() {
        var graphics=new Fake(true);
        try(var outer=new AssetCaptureState(graphics)){
            graphics.mutateForCapture();
            try(var inner=new AssetCaptureState(graphics)){graphics.draw=104;graphics.box=new int[]{4,5,8,9};}
            assertEquals(91,graphics.draw);assertFalse(graphics.enabled);
            assertArrayEquals(new int[]{1,2,30,40},graphics.box);
        }
        assertEquals(13,graphics.draw);assertTrue(graphics.enabled);
    }
    @Test void snapshotDefensivelyCopiesBothFourComponentVectors() {
        int[] viewport={1,2,3,4},box={5,6,7,8};
        var snapshot=new AssetCaptureState.Snapshot(1,2,viewport,true,box);
        viewport[0]=99;box[0]=99;snapshot.viewport()[1]=99;snapshot.scissorBox()[1]=99;
        assertArrayEquals(new int[]{1,2,3,4},snapshot.viewport());
        assertArrayEquals(new int[]{5,6,7,8},snapshot.scissorBox());
    }
    @Test void malformedSnapshotsAreRejected() {
        assertThrows(IllegalArgumentException.class,()->new AssetCaptureState.Snapshot(1,2,new int[3],false,new int[4]));
        assertThrows(IllegalArgumentException.class,()->new AssetCaptureState.Snapshot(1,2,new int[4],false,new int[5]));
    }
}
