package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** GET-only automatic polling. Recovery requires a separate explicit screen;
 * candidate loading remains a read-only, original-coordinate action. */
final class WorldPatchResultScreen extends Screen {
    private final Screen parent;private final JsonObject reference;private JsonObject status;private final WorldPatchPageState state=new WorldPatchPageState();
    private int x,w,scroll,ticks;private boolean showingPreviewStatus;private List<net.minecraft.text.OrderedText> lines;private String message="只查询原任务，不重新生成";
    private StudioTheme.Button refresh,observe,recheck,preview;
    WorldPatchResultScreen(Screen parent,JsonObject reference,JsonObject status){super(Text.literal("原位改造结果 · 先预览，不写入"));this.parent=parent;this.reference=WorldPatchJobReceipt.verifyReference(reference.deepCopy());this.status=status==null?null:WorldPatchJobReceipt.verify(this.reference,status.deepCopy());}
    @Override protected void init(){state.enter();w=Math.min(620,width-24);x=(width-w)/2;int part=(w-30)/2;
        observe=addDrawableChild(new StudioTheme.Button(x+12,height-102,part,22,"独立确认 · 只观察原 turn",StudioTheme.Kind.NORMAL,()->recover(true)));
        recheck=addDrawableChild(new StudioTheme.Button(x+18+part,height-102,part,22,"独立确认 · 重检完整原响应",StudioTheme.Kind.NORMAL,()->recover(false)));
        preview=addDrawableChild(new StudioTheme.Button(x+12,height-74,w-24,22,"加载原位差异投影 · 不放置",StudioTheme.Kind.PRIMARY,this::preview));
        addDrawableChild(new StudioTheme.Button(x+12,height-38,part,24,"返回",StudioTheme.Kind.NORMAL,this::close));
        refresh=addDrawableChild(new StudioTheme.Button(x+18+part,height-38,part,24,"查询原回执 · 不调用模型",StudioTheme.Kind.NORMAL,this::query));rebuild();if(status==null)query();
    }
    private void rebuild(){String value=status==null?"尚未取得完整原回执，这不证明模型未调用。不会重新提交。\n\n原任务："+reference.get("capsuleId").getAsString():WorldPatchJobReceipt.details(reference,status);
        lines=textRenderer.wrapLines(Text.literal(value),w-28);scroll=StudioLayout.clampScroll(scroll,lines.size()*14,height-185);buttons();}
    private void buttons(){boolean available=state.available(),completed=status!=null&&status.get("state").getAsString().equals("completed-checked");refresh.active=available;
        observe.active=available&&status!=null&&status.get("canObserveOriginal").getAsBoolean();recheck.active=available&&status!=null&&(completed||status.get("state").getAsString().equals("response-retained"));
        preview.active=available&&completed&&!StudioClient.SELECTION.contextBusy()&&StudioClient.SELECTION.matchesPreview(WorldPatchJobReceipt.candidate(reference,status).binding());}
    private void query(){long ticket=state.begin();if(ticket<0)return;showingPreviewStatus=false;buttons();
        StudioClient.BRIDGE.readPatchJob(reference).whenComplete((result,error)->client.execute(()->{
            if(!state.finish(ticket)||client.currentScreen!=this)return;if(error!=null){message="原回执查询失败或不存在；结果仍未确认，不重新生成";buttons();return;}
            status=result;message="已核验原任务回执；未核验当前世界，不授予放置权限";rebuild();
        }));
    }
    private void recover(boolean observing){if(!(observing?observe:recheck).active)return;client.setScreen(new WorldPatchRecoveryScreen(this,reference,observing));}
    private void preview(){if(!preview.active||status==null)return;showingPreviewStatus=true;StudioClient.SELECTION.loadPatchPreview(this,reference,status,state.publication());}
    JsonObject statusForAudit(){return status==null?null:status.deepCopy();}
    JsonObject referenceForAudit(){return reference.deepCopy();}
    @Override public void tick(){buttons();if(++ticks>=40){ticks=0;if(status!=null&&WorldPatchJobReceipt.polling(status))query();}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-139);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-139)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        String feedback=showingPreviewStatus?StudioClient.SELECTION.statusText():message;d.drawText(textRenderer,StudioTheme.fit(textRenderer,feedback,w-24),x+12,height-128,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-185);return true;}
    @Override public void removed(){state.leave();}@Override public void close(){state.leave();client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
