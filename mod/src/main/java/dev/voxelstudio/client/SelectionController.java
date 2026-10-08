package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.hit.*;
import net.minecraft.util.math.*;
import net.minecraft.world.RaycastContext;
import org.joml.Matrix4f;
import org.joml.Vector4f;
import com.mojang.blaze3d.systems.RenderSystem;
import java.util.*;
import com.google.gson.JsonObject;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.gui.screen.Screen;

/** Independent read-only tool. Its transparent interaction screen consumes
 * mouse clicks, never routes them to mining/placing or projection actions. */
final class SelectionController {
    SelectionDraft draft;String message="进入单人创造世界后可选择环境";boolean visible=true;
    private MinecraftServer server;private UUID player;private String dimension;private long epoch,invalidationRevision=-1,readRevision=-1;private boolean resolving,identityAttempted;
    private SelectionReadService.Handle read;
    private String contextId;private JsonObject savedContext;private volatile long contextEpoch;private boolean contextBusy;
    private JsonObject preparedTask,confirmedTask,preparedPatch,frozenPatch;
    private Matrix4f inverse;private Vec3d camera;private Drag drag;
    private record Drag(SelectionRegion region,SelectionGizmo.Face face,double start,SelectionGizmo.Vector anchor,SelectionDraft.Target target,int protectionIndex){}
    private final VertexConsumerProvider.Immediate lines=VertexConsumerProvider.immediate(new BufferBuilder(16384));
    void tick(MinecraftClient c){
        var next=c.getServer();var user=c.player==null?null:c.player.getUuid();String dim=c.world==null?null:c.world.getRegistryKey().getValue().toString();
        if(next!=server||!Objects.equals(user,player)||!Objects.equals(dim,dimension)){
            cancel();server=next;player=user;dimension=dim;epoch++;draft=null;drag=null;inverse=null;resolving=false;invalidationRevision=-1;
            identityAttempted=false;message=next==null?"仅支持单人内置服务器；未读取远程服务器":"世界/维度已改变，旧选区与快照已清空";
        }
        if(server!=null&&player!=null&&draft==null&&!resolving&&!identityAttempted){
            resolving=identityAttempted=true;long ticket=epoch;
            SelectionReadService.identity(server,player).whenComplete((id,error)->c.execute(()->{if(ticket!=epoch)return;resolving=false;if(error!=null){message=root(error);return;}draft=new SelectionDraft(id);message="先选蓝色外层环境，再选橙色内层改造范围";}));
        }
        if(draft!=null&&draft.revision()!=invalidationRevision){clearContext();invalidationRevision=draft.revision();SelectionReadService.invalidate(server,player,invalidationRevision);}
        var status=readStatus();if(contextId!=null&&(status==null||status.state()!=SelectionReadService.State.READY)){clearContext();}
    }
    private String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    boolean ready(){return draft!=null;}
    void mutate(Runnable operation){try{if(draft==null)throw new IllegalStateException(message);long before=draft.revision();operation.run();if(before!=draft.revision())clearContext();message="选区已更新；不会修改世界，旧快照不能使用";}catch(Exception e){message=root(e);}}
    void first(SelectionRegion.Point point){mutate(()->draft.first(point));}
    void second(SelectionRegion.Point point){mutate(()->draft.second(point));}
    void target(SelectionDraft.Target target,int index){drag=null;mutate(()->draft.target(target,index));}
    void read(){
        try{
            if(draft==null)throw new IllegalStateException(message);
            var selection=draft.selection();cancel();readRevision=selection.revision();read=SelectionReadService.start(server,player,selection);message="正在只读扫描；未调用模型";
        }catch(Exception e){message=root(e);}
    }
    void cancel(){clearContext();if(read!=null&&server!=null)SelectionReadService.cancel(server,read.id());read=null;}
    private void discardContext(String id){if(id!=null)StudioClient.BRIDGE.request("POST","/v1/world-contexts/"+id+"/discard",null).exceptionally(e->null);}
    private void clearContext(){String old=contextId;contextEpoch++;contextId=null;savedContext=null;preparedTask=null;confirmedTask=null;preparedPatch=null;frozenPatch=null;contextBusy=false;discardContext(old);}
    boolean contextBusy(){return contextBusy;}
    /** Captured on the client thread. The volatile epoch invalidates before
     * release on any world/selection/context change; no replacement baseline. */
    java.util.function.BooleanSupplier referencePatchSourceGate(){long ticket=contextEpoch;boolean ready=!contextBusy&&read!=null&&savedContext!=null;return ()->ready&&ticket==contextEpoch;}
    JsonObject savedContext(){return savedContext==null?null:savedContext.deepCopy();}
    boolean matchesPreview(WorldPatchPreview.Binding binding){
        try{
            var status=readStatus();if(draft==null||savedContext==null||status==null||status.state()!=SelectionReadService.State.READY||!draft.selection().equals(binding.selection()))return false;
            var record=savedContext.getAsJsonObject("record");var identity=record.getAsJsonObject("identity");
            return record.get("snapshotHash").getAsString().equals(binding.snapshotHash())&&record.get("selectionHash").getAsString().equals(binding.selectionHash())&&identity.get("contextRevision").getAsLong()==binding.contextRevision();
        }catch(Exception incomplete){return false;}
    }
    JsonObject preparedTask(){return preparedTask==null?null:preparedTask.deepCopy();}
    JsonObject confirmedTask(){return confirmedTask==null?null:confirmedTask.deepCopy();}
    void saveContext(){
        if(contextBusy){message="快照保存/核验正在进行；可取消";return;}if(read==null){message="先读取环境再保存";return;}
        long ticket=++contextEpoch;String id=contextId=read.id();contextBusy=true;message="后台保存与校验，尚未发送模型";
        ContextPublication.checked(this::checkedCapture,StudioClient.BRIDGE::saveContext)
            .whenComplete((saved,error)->MinecraftClient.getInstance().execute(()->{
                if(ticket!=contextEpoch){discardContext(id);return;}contextBusy=false;
                if(error!=null){savedContext=null;message="保存未核验："+root(error)+"；可查询同一快照，不会调用模型";return;}
                savedContext=saved;message="本地快照与摘要已保存；没有发送模型，没有建造权限";
            }));
    }
    void showSummary(Screen parent){
        if(contextBusy){message="快照保存/核验正在进行";return;}if(read==null){message="先读取环境";return;}
        long ticket=++contextEpoch;String id=contextId=read.id();contextBusy=true;message="核验同一快照；不重发生成";
        ContextPublication.checked(this::checkedCapture,StudioClient.BRIDGE::readContext)
            .whenComplete((saved,error)->MinecraftClient.getInstance().execute(()->{
                if(ticket!=contextEpoch){discardContext(id);return;}contextBusy=false;
                if(error!=null){savedContext=null;message=root(error);return;}savedContext=saved;message="摘要已核验；未发送模型";
                var c=MinecraftClient.getInstance();if(c.currentScreen==parent)c.setScreen(new StudioInfoScreen(parent,"环境摘要 · 本地只读",ContextReceipt.details(saved)));
            }));
    }
    void retryIdentity(){identityAttempted=false;}
    void prepareTask(Screen parent,JsonObject intent){
        if(contextBusy||read==null||savedContext==null){message="先完成读取和本地保存/核验；未调用模型";return;}
        long ticket=++contextEpoch;contextBusy=true;preparedTask=null;confirmedTask=null;var exact=intent.deepCopy();
        message="后台核验具体任务与发送内容；没有模型调用";
        ContextPublication.checked(this::checkedCapture,cap->StudioClient.BRIDGE.prepareContextTask(cap,exact)).whenComplete((prepared,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}
            preparedTask=prepared;message="具体任务与披露已准备，尚未发送";var c=MinecraftClient.getInstance();
            if(c.currentScreen==parent)c.setScreen(new StudioInfoScreen(parent,"确认 AI 环境分析内容 · 尚不发送",ContextTaskReceipt.details(prepared),"确认内容 · 不调用",false,()->confirmTask(parent,prepared)));
        }));
    }
    private void confirmTask(Screen parent,JsonObject prepared){
        if(contextBusy||preparedTask!=prepared){message="任务内容已失效，请重新准备";return;}
        var intent=prepared.getAsJsonObject("request").getAsJsonObject("intent");
        try{var choice=StudioScreen.contextRecipient();for(var field:new String[]{"agent","model","effort"})if(!choice.get(field).equals(intent.get(field)))throw new IllegalStateException("模型/推理选择已改变，旧披露不可确认");}catch(Exception e){message=root(e);return;}
        var confirmationScreen=MinecraftClient.getInstance().currentScreen;
        long ticket=++contextEpoch;contextBusy=true;message="核验前后环境并保存本机确认；不调用模型";
        ContextPublication.checked(this::checkedCapture,cap->StudioClient.BRIDGE.confirmContextTask(cap,prepared)).whenComplete((receipt,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}
            confirmedTask=receipt;message="内容确认已绑定，5 分钟内有效；模型调用 0，发送需独立确认";
            var c=MinecraftClient.getInstance();if(c.currentScreen==confirmationScreen)c.setScreen(new StudioInfoScreen(parent,"本机内容确认 · 未发送",message+"\n\n确认 ID："+receipt.get("id").getAsString()+"\n\n没有建造权限，尚未生成改造方案。正常配套发送仍关闭；可以进入独立发送审核查看能力。","进入一次发送审核",false,()->openAnalysisSend(parent)));
        }));
    }
    void openAnalysisSend(Screen parent){
        try{if(contextBusy||preparedTask==null||confirmedTask==null)throw new IllegalStateException("先完成内容准备与本机确认");ContextTaskReceipt.verifyConsent(preparedTask,confirmedTask);
            long ticket=contextEpoch;MinecraftClient.getInstance().setScreen(new ContextAnalysisSendScreen(parent,preparedTask,confirmedTask,this::checkedCapture,()->ticket==contextEpoch));
        }catch(Exception error){message=root(error);}
    }
    void analysisAttempted(JsonObject prepared){
        if(preparedTask!=null&&preparedTask.get("requestHash").equals(prepared.get("requestHash")))message="已确认尝试一次只读分析；调用情况以原回执为准，失败不重发";
    }
    void preparePatch(Screen parent,JsonObject intent){
        if(contextBusy||read==null||savedContext==null){message="先完成环境读取及本地保存；未调用模型";return;}
        long ticket=++contextEpoch;contextBusy=true;preparedPatch=frozenPatch=null;var exact=intent.deepCopy();message="核验原位改造逐格披露；模型调用 0";
        ContextPublication.checked(this::checkedCapture,cap->StudioClient.BRIDGE.preparePatchTask(cap,exact)).whenComplete((prepared,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}preparedPatch=prepared;message="改造内容已核验，尚未冻结或发送";
            var c=MinecraftClient.getInstance();if(c.currentScreen==parent)c.setScreen(new WorldPatchReviewScreen(parent,prepared,()->confirmPatch(parent,prepared)));
        }));
    }
    private void confirmPatch(Screen parent,JsonObject prepared){
        if(contextBusy||preparedPatch!=prepared){message="原改造内容失效，请重新准备";return;}
        try{if(!StudioScreen.contextRecipient().equals(prepared.getAsJsonObject("task").getAsJsonObject("disclosure").get("recipient")))throw new IllegalStateException("模型或推理已改变；旧披露不能确认");}catch(Exception e){message=root(e);return;}
        long ticket=++contextEpoch;var page=MinecraftClient.getInstance().currentScreen;contextBusy=true;message="重新核验环境并冻结原内容；不调用模型";
        ContextPublication.checked(this::checkedCapture,cap->StudioClient.BRIDGE.freezePatchTask(cap,prepared)).whenComplete((frozen,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}frozenPatch=frozen;message="原改造内容已冻结，尚未发送；没有建造权限";
            var c=MinecraftClient.getInstance();if(c.currentScreen==page)c.setScreen(new StudioInfoScreen(parent,"原内容确认完成 · 未发送",message+"\n\n任务："+frozen.get("capsuleId").getAsString(),"独立审核一次发送",false,()->openPatchSend(parent)));
        }));
    }
    void openPatchSend(Screen parent){
        try{if(contextBusy||preparedPatch==null||frozenPatch==null)throw new IllegalStateException("先完成改造内容核验与冻结");WorldPatchTaskReceipt.verifyFrozen(preparedPatch,WorldPatchTaskReceipt.confirmation(preparedPatch),frozenPatch);
            long ticket=contextEpoch;MinecraftClient.getInstance().setScreen(new WorldPatchSendScreen(parent,preparedPatch,frozenPatch,this::checkedCapture,()->ticket==contextEpoch));
        }catch(Exception e){message=root(e);}
    }
    void prepareReferencePatch(Screen parent,JsonObject intent,JsonObject manifest,java.util.function.BooleanSupplier imagesCurrent){
        var source=referencePatchSourceGate();if(!source.getAsBoolean()||!imagesCurrent.getAsBoolean()){message="先保存准确环境和图片编辑；未调用模型";return;}
        var exact=intent.deepCopy();var pictures=manifest.deepCopy();var selected=new JsonObject();for(var k:List.of("agent","model","effort"))selected.add(k,exact.get(k));
        if(!referencePatchChoice(selected)){message="模型选择改变，请重新打开任务；未调用模型";return;}
        contextBusy=true;message="独立发现图像能力并核验联合逐格披露；模型调用 0";var capability=new java.util.concurrent.atomic.AtomicReference<JsonObject>();
        java.util.function.BooleanSupplier live=()->source.getAsBoolean()&&imagesCurrent.getAsBoolean();
        StudioClient.BRIDGE.referencePatchModel(selected).thenCompose(model->{
            WorldPatchSend.allowed(live);capability.set(model.deepCopy());return ContextPublication.checked(this::checkedCapture,cap->StudioClient.BRIDGE.prepareReferencePatchTask(cap,exact,pictures,model,live));
        }).whenComplete((prepared,error)->MinecraftClient.getInstance().execute(()->{
            if(!source.getAsBoolean())return;contextBusy=false;
            if(error!=null){message=root(error);return;}
            var c=MinecraftClient.getInstance();if(c.currentScreen!=parent||!live.getAsBoolean()||!referencePatchChoice(selected)){message="原页面/图片/模型改变；旧披露保留、未确认或发送";return;}
            message="联合内容已核验；没有模型调用";c.setScreen(new WorldPatchReviewScreen(parent,prepared,ReferenceWorldPatchTaskReceipt.details(prepared),
                ()->freezeReferencePatch(parent,prepared,pictures,capability.get(),live)));
        }));
    }
    private boolean referencePatchChoice(JsonObject selected){try{return selected.equals(StudioScreen.contextRecipient());}catch(Exception unavailable){return false;}}
    private void freezeReferencePatch(Screen parent,JsonObject prepared,JsonObject manifest,JsonObject capability,java.util.function.BooleanSupplier source){
        if(contextBusy||!source.getAsBoolean()){message="原图片或环境已失效，未冻结";return;}
        if(!referencePatchChoice(prepared.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonObject("recipient"))){message="模型已改变，旧联合披露不可确认";return;}
        var c=MinecraftClient.getInstance();var page=c.currentScreen;long ticket=contextEpoch;contextBusy=true;message="重新核验原环境并冻结联合内容；不调用模型";
        ContextPublication.checked(this::checkedCapture,cap->StudioClient.BRIDGE.freezeReferencePatchTask(cap,prepared,manifest,capability,source)).whenComplete((frozen,error)->c.execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}
            if(!source.getAsBoolean()||!referencePatchChoice(prepared.getAsJsonObject("task").getAsJsonObject("disclosure").getAsJsonObject("recipient"))){message="原图片、提示词或模型已变化；冻结记录保留，不发送";return;}
            message="准确原选区＋原图已冻结，尚未发送；完整档位与玩家发送后续接入";
            if(c.currentScreen==page)c.setScreen(new StudioInfoScreen(parent,"联合内容冻结完成 · 模型调用 0",message+"\n\n原内容身份："+frozen.get("capsuleId").getAsString()+"\n\n此页不提供 SEND 或世界写入权限，也不会自动转换成普通文字改造任务。"));
        }));
    }
    CompletableFuture<SelectionReadService.PatchRetention> retainPatchSend(SelectionReadService.Capture original,JsonObject reference,java.util.function.BooleanSupplier live){
        return retainPatchSend(original,reference,live,WorldPatchJobReceipt::retentionBinding);
    }
    CompletableFuture<SelectionReadService.PatchRetention> retainReferencePatchSend(SelectionReadService.Capture original,JsonObject reference,java.util.function.BooleanSupplier live){
        return retainPatchSend(original,reference,live,ReferenceWorldPatchJobReceipt::retentionBinding);
    }
    private CompletableFuture<SelectionReadService.PatchRetention> retainPatchSend(SelectionReadService.Capture original,JsonObject reference,java.util.function.BooleanSupplier live,
            java.util.function.BiFunction<SelectionReadService.Capture,JsonObject,SelectionReadService.PatchSendBinding> verify){
        var result=new CompletableFuture<SelectionReadService.PatchRetention>();var c=MinecraftClient.getInstance();var exact=reference.deepCopy();
        c.execute(()->{try{
            if(!live.getAsBoolean()||server==null||player==null||read==null||draft==null||!read.id().equals(original.id())||draft.revision()!=original.selection().revision())throw new IllegalStateException("原 SEND 页面、世界或选区已改变；不保留替代基线");
            var owner=server;var user=player;long worldTicket=epoch,contextTicket=contextEpoch;
            SelectionReadService.retainForPatchSend(owner,user,original,verify.apply(original,exact)).whenComplete((retention,error)->c.execute(()->{
                if(error!=null){result.completeExceptionally(error);return;}
                if(!live.getAsBoolean()||server!=owner||!Objects.equals(player,user)||epoch!=worldTicket||contextEpoch!=contextTicket){retention.releaseIfNotDispatched();result.completeExceptionally(new IllegalStateException("原 SEND 保留期间页面或环境改变；不发送"));return;}
                result.complete(retention);
            }));
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    void loadPatchPreview(Screen parent,JsonObject reference,JsonObject status,java.util.function.BooleanSupplier live){
        if(!live.getAsBoolean()){message="原预览页面已关闭；没有加载投影";return;}
        if(contextBusy){message="环境操作正在进行；没有加载预览";return;}
        final WorldPatchCandidateReceipt.Reference pin;try{pin=WorldPatchJobReceipt.candidate(reference,status);if(!matchesPreview(pin.binding()))throw new IllegalStateException("当前环境不匹配原任务，不能加载投影；历史仍保留");}catch(Exception e){message=root(e);return;}
        long ticket=contextEpoch;contextBusy=true;message="只读重开原候选，前后核验原快照；不会重发模型";
        ContextPublication.checkedValue(this::checkedCapture,cap->{
            if(!cap.selection().equals(pin.binding().selection())||cap.contextRevision()!=pin.binding().contextRevision())return CompletableFuture.failedFuture(new IllegalStateException("不能重新绑定原投影"));
            return StudioClient.BRIDGE.loadPatchCandidate(pin,()->ticket!=contextEpoch||!live.getAsBoolean());
        }).whenComplete((download,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}if(!matchesPreview(pin.binding())){message="加载期间环境改变，原候选不发布";return;}
            var c=MinecraftClient.getInstance();if(c.currentScreen!=parent||!live.getAsBoolean()){message="原候选已核验；页面关闭或重开，未开启投影，可显式再加载";return;}
            StudioClient.PATCH_PREVIEW.showAuditableReadOnly(download);message="原候选与差异投影已核验；尚未取得建造权限";c.setScreen(new WorldPatchPreviewScreen(parent));
        }));
    }
    /** Separate joint reference type and HTTP parser; only the checked,
     * original-coordinate candidate joins the common display/transaction data
     * path. It never changes the server's retained Capture or grants writes. */
    void loadReferencePatchPreview(Screen parent,ReferenceWorldPatchCandidateReceipt.Reference pin,java.util.function.BooleanSupplier live){
        if(!live.getAsBoolean()){message="原联合预览页面已关闭；没有加载投影";return;}
        if(contextBusy){message="环境操作正在进行；没有加载联合预览";return;}
        if(pin==null||!matchesPreview(pin.binding())){message="当前环境不匹配原联合候选；不能重新绑定投影";return;}
        long ticket=contextEpoch;contextBusy=true;message="只读核验联合原候选、图片身份与原快照；不会重发模型";
        ContextPublication.checkedValue(this::checkedCapture,cap->{
            if(!cap.selection().equals(pin.binding().selection())||cap.contextRevision()!=pin.binding().contextRevision())
                return CompletableFuture.failedFuture(new IllegalStateException("不能替换联合任务的原服务器快照"));
            return StudioClient.BRIDGE.loadReferencePatchCandidate(pin,()->ticket!=contextEpoch||!live.getAsBoolean());
        }).whenComplete((download,error)->MinecraftClient.getInstance().execute(()->{
            if(ticket!=contextEpoch)return;contextBusy=false;if(error!=null){message=root(error);return;}
            if(!matchesPreview(pin.binding())){message="加载期间原环境改变，联合候选不发布";return;}
            var c=MinecraftClient.getInstance();if(c.currentScreen!=parent||!live.getAsBoolean()){
                message="联合原候选已核验；页面已关闭或重开，未开启投影，可显式再加载";return;
            }
            StudioClient.PATCH_PREVIEW.showAuditableReadOnly(download);message="联合原候选与差异投影已核验；尚无建造权限";
            c.setScreen(new WorldPatchPreviewScreen(parent));
        }));
    }
    record BeforeRun(SelectionReadService.BeforeHandle handle,java.util.function.Supplier<CompletableFuture<SelectionReadService.BeforeReport>> current,Runnable cancel){}
    record PatchAuditRun(SelectionReadService.PatchAuditHandle handle,java.util.function.Supplier<CompletableFuture<SelectionReadService.PatchAuditReport>> current,Runnable cancel){}
    record PlacementRun(WorldPatchPlacementService.PrepareHandle handle,java.util.function.BiFunction<WorldPatchPlacementService.Confirmation,Boolean,CompletableFuture<WorldPatchPlacementService.Operation>> confirm,Runnable cancel){}
    CompletableFuture<PlacementRun> preparePlacement(WorldPatchCheckedCandidate candidate,java.util.function.BooleanSupplier live){
        var result=new CompletableFuture<PlacementRun>();var c=MinecraftClient.getInstance();var preview=candidate.preview();
        checkedCapture().whenComplete((capture,error)->c.execute(()->{
            if(error!=null){result.completeExceptionally(error);return;}if(!live.getAsBoolean()||!matchesPreview(preview.binding())||StudioClient.PATCH_PREVIEW.candidate()!=candidate||server==null||player==null){result.completeExceptionally(new IllegalStateException("原最终确认页面或候选已失效；没有写入"));return;}
            var owner=server;var user=player;long worldTicket=epoch,contextTicket=contextEpoch;var handle=WorldPatchPlacementService.prepare(owner,user,capture,preview,candidate.originalResponse(),candidate.originalResponseHash());
            java.util.function.BooleanSupplier valid=()->live.getAsBoolean()&&server==owner&&Objects.equals(player,user)&&epoch==worldTicket&&contextEpoch==contextTicket&&StudioClient.PATCH_PREVIEW.candidate()==candidate&&matchesPreview(preview.binding());
            java.util.function.BiFunction<WorldPatchPlacementService.Confirmation,Boolean,CompletableFuture<WorldPatchPlacementService.Operation>> confirm=(confirmation,ack)->{
                var accepted=new CompletableFuture<WorldPatchPlacementService.Operation>();c.execute(()->{if(!valid.getAsBoolean()||!Boolean.TRUE.equals(ack)){accepted.completeExceptionally(new IllegalStateException("缺少当前候选的明确确认或未验证提示确认"));return;}
                    WorldPatchPlacementService.confirm(owner,user,confirmation,true).whenComplete((operation,failed)->c.execute(()->{if(failed!=null)accepted.completeExceptionally(failed);else{if(server==owner&&Objects.equals(player,user)&&epoch==worldTicket)StudioClient.PATCH_PREVIEW.clear();accepted.complete(operation);}}));
                });return accepted;
            };
            result.complete(new PlacementRun(handle,confirm,()->WorldPatchPlacementService.cancelPreparation(owner,user,handle.id())));
        }));return result;
    }
    CompletableFuture<WorldPatchPlacementService.Operation> currentPatchOperation(){if(server==null||player==null)return CompletableFuture.failedFuture(new IllegalStateException("没有当前单人世界"));return WorldPatchPlacementService.current(server,player);}
    void cancelPatchOperation(WorldPatchPlacementService.Operation operation){if(server!=null&&player!=null)WorldPatchPlacementService.cancel(server,player,operation.id());}
    record UndoRun(WorldPatchUndoService.PrepareHandle handle,java.util.function.BiFunction<WorldPatchUndoService.Confirmation,Boolean,CompletableFuture<WorldPatchUndoService.Operation>> confirm,Runnable cancel){}
    CompletableFuture<UndoRun> preparePatchUndo(WorldPatchPlacementService.Operation parent,java.util.function.BooleanSupplier live){
        var c=MinecraftClient.getInstance();if(server==null||player==null||!live.getAsBoolean())return CompletableFuture.failedFuture(new IllegalStateException("缺少当前原事务的撤销页面"));
        var owner=server;var user=player;long worldTicket=epoch;var handle=WorldPatchUndoService.prepare(owner,user,parent);
        java.util.function.BiFunction<WorldPatchUndoService.Confirmation,Boolean,CompletableFuture<WorldPatchUndoService.Operation>> confirm=(confirmation,ack)->{
            if(!live.getAsBoolean()||server!=owner||!Objects.equals(player,user)||epoch!=worldTicket||!Boolean.TRUE.equals(ack))return CompletableFuture.failedFuture(new IllegalStateException("撤销页面、世界、玩家或保护提示确认已改变"));
            return WorldPatchUndoService.confirm(owner,user,confirmation,true);
        };return CompletableFuture.completedFuture(new UndoRun(handle,confirm,()->WorldPatchUndoService.cancelPreparation(owner,user,handle.id())));
    }
    CompletableFuture<WorldPatchUndoService.Operation> currentPatchUndo(){if(server==null||player==null)return CompletableFuture.failedFuture(new IllegalStateException("没有当前单人世界"));return WorldPatchUndoService.current(server,player);}
    void cancelPatchUndo(WorldPatchUndoService.Operation operation){if(server!=null&&player!=null)WorldPatchUndoService.cancel(server,player,operation.id());}
    CompletableFuture<PatchAuditRun> patchAudit(WorldPatchCheckedCandidate candidate,java.util.function.BooleanSupplier live){
        var result=new CompletableFuture<PatchAuditRun>();var c=MinecraftClient.getInstance();var preview=candidate.preview();
        checkedCapture().whenComplete((capture,error)->c.execute(()->{
            if(error!=null){result.completeExceptionally(error);return;}
            if(!live.getAsBoolean()||!matchesPreview(preview.binding())||StudioClient.PATCH_PREVIEW.candidate()!=candidate||server==null||player==null){result.completeExceptionally(new IllegalStateException("原核验页面或候选已失效，未开始核验"));return;}
            var owner=server;var user=player;long worldTicket=epoch,contextTicket=contextEpoch;
            var handle=SelectionReadService.startPatchAudit(owner,user,capture,preview,candidate.originalResponse(),candidate.originalResponseHash());
            java.util.function.BooleanSupplier valid=()->live.getAsBoolean()&&server==owner&&Objects.equals(player,user)&&epoch==worldTicket&&contextEpoch==contextTicket&&StudioClient.PATCH_PREVIEW.candidate()==candidate&&matchesPreview(preview.binding());
            java.util.function.Supplier<CompletableFuture<SelectionReadService.PatchAuditReport>> current=()->{
                var checked=new CompletableFuture<SelectionReadService.PatchAuditReport>();c.execute(()->{
                    if(!valid.getAsBoolean()){checked.completeExceptionally(new IllegalStateException("原核验页面、世界或环境已改变"));return;}
                    SelectionReadService.checkedPatchAuditReport(owner,user,capture,handle.id(),preview.binding()).whenComplete((report,failed)->c.execute(()->{
                        if(!valid.getAsBoolean()){checked.completeExceptionally(new IllegalStateException("原补丁核验已失效"));return;}
                        if(failed!=null)checked.completeExceptionally(failed);else checked.complete(report);
                    }));
                });return checked;
            };
            result.complete(new PatchAuditRun(handle,current,()->SelectionReadService.cancelPatchAudit(owner,handle.id())));
        }));return result;
    }
    /** Starts only an explicit read-only server comparison. This does not turn
     * projection approval into a patch write or a model retry. */
    CompletableFuture<BeforeRun> beforeCheck(WorldPatchPreview preview,java.util.function.BooleanSupplier live){
        var result=new CompletableFuture<BeforeRun>();var c=MinecraftClient.getInstance();
        checkedCapture().whenComplete((capture,error)->c.execute(()->{
            if(error!=null){result.completeExceptionally(error);return;}
            if(!live.getAsBoolean()||!matchesPreview(preview.binding())||StudioClient.PATCH_PREVIEW.preview()!=preview||server==null||player==null){result.completeExceptionally(new IllegalStateException("原 BEFORE 页面或投影已失效，未开始读取"));return;}
            var owner=server;var user=player;long worldTicket=epoch,contextTicket=contextEpoch;
            var handle=SelectionReadService.startBeforeCheck(owner,user,capture,preview);
            java.util.function.BooleanSupplier valid=()->live.getAsBoolean()&&server==owner&&Objects.equals(player,user)&&epoch==worldTicket&&contextEpoch==contextTicket&&StudioClient.PATCH_PREVIEW.preview()==preview&&matchesPreview(preview.binding());
            java.util.function.Supplier<CompletableFuture<SelectionReadService.BeforeReport>> current=()->{
                var checked=new CompletableFuture<SelectionReadService.BeforeReport>();c.execute(()->{
                    if(!valid.getAsBoolean()){checked.completeExceptionally(new IllegalStateException("原 BEFORE 页面、世界或环境已改变"));return;}
                    SelectionReadService.checkedBeforeReport(owner,user,capture,handle.id(),preview.binding()).whenComplete((report,failed)->c.execute(()->{
                        if(!valid.getAsBoolean()){checked.completeExceptionally(new IllegalStateException("BEFORE 回执返回时原页面或环境已失效"));return;}
                        if(failed!=null)checked.completeExceptionally(failed);else checked.complete(report);
                    }));
                });return checked;
            };
            result.complete(new BeforeRun(handle,current,()->SelectionReadService.cancelBeforeCheck(owner,handle.id())));
        }));return result;
    }
    SelectionReadService.Status readStatus(){return read==null||draft==null||readRevision!=draft.revision()?null:read.status();}
    String statusText(){
        if(contextBusy||savedContext!=null)return message;
        var status=readStatus();if(status==null)return message;
        var p=status.scan();return status.state()+" · "+(p==null?"":p.processed()+"/"+p.total()+" 格 · ")+status.reason();
    }
    java.util.concurrent.CompletableFuture<SelectionReadService.Capture> checkedCapture(){
        var result=new CompletableFuture<SelectionReadService.Capture>();var c=MinecraftClient.getInstance();
        // Transfer completions can be on the context lane. Capture all mutable
        // client identity on the client thread, and invalidate BEFORE releasing
        // a failed server fence to downstream UI callbacks.
        c.execute(()->{
            if(read==null||draft==null||server==null){result.completeExceptionally(new IllegalStateException("没有有效快照"));return;}
            var owner=server;var handle=read;long revision=draft.revision(),worldEpoch=epoch;var user=player;
            SelectionReadService.checkedCapture(owner,user,handle.id(),revision).whenComplete((capture,error)->c.execute(()->{
                boolean same=server==owner&&read==handle&&draft!=null&&draft.revision()==revision&&epoch==worldEpoch;
                if(!same){result.completeExceptionally(new IllegalStateException("快照核验期间世界/选区已改变"));return;}
                if(error!=null){clearContext();message=root(error);result.completeExceptionally(error);return;}
                result.complete(capture);
            }));
        });return result;
    }
    void close(){cancel();draft=null;drag=null;inverse=null;epoch++;}
    void render(Matrix4f view,Matrix4f projection,Vec3d position){
        camera=position;inverse=new Matrix4f(projection).mul(view).invert();
        if(!visible||draft==null)return;
        var stack=new MatrixStack();stack.multiplyPositionMatrix(view);
        RenderSystem.enableBlend();RenderSystem.defaultBlendFunc();RenderSystem.disableDepthTest();RenderSystem.depthMask(false);
        var vertices=lines.getBuffer(SelectionLineLayer.INSTANCE);
        box(stack,vertices,draft.context(),.2f,.65f,1f);box(stack,vertices,draft.edit(),1f,.6f,.15f);
        for(var p:draft.protectedRegions())box(stack,vertices,p,1f,.2f,.25f);
        if(draft.first()!=null){var p=draft.first();box(stack,vertices,SelectionRegion.corners(p,p),1f,1f,.4f);}
        lines.draw();
    }
    private void box(MatrixStack stack,VertexConsumer vertices,SelectionRegion r,float red,float green,float blue){if(r!=null)WorldRenderer.drawBox(stack,vertices,r.min().x()-camera.x,r.min().y()-camera.y,r.min().z()-camera.z,r.max().x()-camera.x,r.max().y()-camera.y,r.max().z()-camera.z,red,green,blue,.85f);}
    SelectionGizmo.Ray ray(double x,double y){
        var c=MinecraftClient.getInstance();if(inverse==null||camera==null)throw new IllegalStateException("等待世界画面完成");
        float nx=(float)(2*x/c.getWindow().getScaledWidth()-1),ny=(float)(1-2*y/c.getWindow().getScaledHeight());
        var near=new Vector4f(nx,ny,-1,1).mul(inverse);var far=new Vector4f(nx,ny,1,1).mul(inverse);
        if(Math.abs(near.w)<1e-8||Math.abs(far.w)<1e-8)throw new IllegalStateException("无法计算世界视线");
        var a=new SelectionGizmo.Vector(camera.x+near.x/near.w,camera.y+near.y/near.w,camera.z+near.z/near.w);
        var b=new SelectionGizmo.Vector(camera.x+far.x/far.w,camera.y+far.y/far.w,camera.z+far.z/far.w);
        return new SelectionGizmo.Ray(a,b.subtract(a));
    }
    SelectionRegion.Point point(double x,double y){
        var c=MinecraftClient.getInstance();if(c.world==null)throw new IllegalStateException("没有当前世界");
        var r=ray(x,y);var a=r.origin();var b=r.at(256);
        var hit=c.world.raycast(new RaycastContext(new Vec3d(a.x(),a.y(),a.z()),new Vec3d(b.x(),b.y(),b.z()),RaycastContext.ShapeType.OUTLINE,RaycastContext.FluidHandling.NONE,c.player));
        if(hit.getType()!=HitResult.Type.BLOCK)throw new IllegalStateException("视线未命中方块；可返回面板输入坐标");
        var p=hit.getBlockPos();return new SelectionRegion.Point(p.getX(),p.getY(),p.getZ());
    }
    boolean beginDrag(double x,double y){
        try{
            if(draft==null||draft.current()==null)throw new IllegalStateException("先完成当前范围的两点选择");
            var r=ray(x,y);var face=SelectionGizmo.hit(draft.current(),r,4096);if(face==null)throw new IllegalStateException("没有命中当前选区边界");
            var coordinate=SelectionGizmo.axisCoordinate(r,face.axis(),face.point());if(coordinate==null)throw new IllegalStateException("该方向与拖动轴平行，请从斜侧查看边界");
            drag=new Drag(draft.current(),face,coordinate,face.point(),draft.target(),draft.protectionIndex());message="拖动边界；整数吸附，不扩大其他范围";return true;
        }catch(Exception e){message=root(e);return false;}
    }
    void drag(double x,double y){
        if(drag==null||draft==null)return;
        try{
            if(draft.target()!=drag.target||draft.protectionIndex()!=drag.protectionIndex){drag=null;return;}
            var coordinate=SelectionGizmo.axisCoordinate(ray(x,y),drag.face.axis(),drag.anchor);if(coordinate==null)return;
            int value=SelectionGizmo.movedFace(drag.region,drag.face,drag.start,coordinate);
            if((drag.face.maximum()?draft.current().max():draft.current().min()).axis(drag.face.axis())==value)return;
            draft.region(drag.region.face(drag.face.axis(),drag.face.maximum(),value));message="边界已吸附整数格；不修改世界";
        }catch(Exception e){message=root(e);}
    }
    void endDrag(){drag=null;}
}
