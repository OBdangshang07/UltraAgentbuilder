package dev.voxelstudio.client;

import dev.voxelstudio.selection.SelectionReadService;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.*;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** One distinct complete-task confirmation. Page lifetime gates only requests
 * not dispatched yet; the tick observer is independent of UI publication. */
final class ReferenceWorldAssemblySendScreen extends Screen {
    private final Screen parent;private final ReferenceWorldAssemblyPlan plan;
    private final Supplier<CompletableFuture<SelectionReadService.Capture>> capture;private final BooleanSupplier source;
    private final WorldPatchPageState page=new WorldPatchPageState();private final String world;
    private boolean attempted,capable,capabilityKnown;private volatile boolean choiceValid;private int x,w,scroll,ticks;
    private String message="仅准备渲染器心跳和查询完整协议；未调用模型";
    private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button send;
    ReferenceWorldAssemblySendScreen(Screen parent,ReferenceWorldAssemblyPlan plan,Supplier<CompletableFuture<SelectionReadService.Capture>> capture,BooleanSupplier source){
        super(Text.literal("完整联合制作 · 一次预算与隐私确认"));this.parent=parent;this.plan=plan;this.capture=capture;this.source=source;world=StudioScreen.referenceWorldScope();
    }
    private void choice(){choiceValid=StudioScreen.referenceAssemblyGenerationCurrent(plan.generation(),world);}
    private boolean live(){return page.live()&&choiceValid&&source.getAsBoolean();}
    @Override protected void init(){
        page.enter();choice();w=Math.min(650,width-24);x=(width-w)/2;lines=textRenderer.wrapLines(Text.literal(plan.details()),w-28);int part=(w-30)/2;
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-38,part,24,"返回 · 不发送",StudioTheme.Kind.NORMAL,this::close));
        send=addDrawableChild(new StudioTheme.Button(x+18+part,height-38,part,24,"确认 · 最多 "+number(plan.prepared(),"maximumCalls")+" 次",StudioTheme.Kind.PRIMARY,this::send));setInitialFocus(back);
        if(!attempted){capabilityKnown=false;capabilities();}buttons();
    }
    private void buttons(){if(send!=null)send.active=!attempted&&capable&&page.available()&&live();}
    private void capabilities(){capable=false;long ticket=page.begin();if(ticket<0)return;
        StudioNativeEvidence.ready().thenCompose(ignored->StudioClient.BRIDGE.referenceAssemblyCapabilities()).whenComplete((caps,error)->client.execute(()->{
            if(!page.finish(ticket)||client.currentScreen!=this)return;
            capabilityKnown=true;
            capable=error==null&&flag(caps,"sendingEnabled")&&flag(caps,"nativeRendererReady")&&text(caps,"runtimeHash").equals(text(plan.prepared(),"runtimeHash"));
            message=capable?"准确完整协议与渲染器可用；只有明确点击才启动整项任务":"完整联合协议未开放或原 runtime / renderer 不可用；未发送，不降级为旧流程";buttons();
        }));
    }
    private void send(){choice();if(attempted||!capable||!page.available()||!live())return;
        long ticket=page.begin();if(ticket<0)return;attempted=true;buttons();message="保存原完整 SEND 并核验原服务器快照；失败或未知不重发";
        var publication=page.publication();BooleanSupplier valid=()->publication.getAsBoolean()&&choiceValid&&source.getAsBoolean();var reference=plan.reference();
        StudioClient.ASSEMBLY.watch(reference,null);
        StudioClient.BRIDGE.sendReferenceAssembly(capture,plan,valid,(original,r)->StudioClient.SELECTION.retainReferenceAssemblySend(original,r,valid))
            .whenComplete((status,error)->client.execute(()->{
                // Even a closed/ resized panel must retain the original outcome
                // and service its next asset-only native request in client ticks.
                if(error==null)StudioClient.ASSEMBLY.watch(reference,status);else StudioClient.ASSEMBLY.refresh(reference);
                if(!page.finish(ticket)||client.currentScreen!=this)return;
                client.setScreen(new ReferenceWorldAssemblyResultScreen(parent,reference));
            }));
    }
    @Override public void tick(){choice();buttons();if(!live())message="原世界、选区、提示词、图片或制作设置已改变；未发请求停止，原历史保留";
        if(++ticks>=40){ticks=0;if(!attempted&&!capabilityKnown&&page.available()&&live())capabilities();}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-76);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-76)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-64,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){page.leave();}@Override public void close(){page.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
