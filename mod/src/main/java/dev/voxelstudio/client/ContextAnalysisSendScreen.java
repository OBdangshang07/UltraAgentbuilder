package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.*;
import dev.voxelstudio.selection.SelectionReadService;

/** Separate from preparation/content consent. Closing never queues a send or
 * reopens a late result. An already dispatched call is not undone by closing. */
final class ContextAnalysisSendScreen extends Screen {
    private final Screen parent;private final JsonObject prepared,consent,reference;
    private final Supplier<CompletableFuture<SelectionReadService.Capture>> capture;private final BooleanSupplier contextValid;
    private final AtomicBoolean live=new AtomicBoolean();private boolean attempted,enabled;private int x,w,scroll;private long generation;
    private String message="正在查询本机发送能力；没有模型调用";private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button send;
    ContextAnalysisSendScreen(Screen parent,JsonObject prepared,JsonObject consent,Supplier<CompletableFuture<SelectionReadService.Capture>> capture,BooleanSupplier contextValid){
        super(Text.literal("发送一次 AI 环境分析 · 最后确认"));this.parent=parent;this.prepared=prepared.deepCopy();this.consent=consent.deepCopy();this.capture=capture;this.contextValid=contextValid;
        reference=ContextAnalysisReceipt.reference(this.prepared);
    }
    private boolean allowed(){return live.get()&&contextValid.getAsBoolean();}
    @Override protected void init(){
        live.set(true);long ticket=++generation;enabled=false;w=Math.min(560,width-24);x=(width-w)/2;
        lines=textRenderer.wrapLines(Text.literal("你即将发送 1 次只读分析。发送前保存原任务引用；HTTP 超时或未知结果不重发。关闭页面只能阻止尚未发出的请求，不能撤回已发出的调用。\n\n只发送以下已审核的摘要、任务和协议；不发送完整逐格快照。结果仅针对原快照，未经事实验证，没有改造或建造权限。\n\n"+ContextTaskReceipt.details(prepared)),w-28);
        addDrawableChild(new StudioTheme.Button(x+12,height-38,(w-30)/2,24,"返回 · 不发送",StudioTheme.Kind.NORMAL,this::close));
        send=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-38,(w-30)/2,24,"发送一次 · 不自动纠错",StudioTheme.Kind.PRIMARY,this::send));send.active=false;
        StudioClient.BRIDGE.contextAnalysisEnabled().whenComplete((ready,error)->client.execute(()->{
            if(ticket!=generation||!live.get()||client.currentScreen!=this)return;enabled=error==null&&ready;
            message=error!=null?"能力查询失败；没有发送":ready?"内容已确认；点击后才发送一次":"本机配套尚未开放发送；没有模型调用";update();
        }));
    }
    private void update(){send.active=enabled&&!attempted&&allowed();}
    private void send(){
        if(attempted||!enabled||!allowed())return;
        try{
            var selected=StudioScreen.contextRecipient();var original=reference.getAsJsonObject("recipient");if(!selected.equals(original))throw new IllegalStateException("模型/推理选择已改变，请返回重新审核");
            ContextTaskReceipt.verifyConsent(prepared,consent);
        }catch(Exception error){message=error.getMessage();send.active=false;return;}
        attempted=true;update();StudioClient.SELECTION.analysisAttempted(prepared);message="保存原任务引用并重新核验环境；不自动重发";long ticket=generation;
        StudioClient.BRIDGE.sendContextAnalysis(capture,prepared,consent,this::allowed).whenComplete((status,error)->client.execute(()->{
            if(ticket!=generation||!live.get()||client.currentScreen!=this)return;
            if(error!=null){message="未取得完整回执；如已保存引用，只能到历史查询，不能重新发送";return;}
            client.setScreen(new ContextAnalysisResultScreen(parent,reference,status));
        }));
    }
    @Override public void tick(){update();if(!contextValid.getAsBoolean())message="环境/任务已失效；未发出的请求停止，原历史保留";}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-76);int y=50-scroll;for(var line:lines){d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-64,StudioTheme.WARN,false);super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){live.set(false);generation++;}
    @Override public void close(){live.set(false);client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
