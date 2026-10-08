package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** Separate complete-task history. Reading old/unknown records does not
 * authorize resending, taking over execution or changing their originals. */
final class ReferenceWorldAssemblyHistoryScreen extends Screen {
    private final Screen parent;private final WorldPatchPageState page=new WorldPatchPageState();private List<JsonObject> references=List.of();
    private int x,w,index;private boolean availableBefore;private String message="读取完整任务原引用；不调用模型";
    ReferenceWorldAssemblyHistoryScreen(Screen parent){super(Text.literal("完整联合历史 · 原任务 / 不接管"));this.parent=parent;}
    @Override protected void init(){page.enter();w=Math.min(650,width-24);x=(width-w)/2;buttons();load();}
    private int rows(){return Math.max(1,(height-164)/29);}
    private void load(){long ticket=page.begin();if(ticket<0)return;buttons();
        StudioClient.ASSEMBLY.reloadHistory().whenComplete((values,error)->client.execute(()->{
            if(!page.finish(ticket)||client.currentScreen!=this)return;
            if(error==null){references=values;index=Math.min(index,Math.max(0,(references.size()-1)/rows()));message=StudioClient.ASSEMBLY.historyMessage();}
            else message="原完整历史未通过读取或核验；记录保留，不补发或删除";buttons();
        }));}
    private void buttons(){clearChildren();boolean available=availableBefore=page.available();int count=rows();
        for(int i=index*count;i<Math.min(references.size(),(index+1)*count);i++){var r=references.get(i).deepCopy();var p=r.getAsJsonObject("prepared");
            String label=p.get("tier").getAsString()+" · "+p.getAsJsonObject("selected").get("model").getAsString()+" · "+r.get("id").getAsString().substring(0,12);
            var row=addDrawableChild(new StudioTheme.Button(x+12,62+(i-index*count)*29,w-24,23,StudioTheme.fit(textRenderer,label,w-40),StudioTheme.Kind.NORMAL,()->client.setScreen(new ReferenceWorldAssemblyResultScreen(this,r))));row.active=available;}
        var reload=addDrawableChild(new StudioTheme.Button(x+12,height-90,w-24,22,"重新读取本地原引用 · 不生成",StudioTheme.Kind.NORMAL,this::load));reload.active=available;int part=(w-32)/3;
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-39,part,24,"返回",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(back);
        var before=addDrawableChild(new StudioTheme.Button(x+16+part,height-39,part,24,"上一页",StudioTheme.Kind.NORMAL,()->{index--;buttons();}));before.active=available&&index>0;
        var next=addDrawableChild(new StudioTheme.Button(x+20+part*2,height-39,part,24,"下一页",StudioTheme.Kind.NORMAL,()->{index++;buttons();}));next.active=available&&(index+1)*count<references.size();}
    @Override public void tick(){if(availableBefore!=page.available())buttons();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.drawText(textRenderer,"完整四档任务与旧一调用历史独立；原坐标不允许搬走。",x+12,44,StudioTheme.MUTED,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-61,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public void removed(){page.leave();}@Override public void close(){page.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
