package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** Local immutable original references. This screen cannot submit models. */
final class WorldPatchHistoryScreen extends Screen {
    private final Screen parent;private final WorldPatchPageState state=new WorldPatchPageState();private List<JsonObject> references=List.of();
    private int x,w,page;private String message="读取本地原任务引用；不调用模型";private StudioTheme.Button reload;
    WorldPatchHistoryScreen(Screen parent){super(Text.literal("原位改造历史 · 只查询，不重发"));this.parent=parent;}
    @Override protected void init(){state.enter();w=Math.min(600,width-24);x=(width-w)/2;buttons();load();}
    private int rows(){return Math.max(1,(height-164)/29);}
    private void load(){long ticket=state.begin();if(ticket<0)return;if(reload!=null)reload.active=false;
        StudioClient.BRIDGE.patchHistory().whenComplete((result,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;
            if(error!=null){message="原引用未通过核验；保留文件，不采用、不删除或重发";reload.active=true;return;}
            references=result;page=Math.min(page,Math.max(0,(references.size()-1)/rows()));message=references.isEmpty()?"暂无原任务引用":"引用不证明已发送；查询失败或未知不能再次提交";buttons();
        }));
    }
    private void buttons(){clearChildren();int count=rows();
        for(int i=page*count;i<Math.min(references.size(),(page+1)*count);i++){var reference=references.get(i).deepCopy();var recipient=reference.getAsJsonObject("recipient");var world=reference.getAsJsonObject("selection").getAsJsonObject("world");
            String label=recipient.get("model").getAsString()+" · "+world.get("dimension").getAsString()+" · "+reference.get("capsuleId").getAsString().substring(0,12);
            addDrawableChild(new StudioTheme.Button(x+12,62+(i-page*count)*29,w-24,23,StudioTheme.fit(textRenderer,label,w-40),StudioTheme.Kind.NORMAL,()->client.setScreen(new WorldPatchResultScreen(this,reference,null))));}
        reload=addDrawableChild(new StudioTheme.Button(x+12,height-90,w-24,22,"重新读取本地历史 · 不重新生成",StudioTheme.Kind.NORMAL,this::load));reload.active=state.available();
        int part=(w-32)/3;addDrawableChild(new StudioTheme.Button(x+12,height-39,part,24,"返回",StudioTheme.Kind.NORMAL,this::close));
        var previous=addDrawableChild(new StudioTheme.Button(x+16+part,height-39,part,24,"上一页",StudioTheme.Kind.NORMAL,()->{page--;buttons();}));previous.active=page>0;
        var next=addDrawableChild(new StudioTheme.Button(x+20+part*2,height-39,part,24,"下一页",StudioTheme.Kind.NORMAL,()->{page++;buttons();}));next.active=(page+1)*count<references.size();
    }
    @Override public void tick(){if(reload!=null)reload.active=state.available();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.drawText(textRenderer,"原候选不能重新绑定其他世界、选区或快照",x+12,44,StudioTheme.MUTED,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-61,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public void removed(){state.leave();}@Override public void close(){state.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
