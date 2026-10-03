package dev.voxelstudio.client;

import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.*;
import java.util.Set;
import java.util.concurrent.*;

/** User-selected local file only. Single bounded lane; no file picker window,
 * URLs, directory scans, disk cache, network/model calls or game rendering. */
final class ReferenceImageIO {
    private static final ExecutorService IO=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(2),r->{var t=new Thread(r,"voxel-reference-pixels");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    static <T> CompletableFuture<T> work(Callable<T> action){
        var result=new CompletableFuture<T>();var task=new FutureTask<Void>(()->{try{result.complete(action.call());}catch(Throwable e){result.completeExceptionally(e);}return null;});
        result.whenComplete((r,e)->{if(result.isCancelled())task.cancel(true);});
        try{IO.execute(task);}catch(RejectedExecutionException e){result.completeExceptionally(new IllegalStateException("图片处理通道忙，请稍后重试",e));}return result;
    }
    static ReferenceImageDraft.Source read(String selectedPath)throws Exception {
        if(selectedPath==null||selectedPath.length()>2048)throw new IllegalArgumentException("请选择本机 PNG/JPEG 文件的绝对路径");
        String entered=selectedPath.trim();if(entered.length()>=2&&entered.startsWith("\"")&&entered.endsWith("\""))entered=entered.substring(1,entered.length()-1);
        Path path=Path.of(entered);
        if(!path.isAbsolute()||entered.startsWith("\\\\")||entered.startsWith("//")||entered.contains("://"))throw new IllegalArgumentException("仅支持本机绝对文件路径，不读取 URL 或网络共享");
        path=path.normalize();if(!path.toRealPath().equals(path)||!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS))throw new IllegalArgumentException("参考图必须是本机普通文件，不能是链接或目录");
        byte[] bytes;
        try(SeekableByteChannel input=Files.newByteChannel(path,Set.of(StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS))){
            long count=input.size();if(count<8||count>ReferenceImageNormalizer.MAX_SOURCE_BYTES)throw new IllegalArgumentException("源图应为 PNG/JPEG，且不超过 32 MiB");
            var buffer=ByteBuffer.allocate((int)count);while(buffer.hasRemaining()){if(Thread.currentThread().isInterrupted())throw new CancellationException("图片读取已取消");if(input.read(buffer)<0)throw new IllegalStateException("参考图在读取期间被截断");}
            if(input.read(ByteBuffer.allocate(1))!=-1||input.size()!=count)throw new IllegalStateException("参考图在读取期间改变；请重新选择");bytes=buffer.array();
        }
        return new ReferenceImageDraft.Source(bytes);
    }
    private ReferenceImageIO(){}
}
