package dev.voxelstudio.client;

import dev.voxelstudio.selection.WorldPatchPlacementService;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.*;

/** Independent final write consent. Preparation remains read-only and closing
 * or relayout revokes it. After the explicit APPLY click the operation has an
 * independent lifetime; closing progress does not stop it or repeat models. */
final class WorldPatchPlacementScreen extends Screen {
    private final Screen parent;private final WorldPatchCheckedCandidate candidate;private final WorldPatchPageState page=new WorldPatchPageState();
    private SelectionController.PlacementRun run;private WorldPatchPlacementService.Confirmation confirmation;private WorldPatchPlacementService.Operation operation;
    private boolean attempted,acknowledged,submitted;private int x,w,scroll;private List<net.minecraft.text.OrderedText> lines=List.of();
    private String message="先只读准备，成功后另行明确确认；此时不修改世界";private StudioTheme.Button prepare,ack,apply,stop;
    WorldPatchPlacementScreen(Screen parent,WorldPatchCheckedCandidate candidate){super(Text.literal("原位改造 · 独立最终确认"));this.parent=parent;this.candidate=Objects.requireNonNull(candidate);}
    private boolean original(){return StudioClient.PATCH_PREVIEW.candidate()==candidate&&StudioClient.SELECTION.matchesPreview(candidate.preview().binding());}
    @Override protected void init(){
        page.enter();if(run!=null&&!submitted){cancelPreparation();message="页面重新布局，原准备/确认已作废；返回后显式重新准备";}
        w=Math.min(640,width-24);x=(width-w)/2;
        prepare=addDrawableChild(new StudioTheme.Button(x+12,height-106,w-24,22,"准备原规则审核和 fresh BEFORE · 不写入",StudioTheme.Kind.NORMAL,this::prepare));
        ack=addDrawableChild(new StudioTheme.Button(x+12,height-80,(w-30)/2,22,"确认理解：物理/通行未验证",StudioTheme.Kind.NORMAL,()->{acknowledged=!acknowledged;ack.setMessage(Text.literal(acknowledged?"已理解未验证提示 · 点击取消":"确认理解：物理/通行未验证"));buttons();}));
        apply=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-80,(w-30)/2,22,"最终确认 · 原位应用完整原补丁",StudioTheme.Kind.PRIMARY,this::apply));
        stop=addDrawableChild(new StudioTheme.Button(x+12,height-54,(w-30)/2,22,"显式取消已确认事务",StudioTheme.Kind.NORMAL,()->{if(operation!=null)StudioClient.SELECTION.cancelPatchOperation(operation);}));
        addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-54,(w-30)/2,22,"返回 · 已确认任务会继续",StudioTheme.Kind.NORMAL,this::close));details();buttons();
    }
    private void details(){
        var binding=candidate.preview().binding();String summary=confirmation==null?"原候选 "+candidate.preview().totalWrites()+" 处明确修改":confirmation.summary().writes()+" 处修改：新增 "+confirmation.summary().adds()+" / 替换 "+confirmation.summary().replaces()+" / 明确删除 "+confirmation.summary().clears()+"；守卫 "+confirmation.summary().guards();
        lines=textRenderer.wrapLines(Text.literal(summary+"\n\n准备将使用服务器仍持有的同一 Capture，独立审核原响应和六向守卫，再逐 tick 对比 fresh BEFORE；准备本身不写入。成功后最终确认仅 45 秒有效，世界/选区/环境变化会拒绝，不自动重读或重绑。\n\n应用固定在原世界坐标，只修改原内层 W 减保护区 P。预览切层、显隐和差异过滤不会缩小实际补丁；最终应用的是完整原补丁。KEEP 和省略格保持不动。\n\n当前仅支持单人创造房主和允许的静态方块。原状态检查不是物理、通行或落盘证明；先确认理解未验证提示，再点最终应用。发生冲突会停止，不跳过后继续覆盖。崩溃/回执未知不会猜测恢复。\n\n明确确认后可返回游戏等待；关闭进度页不会取消已确认事务。要停止请用独立取消按钮，不调用模型、不重发原响应。\n\n原响应："+candidate.originalResponseHash()+"\n原补丁："+binding.patchHash()+"\n原投影："+binding.previewHash()),w-28);
    }
    private void buttons(){boolean ready=page.available()&&!submitted&&original();if(prepare!=null)prepare.active=ready&&!attempted;if(ack!=null)ack.active=ready&&confirmation!=null;if(apply!=null)apply.active=ready&&confirmation!=null&&acknowledged;if(stop!=null)stop.active=operation!=null&&!operation.result().isDone();}
    private void prepare(){
        if(attempted||!original())return;long ticket=page.begin();if(ticket<0)return;attempted=true;var publication=page.publication();message="开始只读审核原提案，然后复核 BEFORE";buttons();
        StudioClient.SELECTION.preparePlacement(candidate,publication).whenComplete((value,error)->client.execute(()->{
            if(!publication.getAsBoolean()||client.currentScreen!=this||!original()){if(value!=null)value.cancel().run();page.finish(ticket);return;}
            if(error!=null){page.finish(ticket);message=root(error)+"；没有世界写入";buttons();return;}run=value;
            value.handle().result().whenComplete((accepted,failed)->client.execute(()->{if(!page.finish(ticket)||client.currentScreen!=this||!publication.getAsBoolean()||!original()){value.cancel().run();return;}if(failed!=null){message=root(failed)+"；没有世界写入";}else{confirmation=accepted;message="原规则与 fresh BEFORE 一致；尚未应用，请独立最终确认";details();}buttons();}));
        }));
    }
    private void apply(){
        if(submitted||run==null||confirmation==null||!acknowledged||!original()||!page.available())return;submitted=true;message="已明确请求应用一次原补丁；等待服务器确认，不重发";buttons();
        run.confirm().apply(confirmation,true).whenComplete((accepted,error)->client.execute(()->{if(error!=null){message="最终确认未接受："+root(error)+"；不会自动重试";buttons();return;}operation=accepted;message=accepted.status().reason();if(client.currentScreen==this)buttons();}));
    }
    private static String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private void cancelPreparation(){if(run!=null){run.cancel().run();run=null;}confirmation=null;acknowledged=false;}
    @Override public void tick(){
        if(operation!=null){var s=operation.status();message=s.state()+" · "+s.confirmed()+"/"+s.total()+" · "+s.reason();}
        else if(!submitted&&!original()){cancelPreparation();message="原快照/候选已失效；没有写入";}
        else if(run!=null&&!submitted){message=run.handle().status().reason();if(run.handle().status().state()!=WorldPatchPlacementService.PrepareState.READY&&confirmation!=null)confirmation=null;}
        buttons();
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.enableScissor(x+10,48,x+w-10,height-143);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-143)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-135,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-195);return true;}
    @Override public void removed(){page.leave();if(!submitted)cancelPreparation();}
    @Override public void close(){page.leave();if(!submitted)cancelPreparation();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
