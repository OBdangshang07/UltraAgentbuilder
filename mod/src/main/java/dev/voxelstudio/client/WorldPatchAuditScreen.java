package dev.voxelstudio.client;

import dev.voxelstudio.selection.SelectionReadService;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** One explicit, read-only static audit. No SEND, world write or repair. */
final class WorldPatchAuditScreen extends Screen {
    private final Screen parent;private final WorldPatchCheckedCandidate candidate;
    private final WorldPatchPageState page=new WorldPatchPageState();
    private SelectionController.PatchAuditRun run;private boolean attempted,completed;
    private String message="点击前不开始核验；不调用模型、不修改世界";
    private int x,w,scroll;private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button check;
    WorldPatchAuditScreen(Screen parent,WorldPatchCheckedCandidate candidate){super(Text.literal("原服务器补丁规则 · 只读核验"));this.parent=parent;this.candidate=java.util.Objects.requireNonNull(candidate);}
    private boolean valid(){return StudioClient.PATCH_PREVIEW.candidate()==candidate&&StudioClient.SELECTION.matchesPreview(candidate.preview().binding());}
    @Override protected void init(){
        page.enter();if(run!=null){cancelRun();message="页面重新布局，原核验已停止；返回后可显式重新打开";}
        w=Math.min(600,width-24);x=(width-w)/2;
        lines=textRenderer.wrapLines(Text.literal("使用服务器仍持有的同一份原始 Capture，独立重建原提案的写集合与六向邻接守卫，不采用客户端下载的写入指令。\n\n检查内层 W、保护范围 P、已知原状态、明确 CLEAR、KEEP/省略保持不动、完整特殊方块状态和静态邻接政策。原 responseHash、patchHash、previewHash 必须一致，不能重新采样或替换原响应。\n\n本页不读取当前世界、不调用模型、不写入方块。通过不是 fresh BEFORE、物理/通行认证或最终写入授权；应用仍需独立最终确认，本页不提供建造按钮。\n\n原响应："+candidate.originalResponseHash()+"\n原补丁："+candidate.preview().binding().patchHash()+"\n原投影："+candidate.preview().binding().previewHash()),w-28);
        addDrawableChild(new StudioTheme.Button(x+12,height-39,(w-30)/2,24,"返回 · 停止本次核验",StudioTheme.Kind.NORMAL,this::close));
        check=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-39,(w-30)/2,24,"确认只读补丁核验",StudioTheme.Kind.PRIMARY,this::start));buttons();
    }
    private void buttons(){if(check!=null)check.active=page.available()&&!attempted&&valid();}
    private void start(){
        if(attempted||!valid())return;long ticket=page.begin();if(ticket<0)return;attempted=true;message="服务器后台重建原补丁；没有模型或世界写入";buttons();var publication=page.publication();
        StudioClient.SELECTION.patchAudit(candidate,publication).whenComplete((value,error)->client.execute(()->{
            if(!publication.getAsBoolean()||client.currentScreen!=this||!valid()){if(value!=null)value.cancel().run();page.finish(ticket);return;}
            if(error!=null){page.finish(ticket);message="未取得原服务器基线："+root(error);buttons();return;}run=value;
            run.handle().result().thenCompose(report->value.current().get()).whenComplete((report,failed)->client.execute(()->{
                if(!page.finish(ticket)||client.currentScreen!=this||!publication.getAsBoolean()||!valid())return;
                if(failed!=null){message="原补丁核验未通过："+root(failed)+"；没有修改世界";buttons();return;}
                completed=true;message="静态原补丁一致："+report.writes()+" 写入 / "+report.guards()+" 守卫；仍无建造权限";buttons();
            }));
        }));
    }
    private static String root(Throwable error){while(error.getCause()!=null)error=error.getCause();return String.valueOf(error.getMessage());}
    private void cancelRun(){if(run!=null){run.cancel().run();run=null;}completed=false;}
    @Override public void tick(){if(!valid()){cancelRun();message="原环境或候选已失效；旧核验不能使用";}else if(run!=null&&!completed)message=run.handle().status().reason();buttons();}
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
