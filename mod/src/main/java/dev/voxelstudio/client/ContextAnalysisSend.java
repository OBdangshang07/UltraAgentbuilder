package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import java.util.concurrent.*;
import java.util.function.*;

/** One local claim before any dispatch. Failure never falls back to sending.
 * The HTTP lane independently checks the same live gate immediately before
 * exchange; this coordinator cannot cancel a call already dispatched. */
final class ContextAnalysisSend {
    static void allowed(BooleanSupplier live){if(!live.getAsBoolean())throw new CancellationException("分析发送页已关闭或任务失效；不会补发");}
    static CompletableFuture<JsonObject> once(BooleanSupplier live,Supplier<CompletableFuture<Boolean>> claim,
            Supplier<CompletableFuture<Void>> recheck,Supplier<CompletableFuture<JsonObject>> dispatch,Supplier<CompletableFuture<JsonObject>> query){
        try{allowed(live);return claim.get().thenCompose(fresh->{
            if(!fresh)return query.get();
            allowed(live);return recheck.get().thenCompose(ignored->{allowed(live);return dispatch.get();});
        });}catch(Exception error){return CompletableFuture.failedFuture(error);}
    }
    private ContextAnalysisSend(){}
}
