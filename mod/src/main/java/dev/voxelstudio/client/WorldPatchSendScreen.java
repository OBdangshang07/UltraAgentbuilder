package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import dev.voxelstudio.selection.SelectionReadService;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.*;

/** Final independent SEND. Content confirmation is not this authorization. */
final class WorldPatchSendScreen extends Screen {
    private final Screen parent;private final JsonObject prepared,frozen,recipient;
    private final Supplier<CompletableFuture<SelectionReadService.Capture>> capture;private final BooleanSupplier contextValid;
    private final WorldPatchPageState state=new WorldPatchPageState();private boolean attempted,capabilityKnown;private volatile boolean selectionValid=true;
    private String runtime,message="查询本机改造能力；没有模型调用";private int x,w,scroll,ticks;
    private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button send;
    WorldPatchSendScreen(Screen parent,JsonObject prepared,JsonObject frozen,Supplier<CompletableFuture<SelectionReadService.Capture>> capture,BooleanSupplier contextValid){
        super(Text.literal("发送一次 AI 原位改造 · 最后确认"));this.parent=parent;this.prepared=prepared.deepCopy();this.frozen=frozen.deepCopy();this.capture=capture;this.contextValid=contextValid;
        WorldPatchTaskReceipt.verifyFrozen(this.prepared,WorldPatchTaskReceipt.confirmation(this.prepared),this.frozen);recipient=this.frozen.getAsJsonObject("recipient").deepCopy();
    }
    private boolean allowed(){return state.live()&&selectionValid&&contextValid.getAsBoolean();}
    private void checkChoice(){try{selectionValid=recipient.equals(StudioScreen.contextRecipient());}catch(Exception e){selectionValid=false;}}
    @Override protected void init(){
        state.enter();checkChoice();w=Math.min(600,width-24);x=(width-w)/2;
        lines=textRenderer.wrapLines(Text.literal("点击后最多调用原选定模型 1 次。将发送你已审核的逐格内层 W、外层六个邻接面、环境摘要、提示词和固定规则；其中包括方块状态与世界坐标，不含实体 NBT、容器内容或存档路径。\n\n先保存原任务引用，再核验当前环境并发送。关闭页面只能停止尚未发出的请求；已发送、超时或未知结果不会重发，只能查询历史。\n\n结果先做工程校验，再以原世界坐标预览。预览不是建造确认，本页没有世界写入权限。\n\n"+WorldPatchTaskReceipt.details(prepared)),w-28);
        addDrawableChild(new StudioTheme.Button(x+12,height-38,(w-30)/2,24,"返回 · 不发送",StudioTheme.Kind.NORMAL,this::close));
        send=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-38,(w-30)/2,24,"确认发送 1 次 · 不自动重试",StudioTheme.Kind.PRIMARY,this::send));
        if(!attempted){capabilityKnown=false;runtime=null;capabilities();}buttons();
    }
    private void capabilities(){long ticket=state.begin();if(ticket<0)return;
        StudioClient.BRIDGE.patchRuntime().whenComplete((value,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;capabilityKnown=true;runtime=error==null?value:null;
            message=error!=null?"能力查询失败；未发送，可返回后重新查询":runtime==null?"本机配套尚未开放改造发送；没有模型调用":"原内容已冻结；点击后才发送一次";buttons();
        }));
    }
    private void buttons(){if(send!=null)send.active=state.available()&&runtime!=null&&!attempted&&allowed();}
    private void send(){checkChoice();if(attempted||runtime==null||!allowed())return;long ticket=state.begin();if(ticket<0)return;
        attempted=true;buttons();message="保存原引用并核验环境；不自动补发";
        var page=state.publication();BooleanSupplier dispatchAllowed=()->page.getAsBoolean()&&selectionValid&&contextValid.getAsBoolean();
        StudioClient.BRIDGE.sendPatch(capture,prepared,frozen,runtime,dispatchAllowed,(original,reference)->StudioClient.SELECTION.retainPatchSend(original,reference,dispatchAllowed)).whenComplete((result,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;
            if(error!=null){message="未取得完整回执；原引用如已保存，只能到历史查询，不重新发送";buttons();return;}
            client.setScreen(new WorldPatchResultScreen(parent,result.reference(),result.status()));
        }));
    }
    @Override public void tick(){checkChoice();buttons();if(!allowed())message="世界、选区或模型已改变；未发出的请求停止，原历史保留";
        if(++ticks>=40){ticks=0;if(!attempted&&!capabilityKnown&&allowed()&&state.available())capabilities();}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-76);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-76)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-64,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){state.leave();}@Override public void close(){state.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
