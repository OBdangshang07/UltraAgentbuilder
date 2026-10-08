package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** No SEND/retry/rebase route. Only explicit observation of a queryable original
 * provider turn; the same durable job owns any later original-response check. */
final class ReferenceWorldPatchObserveScreen extends Screen {
    private final Screen parent;private final JsonObject reference;private final WorldPatchPageState state=new WorldPatchPageState();
    private int x,w,scroll,ticks;private boolean queryable,queried,attempted;private String message="先只读查询原回执";
    private List<net.minecraft.text.OrderedText> lines;private StudioTheme.Button confirm;
    ReferenceWorldPatchObserveScreen(Screen parent,JsonObject reference){super(Text.literal("只观察联合原回合 · 独立确认"));this.parent=parent;this.reference=ReferenceWorldPatchJobReceipt.verifyReference(reference.deepCopy());}
    @Override protected void init(){state.enter();w=Math.min(600,width-24);x=(width-w)/2;
        lines=textRenderer.wrapLines(Text.literal("仅向原提供方查询这个任务已保存的原回合，不再次发送生成，不切换模型、不追加调用预算、不替换原回答或环境快照。\n\n查询超时、未知或本地停止都不允许自动重发。只有原闭合回执可使同一任务继续校验原回答，随后仍需显式加载原位预览和最终世界确认。\n\n模型："+reference.get("recipient")+"\n原任务："+reference.get("capsuleId")+"\n原图组："+reference.get("referenceSetHash")),w-28);
        int part=(w-30)/2;addDrawableChild(new StudioTheme.Button(x+12,height-38,part,24,"返回 · 不观察",StudioTheme.Kind.NORMAL,this::close));
        confirm=addDrawableChild(new StudioTheme.Button(x+18+part,height-38,part,24,"确认只观察原回合",StudioTheme.Kind.PRIMARY,this::observe));queryable=false;queried=false;buttons();if(!attempted)query();else message="原观察已经尝试；返回结果页只查询，不重发观察或生成";
    }
    private void buttons(){if(confirm!=null)confirm.active=state.available()&&queryable&&!attempted;}
    private void query(){long ticket=state.begin();if(ticket<0)return;buttons();
        StudioClient.BRIDGE.readReferencePatchJob(reference).whenComplete((status,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;
            queried=true;queryable=error==null&&status.get("state").getAsString().equals("unknown")&&status.get("canObserveOriginal").getAsBoolean();
            message=queryable?"已找到可查询的原回合；点击后才观察，不新生成":"原回合目前不可观察；返回结果页查询，不替代或重发";buttons();
        }));
    }
    private void observe(){if(attempted||!queryable||!state.available())return;long ticket=state.begin();if(ticket<0)return;
        attempted=true;buttons();message="查询原提供方回合；新增生成 0";var page=state.publication();
        StudioClient.BRIDGE.observeReferencePatch(reference,page).whenComplete((status,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;
            if(error!=null){message="未得到完整原观察回执；只能返回查询，同一次确认不会重发观察或生成";buttons();return;}
            client.setScreen(new ReferenceWorldPatchResultScreen(parent,reference,status));
        }));
    }
    @Override public void tick(){buttons();if(++ticks>=40){ticks=0;if(!attempted&&!queried&&state.available())query();}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-76);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-76)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-64,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){state.leave();}@Override public void close(){state.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
