package dev.voxelstudio.client;

/** Render-thread operation identity, not network or storage authority.
 * Closing invalidates results but does not manufacture a completed outcome.
 * A late callback may release only the operation that actually owns busy. */
final class ReferenceArchiveUiOperation {
    record Completion(boolean released,boolean current){}
    private volatile long epoch,ticket=-1;
    boolean busy(){return ticket>=0;}
    long begin(){if(busy())throw new IllegalStateException("Original query still running");return ticket=++epoch;}
    void invalidate(){epoch++;}
    boolean current(long original){return original==ticket&&original==epoch;}
    Completion finish(long original){
        if(original!=ticket)return new Completion(false,false);
        ticket=-1;return new Completion(true,original==epoch);
    }
}
