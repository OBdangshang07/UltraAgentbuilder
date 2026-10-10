package dev.voxelstudio.selection;

import net.minecraft.server.MinecraftServer;
import net.minecraft.util.WorldSavePath;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Integrated-host-only gateway. Preparation remains READ-ONLY. Only the
 * independent explicit final confirmation consumes its owner-bound ticket
 * and transfers the original server lease into the native transaction.
 * No client receipt, matching ID or disk recovery can start a transaction. */
public final class AssemblyPatchPlacementService {
    public enum PrepareState { AUDIT,BEFORE,PREPARING_PLAN,READY,CANCELLED,FAILED }
    public record PrepareStatus(PrepareState state,String reason){}
    public record Summary(AssemblyPatchBinding binding,int writes,int adds,int replaces,int clears,int guards){
        public boolean canAuthorizePlacement(){return false;}public boolean physicsVerified(){return false;}
    }
    public static final class Confirmation {
        private final Preparation owner;private final Summary summary;private final AssemblyPatchConsent.Ticket<Preparation> ticket;
        private Confirmation(Preparation p,Summary s,AssemblyPatchConsent.Ticket<Preparation> ticket){owner=p;summary=s;this.ticket=ticket;}
        public Summary summary(){return summary;}public String preparationId(){return owner.handle.id;}
    }
    public static final class PrepareHandle {
        private final String id=UUID.randomUUID().toString();private final CompletableFuture<Confirmation> result=new CompletableFuture<>();
        private volatile PrepareStatus status=new PrepareStatus(PrepareState.AUDIT,"原服务器独立补丁审核；不写入世界");
        private PrepareHandle(){}public String id(){return id;}public CompletableFuture<Confirmation> result(){return result;}public PrepareStatus status(){return status;}
    }
    public enum State { PREPARING_LOG,RUNNING,WAIT_LOG,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED,FAILED }
    public record Status(State state,int confirmed,int total,String reason){public boolean worldDurabilityVerified(){return false;}}
    public record Result(State state,int confirmed,int total,String journalId,String reason){public boolean worldDurabilityVerified(){return false;}}
    public static final class Operation {
        private final String id=UUID.randomUUID().toString();private final UUID player;private final CompletableFuture<Result> result=new CompletableFuture<>();
        private volatile Status status;
        private Operation(UUID player,int total){this.player=player;status=new Status(State.PREPARING_LOG,0,total,"已明确确认整组；等待不可替换的原始日志");}
        public String id(){return id;}public Status status(){return status;}public CompletableFuture<Result> result(){return result;}
    }
    private static final Map<MinecraftServer,Preparation> PREPARATIONS=new HashMap<>();
    private static final Map<MinecraftServer,AssemblyPlanPreparation<?>> RETIRING_PLANS=new HashMap<>();
    private static final Map<MinecraftServer,Task> TASKS=new HashMap<>();
    private static final ExecutorService PLAN=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new SynchronousQueue<>(),r->{var t=new Thread(r,"voxel-assembly-plan-preparation");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final ExecutorService DISK=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r->{var t=new Thread(r,"voxel-assembly-patch-journal");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final class Preparation {
        UUID player;PrepareHandle handle;SelectionReadService.Capture original;AssemblyPatchPreview preview;SelectionReadService.AssemblyAuditHandle audit;SelectionReadService.AssemblyBeforeHandle before;
        SelectionReadService.AssemblyNativeLease lease;AssemblyPlanPreparation<Prepared> worker;Prepared prepared;Confirmation confirmation;
    }
    private record Prepared(AssemblyPatchJournal.Plan plan,Summary summary){}
    private static final class Task {
        UUID player;Operation handle;AssemblyPatchJournal.Plan plan;AssemblyPatchNativeSource source;SelectionReadService.AssemblyNativeWorld world;
        CompletableFuture<AssemblyPatchJournal.Live> worker;AssemblyPatchJournal.Live journal;AssemblyPatchExecution engine;boolean cancelled,closed,undoSubmitted;long workerStarted;
    }
    private static void thread(MinecraftServer server){if(!server.isOnThread())throw new IllegalStateException("Native placement gateway requires server thread");}
    private static boolean terminal(State state){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED,State.FAILED).contains(state);}
    private static void reapPlans(){RETIRING_PLANS.entrySet().removeIf(entry->entry.getValue().closed());}
    public static boolean busy(MinecraftServer server){thread(server);reapPlans();var task=TASKS.get(server);return RETIRING_PLANS.containsKey(server)||PREPARATIONS.containsKey(server)||task!=null&&!terminal(task.handle.status.state)||AssemblyPatchUndoService.busy(server);}
    private static void idle(MinecraftServer server){WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.WHOLE_ASSEMBLY);var task=TASKS.get(server);if(RETIRING_PLANS.containsKey(server)||task!=null&&!terminal(task.handle.status.state)||AssemblyPatchUndoService.busy(server))throw new IllegalStateException("已有原位事务、撤销准备或取消中的原 CPU 准备；等待原 worker 封闭，不隐式接管");}
    /** Private same-live-task witness. Neither a public operation ID nor a
     * disk archive can create this object. Only the latest retained apply is
     * eligible, and preparation does not consume the undo origin. */
    static final class UndoSource {
        private final Task task;private final AssemblyPatchExecution.UndoOrigin origin;
        private UndoSource(Task t){task=t;origin=t.engine.undoOrigin();}
        AssemblyPatchExecution.UndoOrigin origin(){return origin;}
        void current(MinecraftServer server,UUID player){thread(server);WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.WHOLE_ASSEMBLY);if(TASKS.get(server)!=task||!task.player.equals(player)||task.undoSubmitted||PREPARATIONS.containsKey(server)||!terminal(task.handle.status.state)||task.engine.undoOrigin()!=origin)throw new IllegalStateException("原 live 修改事务已改变、存在新准备或撤销已提交；不重绑");task.source.undoCurrent();}
        AssemblyPatchNativeSource open(MinecraftServer server,UUID player,List<WorldPatchCompiler.Write> rows){current(server,player);task.undoSubmitted=true;return task.source.forUndo(origin,rows);}
    }
    static UndoSource undoSource(MinecraftServer server,UUID player,Operation operation){thread(server);var t=TASKS.get(server);if(t==null||t.handle!=operation||t.engine==null)throw new IllegalStateException("只能撤销本服务器仍持有的原 live 修改事务");var source=new UndoSource(t);source.current(server,player);return source;}
    public static PrepareHandle prepare(MinecraftServer server,UUID player,SelectionReadService.Capture original,AssemblyPatchPreview preview,AssemblyPatchInput input){
        Objects.requireNonNull(server);Objects.requireNonNull(player);Objects.requireNonNull(original);Objects.requireNonNull(preview);Objects.requireNonNull(input);
        var handle=new PrepareHandle();handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancelPreparation(server,player,handle.id);});
        server.execute(()->{try{thread(server);idle(server);if(handle.result.isCancelled())throw new IllegalStateException("整组准备已取消");if(PREPARATIONS.containsKey(server)||SelectionReadService.assemblyAuditActive(server))throw new IllegalStateException("已有原候选的最终确认准备或整组核验；先显式取消，不隐式替换");
            var p=new Preparation();p.player=player;p.handle=handle;p.original=original;p.preview=preview;p.audit=SelectionReadService.startAssemblyAudit(server,player,original,input);PREPARATIONS.put(server,p);
        }catch(Exception e){handle.status=new PrepareStatus(PrepareState.FAILED,root(e));handle.result.completeExceptionally(e);}});return handle;
    }
    public static void cancelPreparation(MinecraftServer server,UUID player,String id){server.execute(()->{var p=PREPARATIONS.get(server);if(p!=null&&p.player.equals(player)&&p.handle.id.equals(id))discard(server,p,PrepareState.CANCELLED,"最终确认准备已取消；未写入世界");});}
    private static void discard(MinecraftServer server,Preparation p,PrepareState state,String reason){
        if(PREPARATIONS.get(server)!=p)return;PREPARATIONS.remove(server);if(p.confirmation!=null)AssemblyPatchConsent.revoke(p.confirmation.ticket,p);
        if(p.audit!=null)SelectionReadService.cancelAssemblyAudit(server,p.audit.id());if(p.before!=null)SelectionReadService.cancelAssemblyBeforeCheck(server,p.before.id());
        if(p.worker!=null){p.worker.cancel();if(!p.worker.closed())RETIRING_PLANS.put(server,p.worker);}
        p.lease=null;p.original=null;p.preview=null;p.prepared=null;p.worker=null;p.handle.status=new PrepareStatus(state,reason);p.handle.result.completeExceptionally(new IllegalStateException(reason));
    }
    private static Prepared prepared(SelectionReadService.AssemblyNativeLease lease,UUID player,java.util.function.BooleanSupplier cancelled){
        var plan=lease.prepare(player,cancelled);int adds=0,replaces=0,clears=0;int count=0;for(var w:plan.compiled().writes()){if((count++&1023)==0)WorldPatchJson.cancelled(cancelled);switch(w.difference()){case "added"->adds++;case "removed"->clears++;case "replaced"->replaces++;default->throw new IllegalArgumentException("Original difference category invalid");}}
        return new Prepared(plan,new Summary(plan.binding(),plan.compiled().writes().size(),adds,replaces,clears,plan.compiled().guards().size()));
    }
    private static void prepareTick(MinecraftServer server,Preparation p){
        try{
            if(p.handle.result.isCancelled()){discard(server,p,PrepareState.CANCELLED,"准备已取消");return;}
            switch(p.handle.status.state){
                case AUDIT->{if(!p.audit.result().isDone()){p.handle.status=new PrepareStatus(PrepareState.AUDIT,p.audit.status().reason());return;}p.audit.result().getNow(null);p.before=SelectionReadService.startAssemblyBeforeCheck(server,p.player,p.original,p.preview,p.audit.id());p.handle.status=new PrepareStatus(PrepareState.BEFORE,"规则已核验；逐 tick 对比当前原始 BEFORE");}
                case BEFORE->{if(!p.before.result().isDone()){p.handle.status=new PrepareStatus(PrepareState.BEFORE,p.before.status().reason());return;}p.before.result().getNow(null);p.lease=SelectionReadService.assemblyNativeLease(server,p.player,p.original,p.preview,p.audit.id(),p.before.id());var lease=p.lease;var player=p.player;p.worker=AssemblyPlanPreparation.start(PLAN,System::nanoTime,cancelled->prepared(lease,player,cancelled));p.handle.status=new PrepareStatus(PrepareState.PREPARING_PLAN,"后台核验完整原始日志方案（CPU 准备最多 180 秒）；仍无世界写入");}
                case PREPARING_PLAN->{p.worker.check();if(!p.worker.closed())return;var value=p.worker.value();p.lease.current(server,p.player);p.prepared=value;var ticket=AssemblyPatchConsent.issue(p,p.player,value.plan.binding(),System.nanoTime());p.confirmation=new Confirmation(p,value.summary,ticket);p.handle.status=new PrepareStatus(PrepareState.READY,"原规则和 fresh BEFORE 一致；45 秒内独立确认原位应用");p.handle.result.complete(p.confirmation);p.worker=null;}
                case READY->{p.lease.current(server,p.player);if(!AssemblyPatchConsent.available(p.confirmation.ticket,p,p.player,p.prepared.plan.binding(),System.nanoTime()))throw new IllegalStateException("最终确认已过期；原响应保留，可显式重新准备");}
                default->{}
            }
        }catch(Exception e){discard(server,p,PrepareState.FAILED,root(e));}
    }
    /** Only this explicit UI action transfers the lease and creates a writer.
     * Closing a later progress screen does not cancel the confirmed task. */
    public static CompletableFuture<Operation> confirm(MinecraftServer server,UUID player,Confirmation confirmation,boolean unverifiedSafetyAcknowledged){
        var result=new CompletableFuture<Operation>();server.execute(()->{Task task=null;try{thread(server);idle(server);Objects.requireNonNull(confirmation);var p=PREPARATIONS.get(server);
            if(p==null||p!=confirmation.owner||p.confirmation!=confirmation||!p.player.equals(player)||p.handle.status.state!=PrepareState.READY||!unverifiedSafetyAcknowledged)throw new IllegalStateException("缺少原候选的独立最终确认及物理/通行未验证提示确认");
            AssemblyPatchConsent.consume(confirmation.ticket,p,player,p.prepared.plan.binding(),System.nanoTime());p.lease.current(server,player);
            task=new Task();task.player=player;task.plan=p.prepared.plan;task.handle=new Operation(player,task.plan.compiled().writes().size());task.world=p.lease.detach(server,player);task.source=new AssemblyPatchNativeSource(server,task.world,task.plan.compiled().writes());
            PREPARATIONS.remove(server,p);p.handle.status=new PrepareStatus(PrepareState.CANCELLED,"最终确认已消耗并移交原生事务");p.lease=null;p.original=null;p.preview=null;p.prepared=null;
            var plan=task.plan;var directory=server.getSavePath(WorldSavePath.ROOT).resolve("voxel-studio-assembly-patch-journals").toAbsolutePath().normalize();
            task.worker=CompletableFuture.supplyAsync(()->createJournal(directory,plan),DISK);task.workerStarted=System.nanoTime();TASKS.put(server,task);var operation=task.handle;operation.result.whenComplete((v,e)->{if(operation.result.isCancelled())cancel(server,player,operation.id);});result.complete(operation);
        }catch(Exception e){if(task!=null&&task.source!=null)task.source.close();else if(task!=null&&task.world!=null)task.world.watch.close();var p=PREPARATIONS.get(server);if(p!=null&&confirmation!=null&&p==confirmation.owner)discard(server,p,PrepareState.FAILED,root(e));result.completeExceptionally(e);}});return result;
    }
    private static AssemblyPatchJournal.Live createJournal(Path root,AssemblyPatchJournal.Plan plan){
        try{WorldPatchJournalFiles.directory(root.getParent());if(Files.getFileStore(root.getParent()).getUsableSpace()<2L*1024*1024*1024)throw new IllegalStateException("世界日志所在盘不足 2 GiB 安全余量；没有世界写入");
            if(!Files.exists(root,LinkOption.NOFOLLOW_LINKS))Files.createDirectory(root);WorldPatchJournalFiles.directory(root);return AssemblyPatchJournal.create(root,plan);
        }catch(Exception e){throw new CompletionException(e);}
    }
    public static void cancel(MinecraftServer server,UUID player,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.player.equals(player)&&t.handle.id.equals(id)&&!terminal(t.handle.status.state)){t.cancelled=true;if(t.engine!=null)t.engine.cancel();}});}
    public static CompletableFuture<Operation> current(MinecraftServer server,UUID player){var result=new CompletableFuture<Operation>();server.execute(()->{try{thread(server);var user=server.getPlayerManager().getPlayer(player);if(server.isDedicated()||user==null||!user.isCreative()||!server.isHost(user.getGameProfile()))throw new IllegalStateException("仅允许当前单人创造房主查看原位事务");var t=TASKS.get(server);if(t!=null&&!t.player.equals(player))throw new IllegalStateException("不能读取其他玩家的事务");result.complete(t==null||!WorldOperationViewScope.currentDimension(t.plan.binding().selection().world().dimension(),user.getServerWorld().getRegistryKey().getValue().toString())?null:t.handle);}catch(Exception e){result.completeExceptionally(e);}});return result;}
    private static void close(Task t){if(!t.closed){t.closed=true;t.source.close();}}
    private static void finish(Task t,State state,int confirmed,String reason){t.handle.status=new Status(state,confirmed,t.plan.compiled().writes().size(),reason);close(t);t.handle.result.complete(new Result(state,confirmed,t.handle.status.total,t.plan.id().toString(),reason));}
    private static void tickTask(MinecraftServer server,Task t){
        if(terminal(t.handle.status.state))return;
        try{
            if(t.worker!=null){if(!t.worker.isDone()){if(System.nanoTime()-t.workerStarted>AssemblyPatchExecution.WAIT_TIMEOUT_NANOS)finish(t,State.REVIEW_REQUIRED,0,"初始日志回执超时；原磁盘操作可能仍在执行，不重发");return;}t.journal=t.worker.getNow(null);t.worker=null;t.engine=new AssemblyPatchExecution(new AssemblyPatchExecution.Disk(t.journal,DISK),t.source,64,2_000_000,System::nanoTime);if(t.cancelled)t.engine.cancel();}
            t.engine.step();var p=t.engine.progress();var mapped=switch(p.state()){case COMPLETED->State.COMPLETED;case CANCELLED->State.CANCELLED;case CONFLICT->State.CONFLICT;case REVIEW_REQUIRED->State.REVIEW_REQUIRED;case APPLYING->State.RUNNING;default->State.WAIT_LOG;};
            if(terminal(mapped))finish(t,mapped,p.confirmedWrites(),p.reason());else t.handle.status=new Status(mapped,p.confirmedWrites(),p.totalWrites(),p.reason());
        }catch(Exception e){finish(t,State.REVIEW_REQUIRED,t.engine==null?0:t.engine.progress().confirmedWrites(),"原事务无法继续；不自动重放："+root(e));}
    }
    public static void tick(MinecraftServer server){thread(server);reapPlans();var p=PREPARATIONS.get(server);if(p!=null)prepareTick(server,p);var t=TASKS.get(server);if(t!=null)tickTask(server,t);}
    public static void stopping(MinecraftServer server){
        thread(server);var p=PREPARATIONS.get(server);if(p!=null)discard(server,p,PrepareState.CANCELLED,"服务器正在关闭；未确认准备作废");var t=TASKS.remove(server);if(t==null)return;
        if(!terminal(t.handle.status.state)){if(t.engine!=null){t.engine.cancel();t.engine.step();}finish(t,State.REVIEW_REQUIRED,t.engine==null?0:t.engine.progress().confirmedWrites(),"服务器关闭时事务未完全封闭；原磁盘操作不取消、不重发，日志需审查");}else close(t);
    }
    private static String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private AssemblyPatchPlacementService(){}
}
