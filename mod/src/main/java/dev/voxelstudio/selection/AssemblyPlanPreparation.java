package dev.voxelstudio.selection;

import java.util.Objects;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.*;

/** CPU-only, read-only preparation lifetime. Not a journal receipt or consent.
 * Cancellation revokes the result immediately, but closure is acknowledged
 * only by the original runnable's finally block, never Future.cancel(). */
final class AssemblyPlanPreparation<T> {
    static final long BUDGET_NANOS=180_000_000_000L;
    private final LongSupplier clock;
    private final long started;
    private final AtomicBoolean abandoned=new AtomicBoolean();
    private final CompletableFuture<T> outcome=new CompletableFuture<>();
    private volatile boolean closed;

    private AssemblyPlanPreparation(LongSupplier clock){this.clock=Objects.requireNonNull(clock);started=clock.getAsLong();}
    static <T> AssemblyPlanPreparation<T> start(Executor executor,LongSupplier clock,Function<BooleanSupplier,T> work){
        Objects.requireNonNull(executor);Objects.requireNonNull(work);var task=new AssemblyPlanPreparation<T>(clock);
        try{executor.execute(()->{
            try{task.check();var value=Objects.requireNonNull(work.apply(task::cancelled));task.check();task.outcome.complete(value);}
            catch(Throwable error){task.outcome.completeExceptionally(error);}
            finally{task.closed=true;}
        });}catch(RuntimeException error){task.closed=true;task.outcome.completeExceptionally(error);throw error;}
        return task;
    }
    private boolean cancelled(){return abandoned.get()||clock.getAsLong()-started>=BUDGET_NANOS;}
    void check(){
        if(abandoned.get())throw new CancellationException("原始方案准备已取消；迟到结果不得恢复确认");
        if(clock.getAsLong()-started>=BUDGET_NANOS)throw new IllegalStateException("原始方案 CPU 准备超过 180 秒；不重发");
    }
    void cancel(){abandoned.set(true);}
    boolean closed(){return closed;}
    T value(){check();if(!closed)throw new IllegalStateException("原始 CPU 准备尚未封闭");return outcome.join();}
}
