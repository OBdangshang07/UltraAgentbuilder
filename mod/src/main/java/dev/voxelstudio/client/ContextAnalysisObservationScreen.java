package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Separate observation acknowledgement. Never substitutes an agent/turn. */
final class ContextAnalysisObservationScreen extends Screen {
    private final Screen parent;private final JsonObject reference;private final AtomicBoolean live=new AtomicBoolean();private boolean attempted;private int x,w;private long generation;
    private List<net.minecraft.text.OrderedText> lines;private String message="点击前不会观察；这不是重新生成";
    ContextAnalysisObservationScreen(Screen parent,JsonObject reference){super(Text.literal("确认只观察原 Codex turn"));this.parent=parent;this.reference=reference.deepCopy();}
    @Override protected void init(){live.set(true);long ticket=++generation;w=Math.min(530,width-24);x=(width-w)/2;
        lines=textRenderer.wrapLines(Text.literal("结果未知不代表未计费。此操作只观察持久记录中完整绑定的原 turn，不提交新生成、不切换模型。没有可观察的原 turn 时保留未知，不调用替代模型。\n\n原任务："+reference.get("requestHash").getAsString()+"\n\n所有结论仍针对原快照；没有当前世界或建造权限。"),w-28);
        addDrawableChild(new StudioTheme.Button(x+12,height-39,(w-30)/2,24,"返回 · 不观察",StudioTheme.Kind.NORMAL,this::close));
        var button=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-39,(w-30)/2,24,"确认观察原 turn",StudioTheme.Kind.PRIMARY,()->{
            if(attempted||!live.get())return;attempted=true;message="核验并观察原 turn；不生成替代任务";
            StudioClient.BRIDGE.observeContextAnalysis(reference,live::get).whenComplete((status,error)->client.execute(()->{
                if(ticket!=generation||!live.get()||client.currentScreen!=this)return;
                if(error!=null){message="未取得原结果；保留未知，不自动再观察或生成";return;}client.setScreen(new ContextAnalysisResultScreen(parent,reference,status));
            }));
        }));button.active=!attempted;
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-74);int y=50;for(var line:lines){d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-63,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public void removed(){live.set(false);generation++;}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
