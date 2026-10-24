package dev.voxelstudio.selection;

import net.minecraft.server.MinecraftServer;
import net.minecraft.util.WorldSavePath;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Independent coupled final-confirmation gateway, never a legacy adapter.
 * Preparation is read-only. Only its opaque confirmed original lease creates
 * the native source, then the original grouped disk/core protocol writes.
 * UI/native protected undo and physical-save acceptance remain separate. */
public final class CoupledAssemblyPlacementService {
    public enum PrepareState { AUDIT,BEFORE,PREPARING_PLAN,READY,CANCELLED,FAILED }
    public record PrepareStatus(PrepareState state,String reason){}
    public record Summary(CoupledAssemblyBinding binding,int writes,int adds,int replaces,int clears,int groups){
        public boolean canAuthorizePlacement(){return false;}public boolean physicsVerified(){return false;}
    }
    public static final class Confirmation {
        private final Preparation owner;private final Summary summary;private final CoupledAssemblyConsent.Ticket ticket;
        private Confirmation(Preparation owner,Summary summary,CoupledAssemblyConsent.Ticket ticket){this.owner=owner;this.summary=summary;this.ticket=ticket;}
        public Summary summary(){return summary;}public String preparationId(){return owner.handle.id;}
    }
    public static final class PrepareHandle {
        private final String id=UUID.randomUUID().toString();private final CompletableFuture<Confirmation> result=new CompletableFuture<>();
        private volatile PrepareStatus status=new PrepareStatus(PrepareState.AUDIT,"原成组服务器审核；未写入世界");
        private PrepareHandle(){}public String id(){return id;}public CompletableFuture<Confirmation> result(){return result;}public PrepareStatus status(){return status;}
    }
    public enum State { PREPARING_LOG,RUNNING,WAIT_LOG,COMPLETED,CANCELLED,CONFLICT,REVIEW_REQUIRED,FAILED }
    public record Status(State state,int confirmed,int total,String reason){public boolean worldDurabilityVerified(){return false;}}
    public record Result(State state,int confirmed,int total,String journalId,String reason){public boolean worldDurabilityVerified(){return false;}}
    public static final class Operation {
        private final String id=UUID.randomUUID().toString();private final UUID player;private final CompletableFuture<Result> result=new CompletableFuture<>();private volatile Status status;
        private Operation(UUID player,int total){this.player=player;status=new Status(State.PREPARING_LOG,0,total,"已明确确认原成组；等待原始分组写前日志");}
        public String id(){return id;}public Status status(){return status;}public CompletableFuture<Result> result(){return result;}
    }
    private static final Map<MinecraftServer,Preparation> PREPARATIONS=new HashMap<>();
    private static final Map<MinecraftServer,AssemblyPlanPreparation<?>> RETIRING_PLANS=new HashMap<>();
    private static final Map<MinecraftServer,Task> TASKS=new HashMap<>();
    private static final ExecutorService PLAN=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new SynchronousQueue<>(),r->{var t=new Thread(r,"voxel-coupled-plan");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final ThreadPoolExecutor DISK=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r->{var t=new Thread(r,"voxel-coupled-journal");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private static final class Preparation {
        UUID player;PrepareHandle handle;SelectionReadService.Capture original;CoupledAssemblyInput input;CoupledAssemblyPreview preview;
        SelectionReadService.CoupledAuditHandle audit;SelectionReadService.CoupledBeforeHandle before;SelectionReadService.CoupledNativeLease lease;
        AssemblyPlanPreparation<Prepared> worker;Prepared prepared;Confirmation confirmation;
    }
    private record Prepared(CoupledAssemblyJournal.Plan plan,Summary summary){}
    private static final class Task {
        UUID player;Operation handle;CoupledAssemblyJournal.Plan plan;SelectionReadService.CoupledNativeWorld world;CoupledAssemblyNativeSource source;
        CompletableFuture<CoupledAssemblyJournal.Live> worker;CoupledAssemblyJournal.Live journal;CoupledAssemblyExecution engine;long workerStarted;boolean cancelled,closed;
    }
    private static void thread(MinecraftServer server){if(!server.isOnThread())throw new IllegalStateException("Coupled gateway requires original server thread");}
    private static boolean terminal(State state){return Set.of(State.COMPLETED,State.CANCELLED,State.CONFLICT,State.REVIEW_REQUIRED,State.FAILED).contains(state);}
    static State mapped(CoupledAssemblyExecution.State state){return switch(Objects.requireNonNull(state)){case COMPLETED->State.COMPLETED;case CANCELLED->State.CANCELLED;case CONFLICT->State.CONFLICT;case REVIEW_REQUIRED->State.REVIEW_REQUIRED;case APPLYING->State.RUNNING;default->State.WAIT_LOG;};}
    private static void reapPlans(){RETIRING_PLANS.entrySet().removeIf(e->e.getValue().closed());}
    private static boolean diskBusy(){return DISK.getActiveCount()!=0||!DISK.getQueue().isEmpty();}
    /** Leaf only: no policy recursion, new Capture, world reads or waits. */
    public static boolean busy(MinecraftServer server){thread(server);reapPlans();var t=TASKS.get(server);return RETIRING_PLANS.containsKey(server)||PREPARATIONS.containsKey(server)||t!=null&&!terminal(t.handle.status.state)||diskBusy();}
    private static void idle(MinecraftServer server){
        WorldOperationExclusion.require(server,WorldOperationExclusion.Kind.COUPLED_ASSEMBLY);reapPlans();var t=TASKS.get(server);
        if(RETIRING_PLANS.containsKey(server)||t!=null&&!terminal(t.handle.status.state)||diskBusy())throw new IllegalStateException("已有原成组事务或原 CPU/磁盘操作未封闭；不替换或重发");
    }
    public static PrepareHandle prepare(MinecraftServer server,UUID player,SelectionReadService.Capture original,CoupledAssemblyPreview preview,CoupledAssemblyInput input){
        Objects.requireNonNull(server);Objects.requireNonNull(player);Objects.requireNonNull(original);Objects.requireNonNull(preview);Objects.requireNonNull(input);
        var handle=new PrepareHandle();handle.result.whenComplete((v,e)->{if(handle.result.isCancelled())cancelPreparation(server,player,handle.id);});
        server.execute(()->{try{thread(server);idle(server);if(handle.result.isCancelled())throw new IllegalStateException("成组准备已取消");
            if(PREPARATIONS.containsKey(server)||SelectionReadService.coupledAuditActive(server)||!preview.fromOriginalInput(input))throw new IllegalStateException("已有原审核/准备，或不是同一原完整预览；不接管");
            var p=new Preparation();p.player=player;p.handle=handle;p.original=original;p.input=input;p.preview=preview;
            p.audit=SelectionReadService.startCoupledAssemblyAudit(server,player,original,input);PREPARATIONS.put(server,p);
        }catch(Exception e){handle.status=new PrepareStatus(PrepareState.FAILED,root(e));handle.result.completeExceptionally(e);}});return handle;
    }
    public static void cancelPreparation(MinecraftServer server,UUID player,String id){server.execute(()->{var p=PREPARATIONS.get(server);if(p!=null&&p.player.equals(player)&&p.handle.id.equals(id))discard(server,p,PrepareState.CANCELLED,"原成组最终确认准备已取消；未写入世界");});}
    private static void discard(MinecraftServer server,Preparation p,PrepareState state,String reason){
        if(PREPARATIONS.get(server)!=p)return;PREPARATIONS.remove(server,p);if(p.confirmation!=null)CoupledAssemblyConsent.revoke(p.confirmation.ticket,p);
        if(p.audit!=null)SelectionReadService.cancelCoupledAssemblyAudit(server,p.audit.id());if(p.before!=null)SelectionReadService.cancelCoupledAssemblyBeforeCheck(server,p.before.id());
        if(p.worker!=null){p.worker.cancel();if(!p.worker.closed())RETIRING_PLANS.put(server,p.worker);}
        p.lease=null;p.original=null;p.input=null;p.preview=null;p.prepared=null;p.worker=null;p.handle.status=new PrepareStatus(state,reason);p.handle.result.completeExceptionally(new IllegalStateException(reason));
    }
    private static Prepared prepared(SelectionReadService.CoupledNativeLease lease,UUID player,java.util.function.BooleanSupplier cancelled){
        var plan=lease.prepare(player,cancelled);
        if(plan.compiled()!=lease.compiled()||!plan.compiled().fromOriginalInput(lease.input())||!plan.binding().equals(lease.input().binding()))throw new IllegalStateException("原成组日志方案替换了服务器核验或原输入");
        int adds=0,replaces=0,clears=0,count=0;for(var row:plan.compiled().writes()){
            if((count++&1023)==0)WorldPatchJson.cancelled(cancelled);switch(row.difference()){case "added"->adds++;case "removed"->clears++;case "replaced"->replaces++;default->throw new IllegalStateException("Original coupled difference category changed");}
        }
        return new Prepared(plan,new Summary(plan.binding(),plan.compiled().writes().size(),adds,replaces,clears,plan.compiled().groups().size()));
    }
    private static void prepareTick(MinecraftServer server,Preparation p){
        try{
            if(p.handle.result.isCancelled()){discard(server,p,PrepareState.CANCELLED,"原成组准备已取消");return;}
            switch(p.handle.status.state){
                case AUDIT->{if(!p.audit.result().isDone()){p.handle.status=new PrepareStatus(PrepareState.AUDIT,p.audit.status().reason());return;}p.audit.result().getNow(null);p.before=SelectionReadService.startCoupledAssemblyBeforeCheck(server,p.player,p.original,p.preview,p.audit.id());p.handle.status=new PrepareStatus(PrepareState.BEFORE,"原审核通过；完整逐 tick fresh BEFORE");}
                case BEFORE->{if(!p.before.result().isDone()){p.handle.status=new PrepareStatus(PrepareState.BEFORE,p.before.status().reason());return;}p.before.result().getNow(null);
                    p.lease=SelectionReadService.coupledNativeLease(server,p.player,p.original,p.preview,p.audit.id(),p.before.id(),p);var lease=p.lease;var player=p.player;
                    p.worker=AssemblyPlanPreparation.start(PLAN,System::nanoTime,cancelled->prepared(lease,player,cancelled));p.handle.status=new PrepareStatus(PrepareState.PREPARING_PLAN,"后台校验原完整成组日志方案；未写入世界");}
                case PREPARING_PLAN->{p.worker.check();if(!p.worker.closed())return;var value=p.worker.value();p.lease.current(server,p.player);p.prepared=value;
                    var ticket=CoupledAssemblyConsent.issue(p,p.player,value.plan.binding(),CoupledAssemblyConsent.Purpose.APPLY,System.nanoTime());
                    p.confirmation=new Confirmation(p,value.summary,ticket);p.worker=null;p.handle.status=new PrepareStatus(PrepareState.READY,"原规则及 fresh BEFORE 一致；45 秒内单独确认整组应用（物理/通行未验证）");p.handle.result.complete(p.confirmation);}
                case READY->{p.lease.current(server,p.player);if(!CoupledAssemblyConsent.available(p.confirmation.ticket,p,p.player,p.prepared.plan.binding(),CoupledAssemblyConsent.Purpose.APPLY,System.nanoTime()))throw new IllegalStateException("原成组最终确认失效；不继续写入或补发");}
                default->{}
            }
        }catch(Exception e){discard(server,p,PrepareState.FAILED,root(e));}
    }
    /** Only explicit UI confirmation reaches this path. NativeLease consumes
     * the one APPLY ticket itself; do NOT consume it twice in this service. */
    public static CompletableFuture<Operation> confirm(MinecraftServer server,UUID player,Confirmation confirmation,boolean unverifiedSafetyAcknowledged){
        var result=new CompletableFuture<Operation>();server.execute(()->{Task t=null;try{thread(server);if(result.isCancelled())throw new CancellationException("原成组确认请求已取消；不移交来源或创建日志");idle(server);Objects.requireNonNull(confirmation);var p=PREPARATIONS.get(server);
            if(p==null||p!=confirmation.owner||p.confirmation!=confirmation||!p.player.equals(player)||p.handle.status.state!=PrepareState.READY||!unverifiedSafetyAcknowledged)throw new IllegalStateException("缺少原成组独立最终确认及物理/通行未验证提示确认");
            p.lease.current(server,player);if(p.prepared.plan.compiled()!=p.lease.compiled())throw new IllegalStateException("原服务器核验被替换");
            t=new Task();t.player=player;t.plan=p.prepared.plan;t.handle=new Operation(player,t.plan.binding().totalWrites());
            t.world=p.lease.detach(server,player,confirmation.ticket);t.source=new CoupledAssemblyNativeSource(server,t.world);
            PREPARATIONS.remove(server,p);p.handle.status=new PrepareStatus(PrepareState.CANCELLED,"原成组确认已移交实际事务");p.lease=null;p.original=null;p.input=null;p.preview=null;p.prepared=null;
            var plan=t.plan;var directory=server.getSavePath(WorldSavePath.ROOT).resolve("voxel-studio-coupled-assembly-journals").toAbsolutePath().normalize();
            t.worker=CompletableFuture.supplyAsync(()->createJournal(directory,plan),DISK);t.workerStarted=System.nanoTime();TASKS.put(server,t);
            var operation=t.handle;operation.result.whenComplete((v,e)->{if(operation.result.isCancelled())cancel(server,player,operation.id);});result.complete(operation);
        }catch(Exception e){if(t!=null&&t.source!=null)t.source.close();else if(t!=null&&t.world!=null)t.world.watch.close();var p=PREPARATIONS.get(server);if(p!=null&&confirmation!=null&&p==confirmation.owner)discard(server,p,PrepareState.FAILED,root(e));result.completeExceptionally(e);}});return result;
    }
    private static CoupledAssemblyJournal.Live createJournal(Path directory,CoupledAssemblyJournal.Plan plan){
        try{WorldPatchJournalFiles.directory(directory.getParent());if(Files.getFileStore(directory.getParent()).getUsableSpace()<2L*1024*1024*1024)throw new IllegalStateException("成组日志盘不足 2 GiB 安全余量；没有世界写入");
            if(!Files.exists(directory,LinkOption.NOFOLLOW_LINKS))Files.createDirectory(directory);WorldPatchJournalFiles.directory(directory);return CoupledAssemblyJournal.create(directory,plan);
        }catch(Exception e){throw new CompletionException(e);}
    }
    public static void cancel(MinecraftServer server,UUID player,String id){server.execute(()->{var t=TASKS.get(server);if(t!=null&&t.player.equals(player)&&t.handle.id.equals(id)&&!terminal(t.handle.status.state)){t.cancelled=true;if(t.engine!=null)t.engine.cancel();}});}
    public static CompletableFuture<Operation> current(MinecraftServer server,UUID player){
        var result=new CompletableFuture<Operation>();server.execute(()->{try{thread(server);var user=server.getPlayerManager().getPlayer(player);
            if(server.isDedicated()||user==null||!user.isCreative()||!server.isHost(user.getGameProfile()))throw new IllegalStateException("仅允许当前单人创造房主查看原成组事务");
            var t=TASKS.get(server);if(t!=null&&!t.player.equals(player))throw new IllegalStateException("不能读取其他玩家成组事务");
            result.complete(t==null||!WorldOperationViewScope.currentDimension(t.plan.binding().selection().world().dimension(),user.getServerWorld().getRegistryKey().getValue().toString())?null:t.handle);
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    private static void close(Task t){if(!t.closed){t.closed=true;t.source.close();}}
    private static void finish(Task t,State state,int confirmed,String reason){t.handle.status=new Status(state,confirmed,t.plan.binding().totalWrites(),reason);close(t);t.handle.result.complete(new Result(state,confirmed,t.handle.status.total,t.plan.id().toString(),reason));}
    private static void tickTask(Task t){
        if(terminal(t.handle.status.state))return;try{
            if(t.worker!=null){if(!t.worker.isDone()){if(System.nanoTime()-t.workerStarted>CoupledAssemblyExecution.WAIT_TIMEOUT_NANOS)finish(t,State.REVIEW_REQUIRED,0,"原成组初始日志回执未知；不重发原磁盘操作");return;}
                t.journal=t.worker.getNow(null);t.worker=null;t.engine=new CoupledAssemblyExecution(new CoupledAssemblyExecution.Disk(t.journal,DISK),t.source,64,2_000_000,System::nanoTime);if(t.cancelled)t.engine.cancel();}
            var progress=t.engine.step();var state=mapped(progress.state());
            if(terminal(state))finish(t,state,progress.confirmedWrites(),progress.reason());else t.handle.status=new Status(state,progress.confirmedWrites(),progress.totalWrites(),progress.reason());
        }catch(Exception e){finish(t,State.REVIEW_REQUIRED,t.engine==null?0:t.engine.progress().confirmedWrites(),"原成组无法继续；不重放："+root(e));}
    }
    public static void tick(MinecraftServer server){thread(server);reapPlans();var p=PREPARATIONS.get(server);if(p!=null)prepareTick(server,p);var t=TASKS.get(server);if(t!=null)tickTask(t);}
    public static void stopping(MinecraftServer server){
        thread(server);var p=PREPARATIONS.get(server);if(p!=null)discard(server,p,PrepareState.CANCELLED,"原服务器正在关闭；未确认成组准备作废");var t=TASKS.remove(server);if(t==null)return;
        if(!terminal(t.handle.status.state)){if(t.engine!=null){t.engine.cancel();t.engine.step();}finish(t,State.REVIEW_REQUIRED,t.engine==null?0:t.engine.progress().confirmedWrites(),"关闭时成组事务未完全封闭；原磁盘操作不取消、不重发，日志需审查");}else close(t);
    }
    private static String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private CoupledAssemblyPlacementService(){}
}
