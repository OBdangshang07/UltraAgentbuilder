package dev.voxelstudio.selection;

import com.google.gson.*;
import dev.voxelstudio.WorldChangeTracker;
import net.minecraft.block.BlockState;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Integrated-host, read-only service. Live world access stays on the server
 * thread; sealed capture serialization stays on a bounded worker. No write,
 * load, generate, NBT, container, entity or model API exists here. */
public final class SelectionReadService {
    public enum State { QUEUED,READING,FINALIZING,READY,CANCELLED,STALE,UNSTABLE,FAILED }
    public record Status(State state,String reason,SelectionScan.Progress scan) {}
    public record Capture(String id,WorldSelection selection,long contextRevision,String payload,SelectionTimings.Result scanTimings,boolean canAuthorizePlacement) {
        public Capture { if(canAuthorizePlacement)throw new IllegalArgumentException("Read-only capture cannot grant placement"); }
    }
    /** Immutable pins from the independently checked original explicit SEND,
     * not a downloaded candidate/status. Retention confers NO write authority. */
    public record PatchSendBinding(String contextId,String snapshotHash,String selectionHash,long contextRevision,String capsuleId,String manifestHash,String submissionHash,String runtimeHash,String protocolHash){
        public PatchSendBinding{
            if(contextId==null||!contextId.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")||contextRevision<0||contextRevision>9007199254740991L)throw new IllegalArgumentException("原发送快照身份无效");
            for(var hash:new String[]{snapshotHash,selectionHash,capsuleId,manifestHash,submissionHash,runtimeHash,protocolHash})if(hash==null||!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("原发送保留 hash 无效");
        }
        public boolean canAuthorizePlacement(){return false;}
    }
    public interface PatchRetention {
        CompletableFuture<Void> checkedBeforeDispatch();
        /** Called on the HTTP lane immediately before the one original exchange.
         * From here onwards transport errors are unknown, never proof of no call. */
        void markDispatchAttempted();
        void releaseIfNotDispatched();
        default boolean canAuthorizePlacement(){return false;}
    }
    public static final class Handle {
        private final String id=UUID.randomUUID().toString();
        private final CompletableFuture<Capture> result=new CompletableFuture<>();
        private volatile Status status=new Status(State.QUEUED,"等待读取",null);
        public String id(){return id;}
        public CompletableFuture<Capture> result(){return result;}
        public Status status(){return status;}
    }
    public record BeforeStatus(WorldPatchBeforeCheck.State state,String reason,WorldPatchBeforeCheck.Progress progress) {}
    /** A read-only observation. Do not persist/use it as a write token; callers
     * must revalidate the live task and separately obtain explicit write consent. */
    public record BeforeReport(String id,Capture original,WorldPatchBeforeCheck.Result comparison) {
        public boolean canAuthorizePlacement(){return false;}
    }
    public static final class BeforeHandle {
        private final String id=UUID.randomUUID().toString();
        private final CompletableFuture<BeforeReport> result=new CompletableFuture<>();
        private volatile BeforeStatus status=new BeforeStatus(WorldPatchBeforeCheck.State.CHECKING,"后台绑定原服务器 BEFORE",null);
        public String id(){return id;}
        public CompletableFuture<BeforeReport> result(){return result;}
        public BeforeStatus status(){return status;}
    }
    public enum PatchAuditState { PREPARING,READY,CANCELLED,STALE,FAILED }
    public record PatchAuditStatus(PatchAuditState state,String reason) {}
    /** Static safety against ORIGINAL server facts, not fresh BEFORE, physics,
     * model-origin evidence or final write consent. Never a placement token. */
    public record PatchAuditReport(String id,WorldPatchPreview.Binding binding,String originalResponseHash,int writes,int guards){
        public boolean canAuthorizePlacement(){return false;}
        public boolean currentWorldVerified(){return false;}
        public boolean physicsVerified(){return false;}
    }
    public static final class PatchAuditHandle {
        private final String id=UUID.randomUUID().toString();
        private final CompletableFuture<PatchAuditReport> result=new CompletableFuture<>();
        private volatile PatchAuditStatus status=new PatchAuditStatus(PatchAuditState.PREPARING,"原服务器基线独立补丁核验");
        public String id(){return id;}public CompletableFuture<PatchAuditReport> result(){return result;}public PatchAuditStatus status(){return status;}
    }
    private static final Map<MinecraftServer,String> IDENTITIES=new WeakHashMap<>();
    private static final Map<MinecraftServer,Task> TASKS=new HashMap<>();
    private static final ExecutorService WORKER=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r->{var t=new Thread(r,"voxel-context-finalize");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final class Task {
        UUID player;ServerWorld world;WorldSelection selection;WorldChangeTracker.Watch watch;SelectionScan scan;Handle handle;
        long detachedRevision;CompletableFuture<Finalized> worker;Capture capture;SelectionBaseline baseline;SelectionCaptureLifetime<Capture> lifetime;BeforeTask before;PatchAudit audit;SelectionTimings timings=new SelectionTimings();
        final Map<BlockState,SelectionScan.BlockFact> states=new HashMap<>();
        final SelectionChunkFence chunks=new SelectionChunkFence();int observedRestart=-1;
    }
    private static final class BeforeTask {
        BeforeHandle handle;WorldPatchPreview preview;CompletableFuture<WorldPatchBeforeCheck.Plan> worker;WorldPatchBeforeCheck scan;BeforeReport report;volatile boolean cancelled;
    }
    private static final class PatchAudit {
        PatchAuditHandle handle;WorldPatchPreview preview;byte[] originalResponse;CompletableFuture<WorldPatchCompiler.Compiled> worker;WorldPatchCompiler.Compiled compiled;PatchAuditReport report;volatile boolean cancelled;
    }
    private record Finalized(String payload,SelectionTimings.Result timings,SelectionBaseline baseline) {}
    private static void onServer(MinecraftServer server) {if(!server.isOnThread())throw new IllegalStateException("World read requires server thread");}
    private static ServerPlayerEntity authorize(MinecraftServer server,UUID player) {
        onServer(server);
        if(server.isDedicated())throw new IllegalStateException("当前选区读取仅支持单人内置服务器");
        var p=server.getPlayerManager().getPlayer(player);
        if(p==null||!p.isCreative()||!server.isHost(p.getGameProfile()))throw new IllegalStateException("当前仅允许单人创造模式房主读取选区");
        return p;
    }
    private static WorldSelection.WorldIdentity identityNow(MinecraftServer server,ServerWorld world) {
        onServer(server);
        return new WorldSelection.WorldIdentity(IDENTITIES.computeIfAbsent(server,s->UUID.randomUUID().toString()),world.getRegistryKey().getValue().toString(),world.getBottomY(),world.getTopY());
    }
    public static CompletableFuture<WorldSelection.WorldIdentity> identity(MinecraftServer server,UUID player) {
        var result=new CompletableFuture<WorldSelection.WorldIdentity>();
        server.execute(()->{try{result.complete(identityNow(server,authorize(server,player).getServerWorld()));}catch(Exception e){result.completeExceptionally(e);}});
        return result;
    }
    public static Handle start(MinecraftServer server,UUID player,WorldSelection selection) {
        var handle=new Handle();
        handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancel(server,handle.id);});
        server.execute(()->{Task t=null;try{
            var world=authorize(server,player).getServerWorld();
            if(!identityNow(server,world).equals(selection.world()))throw new IllegalStateException("世界或维度身份已改变，重新选择");
            var r=selection.context();
            if(!world.getWorldBorder().contains(new BlockPos(r.min().x(),r.min().y(),r.min().z()))||!world.getWorldBorder().contains(new BlockPos(r.max().x()-1,r.max().y()-1,r.max().z()-1)))throw new IllegalStateException("选区超出世界边界");
            if(handle.result.isCancelled()){handle.status=new Status(State.CANCELLED,"读取已取消",null);return;}
            discard(server,State.CANCELLED,"读取被新选区替代");
            t=new Task();t.player=player;t.world=world;t.selection=selection;t.handle=handle;t.watch=WorldChangeTracker.watch(world,r);
            final Task active=t;
            var source=new SelectionScan.Source() {
                private WorldChunk cachedChunk;private int chunkX,chunkZ;private boolean cached;
                private SelectionScan.Identity lastIdentity;private final BlockPos.Mutable blockPosition=new BlockPos.Mutable();
                public void beginStep(){onServer(server);cached=false;cachedChunk=null;int restart=active.scan.progress().restarts();if(active.observedRestart!=restart){active.chunks.reset();active.observedRestart=restart;}}
                private WorldChunk chunk(int x,int z) {
                    onServer(server);
                    if(cached&&x==chunkX&&z==chunkZ)return cachedChunk;
                    // getWorldChunk uses an already-complete future (getNow),
                    // unlike getChunk(FULL,false), which can still wait.
                    var current=world.getChunkManager().getWorldChunk(x,z);if(!active.chunks.observe(x,z,current))throw new IllegalStateException("区块实例/覆盖已改变；变化事件尚未完成，拒绝混合快照");
                    chunkX=x;chunkZ=z;cached=true;return cachedChunk=current;
                }
                public SelectionScan.Identity identity(){
                    onServer(server);long revision=active.watch.revision();
                    if(lastIdentity==null||lastIdentity.contextRevision()!=revision){var id=active.selection.world();lastIdentity=new SelectionScan.Identity(id.worldId(),id.dimension(),active.selection.revision(),revision);}
                    return lastIdentity;
                }
                public boolean loaded(int x,int z){return chunk(x,z)!=null;}
                public SelectionScan.BlockFact read(SelectionRegion.Point p) {
                    var value=chunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));
                    if(value==null)throw new IllegalStateException("读取时区块已卸载");
                    var state=value.getBlockState(blockPosition.set(p.x(),p.y(),p.z()));
                    var fact=active.states.get(state);if(fact==null){fact=BlockStateFacts.read(state);if(active.states.size()<4096)active.states.put(state,fact);}return fact;
                }
            };
            t.scan=new SelectionScan(selection,source,4096,2000000,2,System::nanoTime);
            TASKS.put(server,t);handle.status=new Status(State.READING,"只读扫描，不加载未知区块",t.scan.progress());
        }catch(Exception e){if(t!=null&&t.watch!=null)t.watch.close();handle.status=new Status(State.FAILED,e.getMessage(),null);handle.result.completeExceptionally(e);}});
        return handle;
    }
    public static void cancel(MinecraftServer server,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.handle.id.equals(id))discard(server,State.CANCELLED,"读取已取消");});}
    public static CompletableFuture<Boolean> idle(MinecraftServer server,UUID player){var result=new CompletableFuture<Boolean>();server.execute(()->{try{authorize(server,player);var t=TASKS.get(server);if(t!=null&&!t.player.equals(player))throw new IllegalStateException("Cannot inspect another player's selection");result.complete(t==null);}catch(Exception e){result.completeExceptionally(e);}});return result;}
    /** UI calls this on every geometry revision, not on target-only changes. */
    public static void invalidate(MinecraftServer server,UUID player,long revision){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.player.equals(player)&&t.selection.revision()!=revision)discard(server,State.STALE,"选区已改变，旧快照失效");});}
    private static void current(MinecraftServer server,Task t) {
        if(authorize(server,t.player).getServerWorld()!=t.world||!identityNow(server,t.world).equals(t.selection.world()))throw new IllegalStateException("世界、维度或玩家身份已改变");
    }
    private static boolean chunkFenceCurrent(Task t){return t.chunks.stable(t.selection.chunks().size(),(x,z)->t.world.getChunkManager().getWorldChunk(x,z));}
    private static boolean expired(Task t){return t.lifetime==null||t.lifetime.expired(System.nanoTime());}
    private static Task checkedTask(MinecraftServer server,UUID player,String id,long revision) {
        onServer(server);var t=TASKS.get(server);
        if(t==null||!t.player.equals(player)||!t.handle.id.equals(id)||t.selection.revision()!=revision||t.handle.status.state()!=State.READY)throw new IllegalStateException("没有当前选区的有效快照");
        current(server,t);
        if(t.watch.revision()!=t.detachedRevision||!chunkFenceCurrent(t)||expired(t)){
            discard(server,State.STALE,"周围环境/区块覆盖已改变或原快照过期，需要重新读取");throw new IllegalStateException("周围环境/区块覆盖已改变或原快照过期，需要重新读取");
        }return t;
    }
    public static CompletableFuture<Capture> checkedCapture(MinecraftServer server,UUID player,String id,long revision) {
        var result=new CompletableFuture<Capture>();
        server.execute(()->{try{result.complete(checkedTask(server,player,id,revision).capture);}catch(Exception e){result.completeExceptionally(e);}});
        return result;
    }
    /** Acquire only after the local original reference has been durably claimed
     * and the player explicitly SENDs. The original baseline/watch/chunk fence
     * are never replaced or reread. One task per server bounds retained memory;
     * active generation is not artificially limited to five minutes. */
    public static CompletableFuture<PatchRetention> retainForPatchSend(MinecraftServer server,UUID player,Capture original,PatchSendBinding binding){
        Objects.requireNonNull(original);Objects.requireNonNull(binding);var result=new CompletableFuture<PatchRetention>();
        server.execute(()->{try{
            var t=checkedTask(server,player,original.id(),original.selection().revision());
            if(t.capture!=original||t.baseline==null||!binding.contextId().equals(original.id())||binding.contextRevision()!=original.contextRevision()||!binding.snapshotHash().equals(t.baseline.snapshotHash)||!binding.selectionHash().equals(t.baseline.selectionHash))throw new IllegalStateException("原 SEND 与服务器仍持有的同一快照不一致");
            var lifetime=t.lifetime;lifetime.reserve(original,player,binding,System.nanoTime());
            result.complete(new PatchRetention(){
                public CompletableFuture<Void> checkedBeforeDispatch(){
                    var checked=new CompletableFuture<Void>();server.execute(()->{try{
                        if(checkedTask(server,player,original.id(),original.selection().revision())!=t||t.capture!=original||t.lifetime!=lifetime)throw new IllegalStateException("原 SEND 保留已失效，不能重绑");
                        lifetime.beforeDispatch(original,player,binding,System.nanoTime());checked.complete(null);
                    }catch(Exception e){checked.completeExceptionally(e);}});return checked;
                }
                public void markDispatchAttempted(){lifetime.attempted(original,player,binding,System.nanoTime());}
                public void releaseIfNotDispatched(){lifetime.releaseIfNotDispatched(original,player,binding);}
            });
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    /** Background static reconstruction. The immutable downloaded proposal is
     * untrusted; facts and scope come exclusively from the owned Capture. */
    public static PatchAuditHandle startPatchAudit(MinecraftServer server,UUID player,Capture original,WorldPatchPreview preview,byte[] originalResponse,String originalResponseHash){
        Objects.requireNonNull(original);Objects.requireNonNull(preview);Objects.requireNonNull(originalResponse);
        if(originalResponse.length==0||originalResponse.length>SelectionLimits.snapshotBytes()||originalResponseHash==null||!originalResponseHash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("缺少有界原响应及独立 hash");
        final byte[] proposal=originalResponse.clone();var handle=new PatchAuditHandle();
        handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancelPatchAudit(server,handle.id);});
        server.execute(()->{try{
            if(handle.result.isCancelled()){handle.status=new PatchAuditStatus(PatchAuditState.CANCELLED,"补丁核验已取消");return;}
            var t=checkedTask(server,player,original.id(),original.selection().revision());if(t.capture!=original||t.baseline==null)throw new IllegalStateException("不能用替代 Capture 核验补丁");
            if(t.audit!=null)throw new IllegalStateException("原快照已有补丁核验；先显式取消，不隐式替换");
            var audit=new PatchAudit();audit.handle=handle;audit.preview=preview;audit.originalResponse=proposal;var baseline=t.baseline;
            audit.worker=CompletableFuture.supplyAsync(()->{
                var compiled=WorldPatchCompiler.read(baseline,proposal,preview.binding(),originalResponseHash,()->audit.cancelled);
                WorldPatchCompiler.verifyPreview(compiled,preview,preview.binding());WorldPatchJson.cancelled(()->audit.cancelled);return compiled;
            },WORKER);t.audit=audit;
        }catch(Exception error){handle.status=new PatchAuditStatus(PatchAuditState.FAILED,rootMessage(error));handle.result.completeExceptionally(error);}});return handle;
    }
    public static void cancelPatchAudit(MinecraftServer server,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.audit!=null&&t.audit.handle.id.equals(id))stopAudit(t,PatchAuditState.CANCELLED,"补丁核验已取消");});}
    public static CompletableFuture<PatchAuditReport> checkedPatchAuditReport(MinecraftServer server,UUID player,Capture original,String id,WorldPatchPreview.Binding binding){
        var result=new CompletableFuture<PatchAuditReport>();server.execute(()->{try{
            var t=checkedTask(server,player,original.id(),original.selection().revision());var audit=t.audit;
            if(t.capture!=original||audit==null||!audit.handle.id.equals(id)||audit.report==null||audit.compiled==null||audit.compiled.baseline()!=t.baseline||audit.handle.status.state()!=PatchAuditState.READY||!audit.preview.binding().equals(binding))throw new IllegalStateException("没有此原候选的当前补丁核验");
            result.complete(audit.report);
        }catch(Exception error){result.completeExceptionally(error);}});return result;
    }
    private static void tickAudit(MinecraftServer server,Task t){
        var audit=t.audit;if(audit==null||audit.report!=null||!audit.worker.isDone())return;
        try{var compiled=audit.worker.join();checkedTask(server,t.player,t.handle.id,t.selection.revision());
            if(compiled.baseline()!=t.baseline||audit.cancelled)throw new IllegalStateException("原补丁或服务器基线已失效");
            audit.compiled=compiled;audit.worker=null;audit.report=new PatchAuditReport(audit.handle.id,audit.preview.binding(),compiled.responseHash(),compiled.writes().size(),compiled.guards().size());
            audit.handle.status=new PatchAuditStatus(PatchAuditState.READY,"原基线静态补丁校验通过；仍需 fresh BEFORE 与独立写入确认");audit.handle.result.complete(audit.report);
        }catch(Exception error){stopAudit(t,PatchAuditState.FAILED,rootMessage(error));}
    }
    private static void stopAudit(Task t,PatchAuditState state,String reason){
        var audit=t.audit;t.audit=null;if(audit==null)return;audit.cancelled=true;if(audit.worker!=null)audit.worker.cancel(false);audit.compiled=null;audit.report=null;audit.originalResponse=null;
        audit.handle.status=new PatchAuditStatus(state,reason);audit.handle.result.completeExceptionally(new IllegalStateException(reason));
    }
    /** No writes. The exact Capture object must still be owned by this server;
     * a client copy with matching IDs/hashes cannot become the source of truth. */
    public static BeforeHandle startBeforeCheck(MinecraftServer server,UUID player,Capture original,WorldPatchPreview preview) {
        Objects.requireNonNull(original);Objects.requireNonNull(preview);var handle=new BeforeHandle();
        handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancelBeforeCheck(server,handle.id);});
        server.execute(()->{try{
            if(handle.result.isCancelled()){handle.status=new BeforeStatus(WorldPatchBeforeCheck.State.CANCELLED,"BEFORE 校验已取消",null);return;}
            var t=checkedTask(server,player,original.id(),original.selection().revision());
            if(t.capture!=original||t.baseline==null)throw new IllegalStateException("不能用替代快照申请 BEFORE 校验");
            if(t.before!=null)throw new IllegalStateException("原选区已有 BEFORE 校验；先显式取消，不能隐式替换");
            var before=new BeforeTask();before.handle=handle;before.preview=preview;
            final var baseline=t.baseline;
            before.worker=CompletableFuture.supplyAsync(()->WorldPatchBeforeCheck.prepare(baseline,preview,()->before.cancelled),WORKER);t.before=before;
        }catch(Exception error){handle.status=new BeforeStatus(WorldPatchBeforeCheck.State.FAILED,rootMessage(error),null);handle.result.completeExceptionally(error);}});
        return handle;
    }
    public static void cancelBeforeCheck(MinecraftServer server,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.before!=null&&t.before.handle.id.equals(id))stopBefore(t,WorldPatchBeforeCheck.State.CANCELLED,"BEFORE 校验已取消");});}
    public static CompletableFuture<BeforeReport> checkedBeforeReport(MinecraftServer server,UUID player,Capture original,String id,WorldPatchPreview.Binding binding){
        var result=new CompletableFuture<BeforeReport>();server.execute(()->{try{
            var t=checkedTask(server,player,original.id(),original.selection().revision());var b=t.before;
            if(t.capture!=original||b==null||!b.handle.id.equals(id)||b.report==null||b.handle.status.state()!=WorldPatchBeforeCheck.State.MATCHED||!b.preview.binding().equals(binding))throw new IllegalStateException("没有此原候选当前有效的 BEFORE 校验");
            // A changed source cannot revive a completed comparison.
            b.scan.result();result.complete(b.report);
        }catch(Exception error){result.completeExceptionally(error);}});return result;
    }
    private static WorldPatchBeforeCheck.Source beforeSource(MinecraftServer server,Task t){
        return new WorldPatchBeforeCheck.Source(){
            private WorldChunk cachedChunk;private int chunkX,chunkZ;private boolean cached;
            private final BlockPos.Mutable position=new BlockPos.Mutable();
            private final Map<BlockState,SelectionScan.BlockFact> facts=new HashMap<>();
            public void beginStep(){onServer(server);current(server,t);cached=false;cachedChunk=null;facts.clear();}
            public SelectionScan.Identity identity(){onServer(server);var w=t.selection.world();return new SelectionScan.Identity(w.worldId(),w.dimension(),t.selection.revision(),t.watch.revision());}
            private WorldChunk chunk(int x,int z){
                onServer(server);if(cached&&x==chunkX&&z==chunkZ)return cachedChunk;
                var value=t.world.getChunkManager().getWorldChunk(x,z);
                if(!t.chunks.observe(x,z,value))throw new IllegalStateException("原区块实例/覆盖已改变");
                chunkX=x;chunkZ=z;cached=true;return cachedChunk=value;
            }
            public boolean loaded(int x,int z){return chunk(x,z)!=null;}
            public SelectionScan.BlockFact read(SelectionRegion.Point p){
                var value=chunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));if(value==null)throw new IllegalStateException("BEFORE 读取时区块卸载");
                var state=value.getBlockState(position.set(p.x(),p.y(),p.z()));var fact=facts.get(state);
                if(fact==null){fact=BlockStateFacts.read(state);if(facts.size()<4096)facts.put(state,fact);}return fact;
            }
        };
    }
    private static void tickBefore(MinecraftServer server,Task t){
        var b=t.before;if(b==null||b.report!=null)return;
        try{
            if(b.worker!=null){if(!b.worker.isDone())return;var plan=b.worker.join();b.worker=null;b.scan=new WorldPatchBeforeCheck(plan,beforeSource(server,t),4096,2_000_000,System::nanoTime);}
            var progress=b.scan.step();b.handle.status=new BeforeStatus(progress.state(),progress.reason(),progress);
            switch(progress.state()){
                case CHECKING -> {}
                case MATCHED -> {
                    checkedTask(server,t.player,t.handle.id,t.selection.revision());
                    b.report=new BeforeReport(b.handle.id,t.capture,b.scan.result());b.handle.result.complete(b.report);
                }
                default -> stopBefore(t,progress.state(),progress.reason());
            }
        }catch(Exception error){stopBefore(t,WorldPatchBeforeCheck.State.FAILED,rootMessage(error));}
    }
    private static void stopBefore(Task t,WorldPatchBeforeCheck.State state,String reason){
        var b=t.before;t.before=null;if(b==null)return;
        b.cancelled=true;
        var previous=b.scan==null?null:b.scan.progress();
        if(b.worker!=null)b.worker.cancel(false);if(b.scan!=null)b.scan.cancel();b.report=null;
        var progress=previous==null?null:new WorldPatchBeforeCheck.Progress(state,reason,previous.checked(),previous.total(),previous.reads(),previous.steps(),previous.maxStepNanos());
        b.handle.status=new BeforeStatus(state,reason,progress);b.handle.result.completeExceptionally(new IllegalStateException(reason));
    }
    /** Package-private server-owned handoff, not a client report or consent.
     * World writes remain in the independent placement service. */
    static final class NativeLease {
        private final Task task;private final PatchAudit audit;private final BeforeTask before;private final Capture original;private final WorldPatchPreview preview;
        private final WorldPatchCompiler.Compiled compiled;private final byte[] response;private boolean detached;
        private NativeLease(Task t,WorldPatchPreview preview){task=t;audit=t.audit;before=t.before;original=t.capture;this.preview=preview;compiled=audit.compiled;response=audit.originalResponse.clone();}
        WorldPatchJournal.Plan prepare(UUID player){return WorldPatchJournal.prepare(original,compiled,preview,response,player);}
        void current(MinecraftServer server,UUID player){
            if(detached||checkedTask(server,player,original.id(),original.selection().revision())!=task||task.capture!=original||task.audit!=audit||task.before!=before||audit.compiled!=compiled||audit.compiled.baseline()!=task.baseline||audit.report==null||before.report==null||audit.preview!=preview||before.preview!=preview)throw new IllegalStateException("原服务器审核或 BEFORE 已改变；不能重绑");
            before.scan.result();
        }
        NativeWorld detach(MinecraftServer server,UUID player){
            current(server,player);if(!TASKS.remove(server,task))throw new IllegalStateException("原读取任务不能移交");detached=true;task.lifetime.revoke();
            var world=new NativeWorld(task.world,task.player,task.selection,task.watch,task.chunks);task.watch=null;
            stopBefore(task,WorldPatchBeforeCheck.State.CANCELLED,"原读取任务已明确移交世界事务");stopAudit(task,PatchAuditState.CANCELLED,"原审核已绑定最终事务，不再作为读取能力");
            if(task.scan!=null)task.scan.cancel();task.states.clear();task.capture=null;task.baseline=null;
            task.handle.status=new Status(State.STALE,"原快照已用于明确确认的事务；读取/投影能力失效",task.scan==null?null:task.scan.progress());return world;
        }
    }
    static final class NativeWorld {
        final ServerWorld world;final UUID player;final WorldSelection selection;final WorldChangeTracker.Watch watch;final SelectionChunkFence chunks;
        private NativeWorld(ServerWorld w,UUID p,WorldSelection s,WorldChangeTracker.Watch watch,SelectionChunkFence chunks){world=w;player=p;selection=s;this.watch=watch;this.chunks=chunks;}
        NativeWorld forUndo(WorldPatchExecution.UndoOrigin undo){
            if(!player.equals(undo.plan().player())||!selection.equals(undo.plan().binding().selection()))throw new IllegalStateException("撤销不是原世界事务的来源");
            // This is a NEW undo epoch, not a replacement of the original
            // Capture or its logged AFTER. No chunks are loaded or retained.
            return new NativeWorld(world,player,selection,WorldChangeTracker.watch(world,selection.context()),new SelectionChunkFence());
        }
    }
    static NativeLease nativeLease(MinecraftServer server,UUID player,Capture original,WorldPatchPreview preview,String auditId,String beforeId){
        var t=checkedTask(server,player,original.id(),original.selection().revision());
        if(t.capture!=original||t.audit==null||t.before==null||t.audit.handle.status.state()!=PatchAuditState.READY||t.before.handle.status.state()!=WorldPatchBeforeCheck.State.MATCHED||!t.audit.handle.id.equals(auditId)||!t.before.handle.id.equals(beforeId)||t.audit.preview!=preview||t.before.preview!=preview||t.audit.compiled==null||t.audit.originalResponse==null)throw new IllegalStateException("缺少原服务器同一候选的独立审核与 fresh BEFORE");
        var lease=new NativeLease(t,preview);lease.current(server,player);return lease;
    }
    public static void tick(MinecraftServer server) {
        onServer(server);var t=TASKS.get(server);if(t==null)return;
        try{
            current(server,t);
            if(t.handle.status.state()==State.READY) {
                if(t.watch.revision()!=t.detachedRevision||!chunkFenceCurrent(t)||expired(t))discard(server,State.STALE,"环境已改变或快照已过期，重新读取");
                else {tickAudit(server,t);if(TASKS.get(server)==t)tickBefore(server,t);}
                return;
            }
            if(t.worker!=null) {
                if(t.watch.revision()!=t.detachedRevision||!chunkFenceCurrent(t)){discard(server,State.STALE,"终结快照期间环境/区块覆盖发生变化");return;}
                if(!t.worker.isDone())return;
                var finalized=t.worker.join();current(server,t);
                if(t.watch.revision()!=t.detachedRevision||!chunkFenceCurrent(t))throw new IllegalStateException("终结快照期间环境/区块覆盖发生变化");
                t.baseline=finalized.baseline();
                if(t.baseline.contextRevision!=t.detachedRevision)throw new IllegalStateException("原服务器基线版本不一致");
                t.capture=new Capture(t.handle.id,t.selection,t.detachedRevision,finalized.payload(),finalized.timings(),false);t.lifetime=new SelectionCaptureLifetime<>(t.capture,t.player,System.nanoTime());
                t.handle.status=new Status(State.READY,"只读快照已完成；尚未发送给模型",t.scan.progress());t.handle.result.complete(t.capture);t.worker=null;t.states.clear();return;
            }
            long readStarted=System.nanoTime();var progress=t.scan.step();t.timings.record(System.nanoTime()-readStarted);t.handle.status=new Status(State.READING,progress.reason(),progress);
            switch(progress.state()) {
                case READING -> {}
                case CAPTURED -> {
                    if(!chunkFenceCurrent(t))throw new IllegalStateException("扫描结束的区块覆盖已改变");JsonObject captured=t.scan.detachCapture();t.detachedRevision=captured.getAsJsonObject("fence").get("end").getAsLong();
                    JsonObject envelope=new JsonObject();envelope.add("selection",t.selection.json());envelope.add("capture",captured);
                    t.handle.status=new Status(State.FINALIZING,"后台终结快照，游戏线程不序列化",t.scan.progress());
                    var timings=t.timings;t.timings=null;
                    t.worker=CompletableFuture.supplyAsync(()->{String payload=envelope.toString();if(payload.getBytes(StandardCharsets.UTF_8).length>SelectionLimits.snapshotBytes())throw new IllegalStateException("快照字节额度超限");return new Finalized(payload,timings.finish(),SelectionBaseline.fromSealedCapture(t.selection,captured));},WORKER);
                }
                case STALE -> discard(server,State.STALE,progress.reason());
                case UNSTABLE -> discard(server,State.UNSTABLE,progress.reason());
                case CANCELLED -> discard(server,State.CANCELLED,progress.reason());
                default -> discard(server,State.FAILED,progress.reason());
            }
        }catch(Exception e){discard(server,State.FAILED,rootMessage(e));}
    }
    private static String rootMessage(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private static void discard(MinecraftServer server,State state,String reason) {
        var t=TASKS.remove(server);if(t==null)return;
        if(t.lifetime!=null)t.lifetime.revoke();
        stopBefore(t,state==State.CANCELLED?WorldPatchBeforeCheck.State.CANCELLED:WorldPatchBeforeCheck.State.CONFLICT,reason);
        stopAudit(t,state==State.CANCELLED?PatchAuditState.CANCELLED:PatchAuditState.STALE,reason);
        if(t.scan!=null)t.scan.cancel();if(t.watch!=null)t.watch.close();if(t.worker!=null)t.worker.cancel(false);t.states.clear();t.chunks.reset();t.capture=null;t.baseline=null;
        t.handle.status=new Status(state,reason,t.scan==null?null:t.scan.progress());t.handle.result.completeExceptionally(new IllegalStateException(reason));
    }
    public static void stopping(MinecraftServer server){onServer(server);discard(server,State.STALE,"世界已关闭");IDENTITIES.remove(server);}
    private SelectionReadService(){}
}
