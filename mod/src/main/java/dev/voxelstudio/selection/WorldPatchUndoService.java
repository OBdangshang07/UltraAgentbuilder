package dev.voxelstudio.selection;

import net.minecraft.server.MinecraftServer;
import java.util.*;
import java.util.concurrent.*;

/** Independent explicit protection-first undo. Only a sealed, unambiguous
 * same-live apply may supply its source; read-only disk review cannot. The
 * fresh watch protects the NEW undo epoch without rebinding the old AFTER. */
public final class WorldPatchUndoService {
    public enum PrepareState { CHECKING_ARCHIVE,READY,CANCELLED,FAILED }
    public record PrepareStatus(PrepareState state,String reason){}
    public record Summary(String parentOperationId,String parentJournalId,int confirmed,WorldPatchPreview.Binding binding){public boolean canAuthorizePlacement(){return false;}public boolean worldDurabilityVerified(){return false;}}
    public static final class Confirmation {
        private final Preparation owner;private final WorldPatchConsent.Ticket<Preparation> ticket;private final Summary summary;
        private Confirmation(Preparation p,Summary s){owner=p;summary=s;ticket=WorldPatchConsent.issue(p,p.player,s.binding,System.nanoTime());}
        public Summary summary(){return summary;}
    }
    public static final class PrepareHandle {
        private final String id=UUID.randomUUID().toString();private final CompletableFuture<Confirmation> result=new CompletableFuture<>();
        private volatile PrepareStatus status=new PrepareStatus(PrepareState.CHECKING_ARCHIVE,"只读核验原 live 修改日志；不撤销、不消耗原见证");
        private PrepareHandle(){}public String id(){return id;}public CompletableFuture<Confirmation> result(){return result;}public PrepareStatus status(){return status;}
    }
    public enum State { PREPARING_LOG,RUNNING,WAIT_LOG,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    public record Status(State state,int evaluated,int restored,int preserved,int total,String reason){public boolean worldDurabilityVerified(){return false;}}
    public record Result(Status status,String journalId,String parentJournalId){public boolean worldDurabilityVerified(){return false;}}
    public static final class Operation {
        private final String id=UUID.randomUUID().toString();private final UUID player;private final CompletableFuture<Result> result=new CompletableFuture<>();private volatile Status status;
        private Operation(UUID player,int count){this.player=player;status=new Status(State.PREPARING_LOG,0,0,0,count,"已明确确认保护式撤销；等待独立写前日志");}
        public String id(){return id;}public Status status(){return status;}public CompletableFuture<Result> result(){return result;}
    }
    private static final Map<MinecraftServer,Preparation> PREPARATIONS=new HashMap<>();
    private static final Map<MinecraftServer,Task> TASKS=new HashMap<>();
    private static final ExecutorService DISK=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r->{var t=new Thread(r,"voxel-patch-undo-journal");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final class Preparation {UUID player;PrepareHandle handle;WorldPatchPlacementService.UndoSource source;WorldPatchPlacementService.Operation parent;CompletableFuture<List<WorldPatchCompiler.Write>> worker;List<WorldPatchCompiler.Write> writes;Confirmation confirmation;long started;}
    private static final class Task {UUID player;Operation handle;WorldPatchExecution.UndoOrigin origin;WorldPatchNativeSource source;CompletableFuture<WorldPatchUndoJournal.Live> worker;WorldPatchUndoJournal.Live journal;WorldPatchUndoExecution engine;long started,confirmationRevision;boolean cancelled,closed;}
    private static void thread(MinecraftServer server){if(!server.isOnThread())throw new IllegalStateException("Undo gateway requires server thread");}
    private static boolean terminal(State s){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED).contains(s);}
    static boolean busy(MinecraftServer server){thread(server);var t=TASKS.get(server);return PREPARATIONS.containsKey(server)||t!=null&&!terminal(t.handle.status.state);}
    public static PrepareHandle prepare(MinecraftServer server,UUID player,WorldPatchPlacementService.Operation parent){
        Objects.requireNonNull(server);Objects.requireNonNull(player);Objects.requireNonNull(parent);var handle=new PrepareHandle();handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancelPreparation(server,player,handle.id);});
        server.execute(()->{try{thread(server);WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.SINGLE_PATCH);if(handle.result.isCancelled())throw new IllegalStateException("撤销准备已取消");if(busy(server)||SelectionReadService.busy(server))throw new IllegalStateException("已有撤销准备、任务或读取核验；不隐式替换");var p=new Preparation();p.player=player;p.handle=handle;p.parent=parent;p.source=WorldPatchPlacementService.undoSource(server,player,parent);var origin=p.source.origin();p.worker=CompletableFuture.supplyAsync(()->checkedWrites(origin),DISK);p.started=System.nanoTime();PREPARATIONS.put(server,p);}catch(Exception e){handle.status=new PrepareStatus(PrepareState.FAILED,root(e));handle.result.completeExceptionally(e);}});return handle;
    }
    private static List<WorldPatchCompiler.Write> checkedWrites(WorldPatchExecution.UndoOrigin origin){
        try{origin.plan().verifyArchive(origin.archive());var review=WorldPatchJournal.inspect(origin.archive());if(review.needsReview()||!origin.plan().hash().equals(review.planHash())||!origin.prefix().equals(review.confirmed()))throw new IllegalStateException("原封闭日志已改变或不确定；不授予撤销");var writes=new ArrayList<WorldPatchCompiler.Write>();for(int i=origin.prefix().size()-1;i>=0;i--)writes.add(WorldPatchUndoJournal.inverse(origin.prefix().get(i)));return List.copyOf(writes);}catch(Exception e){throw new CompletionException(e);}
    }
    public static void cancelPreparation(MinecraftServer server,UUID player,String id){server.execute(()->{var p=PREPARATIONS.get(server);if(p!=null&&p.player.equals(player)&&p.handle.id.equals(id))discard(server,p,PrepareState.CANCELLED,"撤销准备已取消；没有撤销任何方块");});}
    private static void discard(MinecraftServer server,Preparation p,PrepareState state,String reason){if(!PREPARATIONS.remove(server,p))return;if(p.confirmation!=null)WorldPatchConsent.revoke(p.confirmation.ticket,p);p.handle.status=new PrepareStatus(state,reason);p.handle.result.completeExceptionally(new IllegalStateException(reason));p.worker=null;p.writes=null;p.source=null;}
    private static void prepareTick(MinecraftServer server,Preparation p){try{if(p.handle.result.isCancelled()){discard(server,p,PrepareState.CANCELLED,"撤销准备已取消");return;}p.source.current(server,p.player);if(p.confirmation!=null){if(!WorldPatchConsent.available(p.confirmation.ticket,p,p.player,p.confirmation.summary.binding,System.nanoTime()))throw new IllegalStateException("撤销确认已过期；可显式重新准备");return;}if(!p.worker.isDone()){if(System.nanoTime()-p.started>=WorldPatchExecution.WAIT_TIMEOUT_NANOS)throw new IllegalStateException("原撤销准备回执超时；不重发");return;}p.writes=p.worker.getNow(null);var o=p.source.origin();p.confirmation=new Confirmation(p,new Summary(p.parent.id(),o.plan().id().toString(),p.writes.size(),o.plan().binding()));p.handle.status=new PrepareStatus(PrepareState.READY,"原日志已核验；45 秒内独立确认，后改目标/邻居会保留");p.handle.result.complete(p.confirmation);p.worker=null;}catch(Exception e){discard(server,p,PrepareState.FAILED,root(e));}}
    public static CompletableFuture<Operation> confirm(MinecraftServer server,UUID player,Confirmation confirmation,boolean protectionAcknowledged){
        var result=new CompletableFuture<Operation>();server.execute(()->{Task t=null;try{thread(server);WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.SINGLE_PATCH);if(SelectionReadService.busy(server))throw new IllegalStateException("原扫描或核验尚未结束；不能与撤销并发");Objects.requireNonNull(confirmation);var p=PREPARATIONS.get(server);var previous=TASKS.get(server);if(p==null||p!=confirmation.owner||p.confirmation!=confirmation||!p.player.equals(player)||!protectionAcknowledged||previous!=null&&!terminal(previous.handle.status.state))throw new IllegalStateException("缺少原 live 事务的独立撤销确认及保护提示确认");
            WorldPatchConsent.consume(confirmation.ticket,p,player,p.confirmation.summary.binding,System.nanoTime());p.source.current(server,player);t=new Task();t.player=player;t.origin=p.source.origin();t.source=p.source.open(server,player,p.writes);t.confirmationRevision=t.source.frame().contextRevision();t.handle=new Operation(player,p.writes.size());var origin=t.origin;
            t.worker=CompletableFuture.supplyAsync(()->{try{var root=origin.archive().getParent();WorldPatchJournalFiles.directory(root);if(java.nio.file.Files.getFileStore(root).getUsableSpace()<2L*1024*1024*1024)throw new IllegalStateException("撤销日志所在盘不足 2 GiB 安全余量");return WorldPatchUndoJournal.create(root,origin);}catch(Exception e){throw new CompletionException(e);}},DISK);t.started=System.nanoTime();PREPARATIONS.remove(server,p);p.handle.status=new PrepareStatus(PrepareState.CANCELLED,"独立撤销确认已消耗；已交给后台任务");TASKS.put(server,t);var operation=t.handle;operation.result.whenComplete((v,e)->{if(operation.result.isCancelled())cancel(server,player,operation.id);});result.complete(operation);
        }catch(Exception e){if(t!=null&&t.source!=null)t.source.close();var p=PREPARATIONS.get(server);if(p!=null&&confirmation!=null&&p==confirmation.owner)discard(server,p,PrepareState.FAILED,root(e));result.completeExceptionally(e);}});return result;
    }
    public static void cancel(MinecraftServer server,UUID player,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.player.equals(player)&&t.handle.id.equals(id)&&!terminal(t.handle.status.state)){t.cancelled=true;if(t.engine!=null)t.engine.cancel();}});}
    public static CompletableFuture<Operation> current(MinecraftServer server,UUID player){var result=new CompletableFuture<Operation>();server.execute(()->{try{thread(server);var p=server.getPlayerManager().getPlayer(player);if(server.isDedicated()||p==null||!p.isCreative()||!server.isHost(p.getGameProfile()))throw new IllegalStateException("仅允许当前单人创造房主查询原撤销任务");var t=TASKS.get(server);if(t!=null&&!t.player.equals(player))throw new IllegalStateException("不能读取其他玩家的撤销事务");result.complete(t==null||!WorldOperationViewScope.currentDimension(t.origin.plan().binding().selection().world().dimension(),p.getServerWorld().getRegistryKey().getValue().toString())?null:t.handle);}catch(Exception e){result.completeExceptionally(e);}});return result;}
    private static void close(Task t){if(!t.closed){t.closed=true;t.source.close();}}
    private static void finish(Task t,State state,String reason){var p=t.engine==null?null:t.engine.progress();t.handle.status=new Status(state,p==null?0:p.evaluated(),p==null?0:p.restored(),p==null?0:p.preserved(),t.handle.status.total,reason);close(t);t.handle.result.complete(new Result(t.handle.status,t.journal==null?null:t.journal.plan().id().toString(),t.origin.plan().id().toString()));}
    private static void tickTask(Task t){if(terminal(t.handle.status.state))return;try{if(t.worker!=null){if(!t.worker.isDone()){if(System.nanoTime()-t.started>=WorldPatchExecution.WAIT_TIMEOUT_NANOS)finish(t,State.REVIEW_REQUIRED,"撤销日志回执超时；原磁盘操作可能仍在运行，不重发");return;}t.journal=t.worker.getNow(null);t.worker=null;if(t.source.frame().contextRevision()!=t.confirmationRevision)throw new IllegalStateException("最终撤销确认后、日志准备期间环境已变化；不重绑新 epoch");t.engine=new WorldPatchUndoExecution(new WorldPatchUndoExecution.Disk(t.journal,DISK),t.source,64,2_000_000,System::nanoTime);if(t.cancelled)t.engine.cancel();}var p=t.engine.step();var state=switch(p.state()){case COMPLETED->State.COMPLETED;case CANCELLED->State.CANCELLED;case CONFLICT->State.CONFLICT;case REVIEW_REQUIRED->State.REVIEW_REQUIRED;case APPLYING->State.RUNNING;default->State.WAIT_LOG;};if(terminal(state))finish(t,state,p.reason());else t.handle.status=new Status(state,p.evaluated(),p.restored(),p.preserved(),p.total(),p.reason());}catch(Exception e){finish(t,State.REVIEW_REQUIRED,"撤销不能继续；不自动重放："+root(e));}}
    public static void tick(MinecraftServer server){thread(server);var p=PREPARATIONS.get(server);if(p!=null)prepareTick(server,p);var t=TASKS.get(server);if(t!=null)tickTask(t);}
    public static void stopping(MinecraftServer server){thread(server);var p=PREPARATIONS.get(server);if(p!=null)discard(server,p,PrepareState.CANCELLED,"原服务器正在关闭，未确认撤销作废");var t=TASKS.remove(server);if(t==null)return;if(!terminal(t.handle.status.state)){if(t.engine!=null){t.engine.cancel();t.engine.step();}finish(t,State.REVIEW_REQUIRED,"服务器关闭时撤销未完全封闭；原磁盘操作不重发，日志需审查");}else close(t);}
    private static String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private WorldPatchUndoService(){}
}
