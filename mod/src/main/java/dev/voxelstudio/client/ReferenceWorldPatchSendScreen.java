package dev.voxelstudio.client;

import dev.voxelstudio.selection.SelectionReadService;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.*;

/** Explicit joint-only SEND. Never promotes legacy consent or silently detaches
 * pictures. Re-entry may query capabilities but cannot repeat a dispatch. */
final class ReferenceWorldPatchSendScreen extends Screen {
    private final Screen parent;private final ReferenceWorldPatchSendPlan plan;
    private final Supplier<CompletableFuture<SelectionReadService.Capture>> capture;private final BooleanSupplier source;
    private final WorldPatchPageState state=new WorldPatchPageState();private boolean attempted,capabilityKnown;
    private volatile boolean choiceValid=true;private String runtime,message="只查询准确模型能力，尚未发送";
    private int x,w,scroll,ticks;private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button send;
    ReferenceWorldPatchSendScreen(Screen parent,ReferenceWorldPatchSendPlan plan,Supplier<CompletableFuture<SelectionReadService.Capture>> capture,BooleanSupplier source){
        super(Text.literal("参考图＋选区 · 独立发送审核"));this.parent=parent;this.plan=plan;this.capture=capture;this.source=source;
    }
    private void choice(){try{choiceValid=plan.recipient().equals(StudioScreen.contextRecipient());}catch(Exception error){choiceValid=false;}}
    private boolean allowed(){return state.live()&&choiceValid&&source.getAsBoolean();}
    @Override protected void init(){
        state.enter();choice();w=Math.min(620,width-24);x=(width-w)/2;lines=textRenderer.wrapLines(Text.literal(plan.details()),w-28);
        int part=(w-30)/2;addDrawableChild(new StudioTheme.Button(x+12,height-38,part,24,"返回 · 不发送",StudioTheme.Kind.NORMAL,this::close));
        send=addDrawableChild(new StudioTheme.Button(x+18+part,height-38,part,24,"确认联合发送 1 次",StudioTheme.Kind.PRIMARY,this::send));
        if(!attempted){capabilityKnown=false;runtime=null;capabilities();}buttons();
    }
    private void capabilities(){long ticket=state.begin();if(ticket<0)return;
        StudioClient.BRIDGE.referencePatchModel(plan.recipient()).whenComplete((value,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;capabilityKnown=true;runtime=null;
            if(error!=null)message="联合协议未开放或能力查询失败；未发送、不更换模型";
            else try{runtime=plan.runtimeFor(value);message="准确原图像能力一致；明确点击后才发送一次";}catch(Exception changed){message="原能力或运行版本已改变；需重新准备内容，未发送";}
            buttons();
        }));
    }
    private void buttons(){if(send!=null)send.active=state.available()&&runtime!=null&&!attempted&&allowed();}
    private void send(){choice();if(attempted||runtime==null||!allowed())return;long ticket=state.begin();if(ticket<0)return;
        attempted=true;buttons();message="持久保存原联合引用并核验原快照；不重发";
        var page=state.publication();BooleanSupplier live=()->page.getAsBoolean()&&choiceValid&&source.getAsBoolean();
        StudioClient.BRIDGE.sendReferencePatch(capture,plan.prepared(),plan.frozen(),plan.manifest(),plan.capability(),runtime,live,
            (original,reference)->StudioClient.SELECTION.retainReferencePatchSend(original,reference,live)).whenComplete((result,error)->client.execute(()->{
                if(!state.finish(ticket)||client.currentScreen!=this)return;
                if(error!=null){message="未取得完整原回执；如已保存引用，只能在联合历史查询，不重新提交";buttons();return;}
                client.setScreen(new ReferenceWorldPatchResultScreen(parent,result.reference(),result.status()));
            }));
    }
    @Override public void tick(){choice();buttons();if(!allowed())message="原世界、选区、图片、提示词或模型已改变；停止未发请求，历史保留";
        if(++ticks>=40){ticks=0;if(!attempted&&!capabilityKnown&&allowed()&&state.available())capabilities();}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-76);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-76)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-64,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){state.leave();}@Override public void close(){state.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
