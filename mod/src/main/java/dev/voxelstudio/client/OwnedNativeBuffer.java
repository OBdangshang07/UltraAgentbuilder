package dev.voxelstudio.client;

import java.util.Objects;
import java.util.function.Consumer;

/** One writer owns the arena; queued/active consumers retain independent leases.
 * Cancellation retires the writer, not memory that an upload may still read. */
final class OwnedNativeBuffer<T> implements AutoCloseable {
    private T resource;
    private final Consumer<T> dispose;
    private int references=1;
    private boolean retired;

    OwnedNativeBuffer(T resource,Consumer<T> dispose) {
        this.resource=Objects.requireNonNull(resource);
        this.dispose=Objects.requireNonNull(dispose);
    }
    synchronized T resource() {
        if(retired)throw new IllegalStateException("Native writer is retired");
        return resource;
    }
    synchronized Lease retain() {
        if(retired)throw new IllegalStateException("Native writer is retired");
        if(references==Integer.MAX_VALUE)throw new IllegalStateException("Native lease overflow");
        Lease lease=new Lease();references++;return lease;
    }
    @Override public void close() {
        T release;
        synchronized(this) {
            if(retired)return;
            retired=true;release=releaseReference();
        }
        if(release!=null)dispose.accept(release);
    }
    /** Caller holds this monitor. Detach before disposal: even a failed free
     * is never retried against a possibly already released native pointer. */
    private T releaseReference() {
        if(references<=0)throw new IllegalStateException("Native lease underflow");
        if(--references!=0)return null;
        T release=resource;resource=null;return release;
    }
    final class Lease implements AutoCloseable {
        private boolean closed;
        @Override public void close() {
            T release;
            synchronized(OwnedNativeBuffer.this) {
                if(closed)return;
                closed=true;release=releaseReference();
            }
            if(release!=null)dispose.accept(release);
        }
    }
}
