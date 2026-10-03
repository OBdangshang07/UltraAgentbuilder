package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** Explicit read-only BEFORE audit. No SEND, world-write or recovery action. */
final class WorldPatchBeforeScreen extends Screen {
    private final Screen parent;private final WorldPatchPreview preview;private final WorldPatchPageState page=new WorldPatchPageState();
    private SelectionController.BeforeRun run;private boolean attempted,completed;private String message="点击前不开始读取；不调用模型、不修改世界";
    private int x,w,scroll;private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button check;
    WorldPatchBeforeScreen(Screen parent,WorldPatchPreview preview){super(Text.literal("原服务器 BEFORE · 只读校验"));this.parent=parent;this.preview=java.util.Objects.requireNonNull(preview);}
    private boolean valid(){return StudioClient.PATCH_PREVIEW.preview()==preview&&StudioClient.SELECTION.matchesPreview(preview.binding());}
    @Override protected void init(){
        page.enter();if(run!=null){cancelRun();message="页面重新布局，原校验已停止；返回后可显式重新打开";}
        w=Math.min(600,width-24);x=(width-w)/2;
        lines=textRenderer.wrapLines(Text.literal("把原候选绑定到服务器仍持有的同一份快照，逐格重新读取内层 W 和 C 内紧邻六个面。不会加载未知区块，也不读取 NBT 或容器内容。\n\n世界、选区、环境版本、区块实例或覆盖变化均拒绝旧候选；即使方块改动后恢复也不重新绑定。关闭或重新打开页面，不会让旧请求重新生效。\n\n通过仅代表本次读取与原事实一致，不是物理、通行或写入认证。实际应用仍需独立补丁安全校验、写入确认和可恢复事务；本页不提供建造按钮。\n\n原快照："+preview.binding().snapshotHash()+"\n原补丁："+preview.binding().patchHash()+"\n原投影："+preview.binding().previewHash()+"\n改动："+preview.totalWrites()+" 格，未声明格保持原状。"),w-28);
        addDrawableChild(new StudioTheme.Button(x+12,height-39,(w-30)/2,24,"返回 · 停止本次读取",StudioTheme.Kind.NORMAL,this::close));
        check=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-39,(w-30)/2,24,"确认只读 BEFORE 校验",StudioTheme.Kind.PRIMARY,this::start));buttons();
    }
    private void buttons(){if(check!=null)check.active=page.available()&&!attempted&&valid();}
    private void start(){
        if(attempted||!valid())return;long ticket=page.begin();if(ticket<0)return;attempted=true;message="绑定原服务器快照；没有模型调用或世界写入";buttons();
        var publication=page.publication();
        StudioClient.SELECTION.beforeCheck(preview,publication).whenComplete((value,error)->client.execute(()->{
            if(!publication.getAsBoolean()||client.currentScreen!=this){if(value!=null)value.cancel().run();page.finish(ticket);return;}
            if(error!=null){page.finish(ticket);message="未取得原服务器基线："+root(error)+"；没有重读替代快照";buttons();return;}
            run=value;
            run.handle().result().thenCompose(report->value.current().get()).whenComplete((report,failed)->client.execute(()->{
                if(!page.finish(ticket)||client.currentScreen!=this||!publication.getAsBoolean())return;
                if(failed!=null){message="BEFORE 未通过："+root(failed)+"；没有修改世界";buttons();return;}
                completed=true;var comparison=report.comparison();
                message="原事实一致："+comparison.checked()+" 格（已知 "+comparison.known()+" / 未知覆盖 "+comparison.unknown()+"）；仍无建造权限";buttons();
            }));
        }));
    }
    private static String root(Throwable error){while(error.getCause()!=null)error=error.getCause();return String.valueOf(error.getMessage());}
    private void cancelRun(){if(run!=null){run.cancel().run();run=null;}completed=false;}
    @Override public void tick(){
        if(!valid()){cancelRun();message="原环境或投影已失效；旧校验不能继续使用";buttons();return;}
        if(run!=null&&!completed){var status=run.handle().status();var p=status.progress();message=status.reason()+(p==null?"":" · "+p.checked()+"/"+p.total()+" 格");}
        buttons();
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-74);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-74)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-63,StudioTheme.WARN,false);super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){page.leave();cancelRun();}
    @Override public void close(){page.leave();cancelRun();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
