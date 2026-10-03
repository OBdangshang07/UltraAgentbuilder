package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Original-snapshot prose only. Polling is GET; observation needs its own
 * button confirmation. No submit, operation interpreter or world writer. */
final class ContextAnalysisResultScreen extends Screen {
    private final Screen parent;private final JsonObject reference;private JsonObject status;
    private int x,w,scroll,ticks;private long generation;private boolean busy;private final AtomicBoolean live=new AtomicBoolean();
    private List<net.minecraft.text.OrderedText> lines;private String message="只查询原任务；不重发模型";private StudioTheme.Button refresh,observe;
    ContextAnalysisResultScreen(Screen parent,JsonObject reference,JsonObject status){super(Text.literal("原选区分析结果 · 所有 AI 结论未验证"));this.parent=parent;this.reference=ContextAnalysisReceipt.verifyReference(reference.deepCopy());this.status=status==null?null:ContextAnalysisReceipt.verify(this.reference,status.deepCopy());}
    @Override protected void init(){
        live.set(true);generation++;busy=false;w=Math.min(600,width-24);x=(width-w)/2;
        addDrawableChild(new StudioTheme.Button(x+12,height-37,(w-32)/3,23,"返回",StudioTheme.Kind.NORMAL,this::close));
        refresh=addDrawableChild(new StudioTheme.Button(x+16+(w-32)/3,height-37,(w-32)/3,23,"查询原回执",StudioTheme.Kind.NORMAL,this::query));
        observe=addDrawableChild(new StudioTheme.Button(x+20+2*((w-32)/3),height-37,(w-32)/3,23,"观察原 turn",StudioTheme.Kind.NORMAL,this::confirmObserve));rebuild();if(status==null)query();
    }
    private void rebuild(){String details=status==null?"尚未取得原任务回执。这不证明模型未调用；不会重新发送。\n原任务 hash："+reference.get("requestHash").getAsString():ContextAnalysisReceipt.details(reference,status);
        lines=textRenderer.wrapLines(Text.literal(details),w-28);scroll=StudioLayout.clampScroll(scroll,lines.size()*14,height-123);buttons();}
    private void buttons(){refresh.active=!busy;observe.active=!busy&&status!=null&&status.get("state").getAsString().equals("unknown")&&status.get("canObserveOriginal").getAsBoolean();}
    private void query(){if(busy||!live.get())return;busy=true;buttons();long ticket=generation;
        StudioClient.BRIDGE.readContextAnalysis(reference).whenComplete((result,error)->client.execute(()->{
            if(ticket!=generation||!live.get()||client.currentScreen!=this)return;busy=false;
            if(error!=null){message="原回执查询失败/不存在；结果仍未确认，不重新生成";buttons();return;}
            status=result;message="原回执已核验；不是当前环境事实认证";rebuild();
        }));
    }
    private void confirmObserve(){
        if(!observe.active)return;
        client.setScreen(new ContextAnalysisObservationScreen(this,reference));
    }
    JsonObject statusForAudit(){return status==null?null:status.deepCopy();}
    @Override public void tick(){if(++ticks>=40){ticks=0;if(status!=null&&status.get("state").getAsString().equals("running"))query();}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,47,x+w-10,height-74);int y=49-scroll;for(var line:lines){d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-62,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-123);return true;}
    @Override public void removed(){live.set(false);generation++;}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
