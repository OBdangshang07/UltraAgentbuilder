package dev.voxelstudio.selection;

import net.minecraft.server.MinecraftServer;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Independent final UNDO gateway for a still-retained same-live complete
 * apply prefix. No archived report, equal binding or public ID creates its
 * authority. Player-facing UI and installed physical saves remain separate. */
public final class CoupledAssemblyUndoService {
    public enum PrepareState { VERIFYING,READY,CANCELLED,FAILED }
    public record PrepareStatus(PrepareState state,String reason){}
    public record Summary(CoupledAssemblyBinding binding,String parentJournalId,int writes,int groups){
        public boolean canAuthorizePlacement(){return false;}public boolean worldDurabilityVerified(){return false;}
    }
    public static final class Confirmation {
        private final Preparation owner;private final Summary summary;private final CoupledAssemblyConsent.Ticket ticket;
        private Confirmation(Preparation owner,Summary summary,CoupledAssemblyConsent.Ticket ticket){this.owner=owner;this.summary=summary;this.ticket=ticket;}
        public Summary summary(){return summary;}public String preparationId(){return owner.handle.id;}
    }
    public static final class PrepareHandle {
        private final String id=UUID.randomUUID().toString();private final CompletableFuture<Confirmation> result=new CompletableFuture<>();
        private volatile PrepareStatus status=new PrepareStatus(PrepareState.VERIFYING,"只读校验同一原封闭成组前缀；未撤销或修改世界");
        private PrepareHandle(){}public String id(){return id;}public PrepareStatus status(){return status;}public CompletableFuture<Confirmation> result(){return result;}
    }
    public enum State { PREPARING_LOG,RUNNING,WAIT_LOG,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED }
    public record Status(State state,int evaluated,int restored,int preserved,int total,String reason){public boolean worldDurabilityVerified(){return false;}}
    public record Result(State state,int evaluated,int restored,int preserved,int total,String journalId,String reason){public boolean worldDurabilityVerified(){return false;}}
    public static final class Operation {
        private final String id=UUID.randomUUID().toString();private final UUID player;private final CompletableFuture<Result> result=new CompletableFuture<>();private volatile Status status;
        private Operation(UUID player,int total){this.player=player;status=new Status(State.PREPARING_LOG,0,0,0,total,"已单独确认保护式撤销；等待原逆向日志");}
        public String id(){return id;}public Status status(){return status;}public CompletableFuture<Result> result(){return result;}
    }
    private static final Map<MinecraftServer,Preparation> PREPARATIONS=new HashMap<>();
    private static final Map<MinecraftServer,AssemblyPlanPreparation<?>> RETIRING=new HashMap<>();
    private static final Map<MinecraftServer,Task> TASKS=new HashMap<>();
    private static final ExecutorService VERIFY=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new SynchronousQueue<>(),r->{var t=new Thread(r,"voxel-coupled-undo-verify");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final ThreadPoolExecutor DISK=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r->{var t=new Thread(r,"voxel-coupled-undo-journal");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final class Preparation {
        UUID player;PrepareHandle handle;CoupledAssemblyPlacementService.UndoSource source;CoupledAssemblyExecution.UndoOrigin original;
        AssemblyPlanPreparation<Summary> worker;Confirmation confirmation;
    }
    private static final class Task {
        UUID player;Operation handle;CoupledAssemblyExecution.UndoOrigin original;SelectionReadService.CoupledUndoNativeWorld world;
        CompletableFuture<CoupledAssemblyUndoJournal.Live> worker;CoupledAssemblyUndoJournal.Live journal;CoupledAssemblyUndoNativeSource source;CoupledAssemblyUndoExecution engine;
        long workerStarted;boolean cancelled,closed;
    }
    private static void thread(MinecraftServer server){if(!server.isOnThread())throw new IllegalStateException("Coupled inverse gateway requires original server thread");}
    private static boolean terminal(State state){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED).contains(state);}
    static State mapped(CoupledAssemblyUndoExecution.State state){return switch(Objects.requireNonNull(state)){case COMPLETED->State.COMPLETED;case CANCELLED->State.CANCELLED;case CONFLICT->State.CONFLICT;case REVIEW_REQUIRED->State.REVIEW_REQUIRED;case APPLYING->State.RUNNING;default->State.WAIT_LOG;};}
    private static void reap(){RETIRING.entrySet().removeIf(e->e.getValue().closed());}
    private static boolean diskBusy(){return DISK.getActiveCount()!=0||!DISK.getQueue().isEmpty();}
    /** Leaf only: it never calls forward busy or the shared policy. */
    public static boolean busy(MinecraftServer server){thread(server);reap();var t=TASKS.get(server);return PREPARATIONS.containsKey(server)||RETIRING.containsKey(server)||t!=null&&!terminal(t.handle.status.state)||diskBusy();}
    private static void idle(MinecraftServer server){thread(server);WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.COUPLED_ASSEMBLY);reap();var t=TASKS.get(server);if(RETIRING.containsKey(server)||t!=null&&!terminal(t.handle.status.state)||diskBusy())throw new IllegalStateException("原成组撤销或原 CPU/磁盘操作未封闭；不接管或重发");}
    public static PrepareHandle prepare(MinecraftServer server,UUID player,CoupledAssemblyPlacementService.Operation original){
        Objects.requireNonNull(server);Objects.requireNonNull(player);Objects.requireNonNull(original);var handle=new PrepareHandle();
        handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancelPreparation(server,player,handle.id);});
        server.execute(()->{try{thread(server);WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.READ);idle(server);
            if(handle.result.isCancelled()||PREPARATIONS.containsKey(server))throw new IllegalStateException("撤销准备已取消，或已有原确认准备；不替换");
            var source=CoupledAssemblyPlacementService.undoSource(server,player,original);var p=new Preparation();p.player=player;p.handle=handle;p.source=source;p.original=source.original();
            var origin=p.original;p.worker=AssemblyPlanPreparation.start(VERIFY,System::nanoTime,cancelled->{
                WorldPatchJson.cancelled(cancelled);try{origin.sealed().verify();}catch(Exception error){throw new CompletionException(error);}WorldPatchJson.cancelled(cancelled);
                return new Summary(origin.plan().binding(),origin.plan().id().toString(),origin.prefix().size(),origin.groups());
            });PREPARATIONS.put(server,p);
        }catch(Exception error){handle.status=new PrepareStatus(PrepareState.FAILED,root(error));handle.result.completeExceptionally(error);}});return handle;
    }
    public static void cancelPreparation(MinecraftServer server,UUID player,String id){server.execute(()->{var p=PREPARATIONS.get(server);if(p!=null&&p.player.equals(player)&&p.handle.id.equals(id))discard(server,p,PrepareState.CANCELLED,"原成组撤销准备已取消；没有逆向写入");});}
    private static void discard(MinecraftServer server,Preparation p,PrepareState state,String reason){
        if(PREPARATIONS.get(server)!=p)return;PREPARATIONS.remove(server,p);if(p.confirmation!=null)CoupledAssemblyConsent.revoke(p.confirmation.ticket,p);
        if(p.worker!=null){p.worker.cancel();if(!p.worker.closed())RETIRING.put(server,p.worker);}p.worker=null;p.source=null;p.original=null;
        p.handle.status=new PrepareStatus(state,reason);p.handle.result.completeExceptionally(new IllegalStateException(reason));
    }
    private static void prepareTick(MinecraftServer server,Preparation p){
        try{
            if(p.handle.result.isCancelled()){discard(server,p,PrepareState.CANCELLED,"原成组撤销准备已取消");return;}
            p.source.current(server,p.player);
            if(p.handle.status.state==PrepareState.VERIFYING){p.worker.check();if(!p.worker.closed())return;var summary=p.worker.value();
                if(!summary.binding.equals(p.original.plan().binding())||summary.writes!=p.original.prefix().size()||summary.groups!=p.original.groups())throw new IllegalStateException("原封闭成组摘要改变；不重新绑定");
                var ticket=CoupledAssemblyConsent.issue(p,p.player,p.original.plan().binding(),CoupledAssemblyConsent.Purpose.UNDO,System.nanoTime());p.worker=null;
                p.confirmation=new Confirmation(p,summary,ticket);p.handle.status=new PrepareStatus(PrepareState.READY,"45 秒内独立确认：后改整组及支撑保留；物理存盘未验证");p.handle.result.complete(p.confirmation);
            }else if(p.handle.status.state==PrepareState.READY&&!CoupledAssemblyConsent.available(p.confirmation.ticket,p,p.player,p.original.plan().binding(),CoupledAssemblyConsent.Purpose.UNDO,System.nanoTime()))throw new IllegalStateException("原成组撤销最终确认已过期或撤销；不继续写入");
        }catch(Exception error){discard(server,p,PrepareState.FAILED,root(error));}
    }
    public static CompletableFuture<Operation> confirm(MinecraftServer server,UUID player,Confirmation confirmation,boolean protectionAcknowledged){
        var result=new CompletableFuture<Operation>();server.execute(()->{Task t=null;try{thread(server);if(result.isCancelled())throw new CancellationException("撤销确认请求已取消；不移交来源");idle(server);Objects.requireNonNull(confirmation);var p=PREPARATIONS.get(server);
            if(p==null||p!=confirmation.owner||p.confirmation!=confirmation||!p.player.equals(player)||p.handle.status.state!=PrepareState.READY||!protectionAcknowledged)throw new IllegalStateException("缺少同一原成组独立撤销确认和后改保留/物理未验证提示确认");
            p.source.current(server,player);t=new Task();t.player=player;t.original=p.original;t.handle=new Operation(player,t.original.prefix().size());
            // Native handoff consumes UNDO itself, once. No double consume.
            t.world=p.source.open(server,player,p,confirmation.ticket);PREPARATIONS.remove(server,p);p.handle.status=new PrepareStatus(PrepareState.CANCELLED,"原成组撤销已由明确确认移交");p.source=null;p.original=null;
            var origin=t.original;t.worker=CompletableFuture.supplyAsync(()->createJournal(origin),DISK);t.workerStarted=System.nanoTime();TASKS.put(server,t);
            var operation=t.handle;operation.result.whenComplete((v,e)->{if(operation.result.isCancelled())cancel(server,player,operation.id);});result.complete(operation);
        }catch(Exception error){if(t!=null&&t.world!=null)close(t);var p=PREPARATIONS.get(server);if(p!=null&&confirmation!=null&&p==confirmation.owner)discard(server,p,PrepareState.FAILED,root(error));result.completeExceptionally(error);}});return result;
    }
    private static CoupledAssemblyUndoJournal.Live createJournal(CoupledAssemblyExecution.UndoOrigin original){
        try{var directory=original.archive().getParent();WorldPatchJournalFiles.directory(directory);if(Files.getFileStore(directory).getUsableSpace()<2L*1024*1024*1024)throw new IllegalStateException("原成组日志盘不足 2 GiB；没有撤销写入");return CoupledAssemblyUndoJournal.create(directory,original);}catch(Exception error){throw new CompletionException(error);}
    }
    public static void cancel(MinecraftServer server,UUID player,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.player.equals(player)&&t.handle.id.equals(id)&&!terminal(t.handle.status.state)){t.cancelled=true;if(t.engine!=null)t.engine.cancel();}});}
    public static CompletableFuture<Operation> current(MinecraftServer server,UUID player){
        var result=new CompletableFuture<Operation>();server.execute(()->{try{thread(server);var user=server.getPlayerManager().getPlayer(player);
            if(server.isDedicated()||user==null||!user.isCreative()||!server.isHost(user.getGameProfile()))throw new IllegalStateException("仅当前单人创造房主可读取原成组撤销状态");var t=TASKS.get(server);if(t!=null&&!t.player.equals(player))throw new IllegalStateException("不能读取其他玩家成组撤销");
            result.complete(t==null||!WorldOperationViewScope.currentDimension(t.original.plan().binding().selection().world().dimension(),user.getServerWorld().getRegistryKey().getValue().toString())?null:t.handle);
        }catch(Exception error){result.completeExceptionally(error);}});return result;
    }
    private static void close(Task t){if(!t.closed){t.closed=true;if(t.source!=null)t.source.close();else if(t.world!=null)t.world.watch.close();}}
    private static void finish(Task t,State state,int evaluated,int restored,int preserved,String reason){
        t.handle.status=new Status(state,evaluated,restored,preserved,t.handle.status.total,reason);close(t);t.handle.result.complete(new Result(state,evaluated,restored,preserved,t.handle.status.total,t.journal==null?null:t.journal.plan().id().toString(),reason));
    }
    private static void tickTask(MinecraftServer server,Task t){
        if(terminal(t.handle.status.state))return;try{
            if(t.worker!=null){if(!t.worker.isDone()){if(System.nanoTime()-t.workerStarted>CoupledAssemblyExecution.WAIT_TIMEOUT_NANOS)finish(t,State.REVIEW_REQUIRED,0,0,0,"原撤销初始日志回执未知；不重发原磁盘操作");return;}
                t.journal=t.worker.getNow(null);t.worker=null;if(!t.journal.plan().fromOriginalOrigin(t.original))throw new IllegalStateException("原逆向日志来源被替换");
                t.source=new CoupledAssemblyUndoNativeSource(server,t.world,t.journal.plan());t.engine=new CoupledAssemblyUndoExecution(new CoupledAssemblyUndoExecution.Disk(t.journal,DISK),t.source,64,2_000_000,System::nanoTime);if(t.cancelled)t.engine.cancel();}
            var progress=t.engine.step();var state=mapped(progress.state());if(terminal(state))finish(t,state,progress.evaluatedWrites(),progress.restored(),progress.preserved(),progress.reason());else t.handle.status=new Status(state,progress.evaluatedWrites(),progress.restored(),progress.preserved(),progress.totalWrites(),progress.reason());
        }catch(Exception error){var progress=t.engine==null?null:t.engine.progress();finish(t,State.REVIEW_REQUIRED,progress==null?0:progress.evaluatedWrites(),progress==null?0:progress.restored(),progress==null?0:progress.preserved(),"原成组撤销不能继续；不重放："+root(error));}
    }
    public static void tick(MinecraftServer server){thread(server);reap();var p=PREPARATIONS.get(server);if(p!=null)prepareTick(server,p);var t=TASKS.get(server);if(t!=null)tickTask(server,t);}
    public static void stopping(MinecraftServer server){
        thread(server);var p=PREPARATIONS.get(server);if(p!=null)discard(server,p,PrepareState.CANCELLED,"服务器正在关闭；未确认撤销作废");var t=TASKS.remove(server);if(t==null)return;
        if(!terminal(t.handle.status.state)){if(t.engine!=null){t.engine.cancel();t.engine.step();}var progress=t.engine==null?null:t.engine.progress();finish(t,State.REVIEW_REQUIRED,progress==null?0:progress.evaluatedWrites(),progress==null?0:progress.restored(),progress==null?0:progress.preserved(),"关闭时撤销未完全封闭；原磁盘操作不取消、不重发，保留日志待审查");}else close(t);
    }
    private static String root(Throwable error){while(error.getCause()!=null)error=error.getCause();return String.valueOf(error.getMessage());}
    private CoupledAssemblyUndoService(){}
}
