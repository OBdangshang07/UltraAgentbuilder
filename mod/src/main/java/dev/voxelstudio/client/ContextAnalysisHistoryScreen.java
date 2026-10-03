package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.*;

/** Local original references only; loading this page never submits analysis. */
final class ContextAnalysisHistoryScreen extends Screen {
    private final Screen parent;private List<JsonObject> references=List.of();private int x,w,page;private long generation;private String message="读取本地原引用；不调用模型";
    ContextAnalysisHistoryScreen(Screen parent){super(Text.literal("原选区分析历史 · 只查询，不重发"));this.parent=parent;}
    @Override protected void init(){w=Math.min(590,width-24);x=(width-w)/2;long ticket=++generation;buttons();
        StudioClient.BRIDGE.contextAnalysisHistory().whenComplete((result,error)->client.execute(()->{
            if(ticket!=generation||client.currentScreen!=this)return;
            if(error!=null){message="历史引用未通过核验；保留文件，不采用、不删除或重发";return;}references=result;page=Math.min(page,Math.max(0,(references.size()-1)/rows()));message=references.isEmpty()?"暂无已保存原任务引用":"引用不证明已发送；查询失败或未知不能再次提交";buttons();
        }));
    }
    private int rows(){return Math.max(1,(height-145)/29);}
    private void buttons(){clearChildren();int count=rows();
        for(int i=page*count;i<Math.min(references.size(),(page+1)*count);i++){var reference=references.get(i).deepCopy();var recipient=reference.getAsJsonObject("recipient");String label=recipient.get("model").getAsString()+" · "+reference.getAsJsonObject("identity").get("dimension").getAsString()+" · "+reference.get("requestHash").getAsString().substring(0,12);
            addDrawableChild(new StudioTheme.Button(x+12,62+(i-page*count)*29,w-24,23,StudioTheme.fit(textRenderer,label,w-40),StudioTheme.Kind.NORMAL,()->client.setScreen(new ContextAnalysisResultScreen(this,reference,null))));}
        addDrawableChild(new StudioTheme.Button(x+12,height-39,(w-32)/3,24,"返回",StudioTheme.Kind.NORMAL,this::close));
        var previous=addDrawableChild(new StudioTheme.Button(x+16+(w-32)/3,height-39,(w-32)/3,24,"上一页",StudioTheme.Kind.NORMAL,()->{page--;buttons();}));previous.active=page>0;
        var next=addDrawableChild(new StudioTheme.Button(x+20+2*((w-32)/3),height-39,(w-32)/3,24,"下一页",StudioTheme.Kind.NORMAL,()->{page++;buttons();}));next.active=(page+1)*count<references.size();
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.drawText(textRenderer,"保留原快照绑定；环境变化后不自动移到新世界",x+12,44,StudioTheme.MUTED,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-63,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public void removed(){generation++;}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
