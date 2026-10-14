package dev.voxelstudio.client;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.function.BooleanSupplier;

/** One render-thread ownership transfer. Failed uploads are not successful meshes. */
final class ProjectionMeshUpload {
    interface Access<T> {
        T create();
        void bind(T resource);
        /** Consumes/releases the built CPU buffer even when upload throws. */
        void upload(T resource);
        void unbind();
        /** Transfers GPU ownership only on successful return. */
        void publish(T resource);
        void dispose(T resource);
        void releaseSource();
    }

    /** Native storage is retained until the actual consumer has stopped, not
     * merely until the publication future completes or is cancelled. */
    static <T> void executeRetained(CompletableFuture<Void> completion,CompletableFuture<Void> consumed,
                                   BooleanSupplier current,Access<T> access,Runnable releaseLease) {
        Objects.requireNonNull(consumed);Objects.requireNonNull(releaseLease);
        Throwable failure=null;
        try { execute(completion,current,access); }
        catch(RuntimeException | Error original) { failure=original; }
        if(failure==null&&completion.isCompletedExceptionally()&&!completion.isCancelled()) {
            try { completion.join(); } catch(CompletionException original) { failure=original.getCause(); }
        }
        try { releaseLease.run(); }
        catch(RuntimeException | Error cleanup) { failure=append(failure,cleanup); }
        if(failure==null)consumed.complete(null);
        else {
            consumed.completeExceptionally(failure);
            // A timed-out writer no longer observes this receipt. Preserve
            // the existing client-executor reporting policy for late errors.
            if(completion.isCancelled()) {
                if(failure instanceof RuntimeException runtime)throw runtime;
                if(failure instanceof Error fatal)throw fatal;
                throw new CompletionException(failure);
            }
        }
    }

    static <T> void execute(CompletableFuture<Void> completion,BooleanSupplier current,Access<T> access) {
        Objects.requireNonNull(completion);Objects.requireNonNull(current);Objects.requireNonNull(access);
        T resource=null;boolean consumed=false,published=false;Throwable failure=null;
        try {
            if (!completion.isDone()&&current.getAsBoolean()) {
                resource=Objects.requireNonNull(access.create());
                access.bind(resource);
                consumed=true;
                access.upload(resource);
            }
        } catch (RuntimeException | Error error) { failure=error; }
        if (resource!=null) {
            try { access.unbind(); }
            catch (RuntimeException | Error error) { failure=append(failure,error); }
            if (failure==null) {
                try {
                    synchronized(completion) {
                        if (!completion.isDone()&&current.getAsBoolean()) {
                            access.publish(resource);published=true;completion.complete(null);
                        }
                    }
                } catch (RuntimeException | Error error) { failure=error; }
            }
            if (!published) {
                try { access.dispose(resource); }
                catch (RuntimeException | Error error) { failure=append(failure,error); }
            }
        }
        if (!consumed) {
            try { access.releaseSource(); }
            catch (RuntimeException | Error error) { failure=append(failure,error); }
        }
        if (failure==null) completion.complete(null);
        else if (!completion.completeExceptionally(failure)) {
            // A timed-out/cancelled waiter cannot receive a later cleanup error.
            // Let the client executor report it instead of silently losing it.
            if (failure instanceof RuntimeException error) throw error;
            throw (Error)failure;
        }
    }

    static void abandon(CompletableFuture<Void> completion) {
        // Share the publication fence: after this returns cancelled, no later
        // publication can slip between the readiness check and ownership move.
        synchronized(completion) { completion.cancel(false); }
    }

    private static Throwable append(Throwable first,Throwable next) {
        if(first==null)return next;if(first!=next)first.addSuppressed(next);return first;
    }
    static String describe(Throwable error) {
        while ((error instanceof ExecutionException||error instanceof CompletionException)&&error.getCause()!=null)error=error.getCause();
        String message=error.getMessage();return error.getClass().getSimpleName()+(message==null||message.isBlank()?"":": "+message);
    }
}
