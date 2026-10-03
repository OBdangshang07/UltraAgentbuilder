package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import dev.voxelstudio.selection.SelectionReadService;
import java.util.concurrent.CompletableFuture;
import java.util.function.*;

/** Both fences are owned by the integrated server, not receipt hashes. */
final class ContextPublication {
    static CompletableFuture<JsonObject> checked(Supplier<CompletableFuture<SelectionReadService.Capture>> current,Function<SelectionReadService.Capture,CompletableFuture<JsonObject>> transfer){
        return checkedValue(current,transfer);
    }
    static <T> CompletableFuture<T> checkedValue(Supplier<CompletableFuture<SelectionReadService.Capture>> current,Function<SelectionReadService.Capture,CompletableFuture<T>> transfer){
        return current.get().thenCompose(capture->transfer.apply(capture).thenCompose(saved->current.get().thenApply(after->{
            if(after!=capture)throw new IllegalStateException("传输后环境快照已改变；迟到结果不可发布");return saved;
        })));
    }
    private ContextPublication(){}
}
