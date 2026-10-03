package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** No substitute generation, runtime or recipient. Each recovery is explicit. */
final class WorldPatchRecoveryScreen extends Screen {
    private final Screen parent;private final JsonObject reference;private final boolean observe;private final WorldPatchPageState state=new WorldPatchPageState();
    private boolean attempted;private int x,w,scroll;private List<net.minecraft.text.OrderedText> lines;private String message="点击前不执行；不是重新生成";private StudioTheme.Button confirm;
    WorldPatchRecoveryScreen(Screen parent,JsonObject reference,boolean observe){super(Text.literal(observe?"确认只观察原模型 turn":"确认只重检完整原响应"));this.parent=parent;this.reference=WorldPatchJobReceipt.verifyReference(reference.deepCopy());this.observe=observe;}
    @Override protected void init(){state.enter();w=Math.min(560,width-24);x=(width-w)/2;
        String action=observe?"未知结果不等于未计费。这次仅观察持久记录中完整绑定的原 Codex turn；无完整绑定时保持未知，不改模型、不生成替代任务。":"只重新核验已保存的完整原响应与冻结输入，再做本地工程检查。不会调用模型纠错，也不拼接不完整响应。";
        lines=textRenderer.wrapLines(Text.literal(action+"\n\n原任务："+reference.get("capsuleId").getAsString()+"\n模型："+reference.getAsJsonObject("recipient").get("model").getAsString()+"\n\n关闭页面不会自动再次执行。结果只针对原快照，不授予世界写入权限。"),w-28);
        addDrawableChild(new StudioTheme.Button(x+12,height-39,(w-30)/2,24,"返回 · 不执行",StudioTheme.Kind.NORMAL,this::close));confirm=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-39,(w-30)/2,24,observe?"确认观察原 turn":"确认本地重检一次",StudioTheme.Kind.PRIMARY,this::recover));buttons();
    }
    private void buttons(){confirm.active=state.available()&&!attempted;}
    private void recover(){if(attempted)return;long ticket=state.begin();if(ticket<0)return;attempted=true;buttons();message=observe?"核验并观察原 turn；不会重新生成":"重检完整原响应；不会调用模型";
        StudioClient.BRIDGE.recoverPatch(reference,observe,state.publication()).whenComplete((status,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;if(error!=null){message="未取得核验回执；保留原结果，不自动再次执行";buttons();return;}client.setScreen(new WorldPatchResultScreen(parent,reference,status));
        }));
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-74);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-74)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-63,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-126);return true;}
    @Override public void removed(){state.leave();}@Override public void close(){state.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
