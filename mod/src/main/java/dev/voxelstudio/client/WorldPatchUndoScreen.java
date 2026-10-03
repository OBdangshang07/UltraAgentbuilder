package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.*;

/** Separate final undo consent. Merely opening, closing or resizing this page
 * cannot consume the original witness or restore any world state. */
final class WorldPatchUndoScreen extends Screen {
    private final Screen parent;private final WorldPatchPlacementService.Operation original;private final WorldPatchPageState page=new WorldPatchPageState();
    private SelectionController.UndoRun run;private WorldPatchUndoService.Confirmation confirmation;private WorldPatchUndoService.Operation operation;
    private boolean attempted,acknowledged,submitted;private int x,w,scroll;private List<net.minecraft.text.OrderedText> lines=List.of();
    private String message="先只读核验原封闭日志；不会自动撤销或调用模型";private StudioTheme.Button prepare,ack,apply,stop;
    WorldPatchUndoScreen(Screen parent,WorldPatchPlacementService.Operation original){super(Text.literal("原位事务 · 独立保护式撤销"));this.parent=parent;this.original=Objects.requireNonNull(original);}
    @Override protected void init(){page.enter();if(run!=null&&!submitted){cancelPreparation();message="页面重新布局，未提交的撤销准备作废；返回后可显式重新准备";}w=Math.min(640,width-24);x=(width-w)/2;
        prepare=addDrawableChild(new StudioTheme.Button(x+12,height-106,w-24,22,"只读核验原封闭事务 · 不撤销",StudioTheme.Kind.NORMAL,this::prepare));
        ack=addDrawableChild(new StudioTheme.Button(x+12,height-80,(w-30)/2,22,"理解：保留后改，落盘未验证",StudioTheme.Kind.NORMAL,()->{acknowledged=!acknowledged;ack.setMessage(Text.literal(acknowledged?"已理解保护提示 · 点击取消":"理解：保留后改，落盘未验证"));buttons();}));
        apply=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-80,(w-30)/2,22,"最终确认 · 保护式撤销一次",StudioTheme.Kind.PRIMARY,this::apply));
        stop=addDrawableChild(new StudioTheme.Button(x+12,height-54,(w-30)/2,22,"显式取消当前撤销",StudioTheme.Kind.NORMAL,()->{if(operation!=null)StudioClient.SELECTION.cancelPatchUndo(operation);}));
        addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-54,(w-30)/2,22,"返回 · 已确认撤销继续",StudioTheme.Kind.NORMAL,this::close));details();buttons();
    }
    private void details(){String count=confirmation==null?"以原 live 执行器封闭的确认前缀为准":confirmation.summary().confirmed()+" 处原确认修改；逆序逐格检查，不保证全部恢复";lines=textRenderer.wrapLines(Text.literal(count+"\n\n只允许当前服务器仍持有的最近原位事务，且结果明确、日志封闭。崩溃未知或历史磁盘审查结果不能创建撤销权限。准备不消耗原见证，成功后确认仅 45 秒有效。\n\n每格只在仍等于原记录 AFTER 且六向邻居安全时恢复原 BEFORE。玩家后改的目标和邻居会保留，分别计数；不会强制覆盖、不扩大选区、不以重读替换原基线。\n\n最终确认后，新的世界、权限、环境或区块变化会停止后续撤销。撤销自有写前日志；不重复派发未知操作，不证明世界落盘、物理或通行。\n\n关闭进度页不取消已明确确认的撤销，可在原位事务页重新查询。仅支持单人创造房主，不调用模型。\n\n原修改事务："+original.id()),w-28);}
    private void buttons(){boolean ready=page.available()&&!submitted;if(prepare!=null)prepare.active=ready&&!attempted;if(ack!=null)ack.active=ready&&confirmation!=null;if(apply!=null)apply.active=ready&&confirmation!=null&&acknowledged;if(stop!=null)stop.active=operation!=null&&!operation.result().isDone();}
    private void prepare(){if(attempted)return;long ticket=page.begin();if(ticket<0)return;attempted=true;var publication=page.publication();buttons();StudioClient.SELECTION.preparePatchUndo(original,publication).whenComplete((value,error)->client.execute(()->{
        if(!publication.getAsBoolean()||client.currentScreen!=this){if(value!=null)value.cancel().run();page.finish(ticket);return;}if(error!=null){page.finish(ticket);message=root(error);buttons();return;}run=value;
        value.handle().result().whenComplete((accepted,failed)->client.execute(()->{if(!page.finish(ticket)||client.currentScreen!=this||!publication.getAsBoolean()){value.cancel().run();return;}if(failed!=null)message=root(failed);else{confirmation=accepted;message="原日志已核验；尚未撤销，请独立最终确认";details();}buttons();}));
    }));}
    private void apply(){if(submitted||run==null||confirmation==null||!acknowledged||!page.available())return;submitted=true;message="只提交一次独立撤销确认；等待原服务器回执，不重发";buttons();run.confirm().apply(confirmation,true).whenComplete((accepted,error)->client.execute(()->{if(error!=null)message="撤销确认未接受："+root(error)+"；不会自动重试";else operation=accepted;if(client.currentScreen==this)buttons();}));}
    private static String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private void cancelPreparation(){if(run!=null){run.cancel().run();run=null;}confirmation=null;acknowledged=false;}
    @Override public void tick(){if(operation!=null){var s=operation.status();message=s.state()+" · 检查 "+s.evaluated()+"/"+s.total()+"，恢复 "+s.restored()+"，保留 "+s.preserved()+" · "+s.reason();}else if(run!=null&&!submitted){message=run.handle().status().reason();if(run.handle().status().state()!=WorldPatchUndoService.PrepareState.READY)confirmation=null;}buttons();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.enableScissor(x+10,48,x+w-10,height-143);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-143)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-135,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-195);return true;}
    @Override public void removed(){page.leave();if(!submitted)cancelPreparation();}
    @Override public void close(){page.leave();if(!submitted)cancelPreparation();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
