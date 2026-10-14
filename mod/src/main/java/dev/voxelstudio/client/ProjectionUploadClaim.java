package dev.voxelstudio.client;

import java.util.concurrent.atomic.AtomicBoolean;

/** A thrown submission is not proof that its callback was never queued.
 * Exactly one side may consume the source or clean it without consumption. */
final class ProjectionUploadClaim {
    private final AtomicBoolean claimed=new AtomicBoolean();

    boolean beginConsumer() { return claimed.compareAndSet(false,true); }

    /** A callback that arrives after this succeeds must perform no source read. */
    boolean rejectBeforeConsumption() { return claimed.compareAndSet(false,true); }
}
