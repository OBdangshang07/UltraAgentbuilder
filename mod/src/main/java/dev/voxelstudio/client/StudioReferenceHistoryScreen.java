package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import java.io.ByteArrayInputStream;

/** Only immutable original-job GETs. No SEND, draft restore or world controls. */
final class StudioReferenceHistoryScreen extends Screen {
    private final Screen parent;
    private final JsonObject original;
    private BridgeClient.ReferenceHistory history;
    // ReferenceHistory returns defensive copies. Keep one private, verified
    // metadata snapshot rather than copying a potentially large brief per frame.
    private JsonObject historyMetadata;
    private boolean loading,attempted;
    private int selected,ticket;
    private Identifier texture;
    private String status="只读取原任务的图片和简报；零新增模型调用，不修改世界。";
    StudioReferenceHistoryScreen(Screen parent,JsonObject original){super(Text.literal("原任务参考图片与识图简报"));this.parent=parent;this.original=original.deepCopy();}
    @Override protected void init(){
        dropTexture();int count=history==null?0:history.images().size();selected=Math.max(0,Math.min(selected,Math.max(0,count-1)));
        for(int i=0;i<count;i++){final int index=i;int slot=(width-24)/count;addDrawableChild(new StudioTheme.Button(12+i*slot,48,slot-3,23,"原图片 "+(i+1),i==selected?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{selected=index;clearAndInit();}));}
        int buttonWidth=Math.max(74,(width-36)/3);
        addDrawableChild(new StudioTheme.Button(12,height-35,buttonWidth,23,"返回历史",StudioTheme.Kind.NORMAL,this::close));
        var detail=addDrawableChild(new StudioTheme.Button(18+buttonWidth,height-35,buttonWidth,23,"原标注 / 识图简报",StudioTheme.Kind.NORMAL,()->client.setScreen(new StudioInfoScreen(this,"原图片、请求与识图简报",ReferenceJobHistoryReceipt.details(historyMetadata)))));detail.active=historyMetadata!=null;
        var refresh=addDrawableChild(new StudioTheme.Button(24+2*buttonWidth,height-35,buttonWidth,23,"只读刷新",StudioTheme.Kind.NORMAL,()->{history=null;historyMetadata=null;dropTexture();load();clearAndInit();}));refresh.active=!loading;
        if(history==null){if(!loading&&!attempted)load();return;}
        var pixels=history.images().get(selected);int observed=++ticket;
        ReferenceImageIO.work(()->NativeImage.read(new ByteArrayInputStream(pixels.png()))).whenComplete((image,error)->client.execute(()->{
            if(observed!=ticket||client.currentScreen!=this){if(image!=null)image.close();return;}if(error!=null){status=StudioMessages.error(error);return;}
            var registered=new NativeImageBackedTexture(image);try{texture=client.getTextureManager().registerDynamicTexture("voxel-reference-history",registered);}catch(Throwable e){registered.close();status=StudioMessages.error(e);}
        }));
    }
    private void load(){
        if(loading)return;loading=true;attempted=true;status="正在后台核对原任务身份、原图片像素与原模型简报…";
        StudioClient.BRIDGE.readReferenceHistory(original).whenComplete((result,error)->client.execute(()->{
            loading=false;if(error!=null)status=StudioMessages.error(error);else{history=result;historyMetadata=result.history();var analysis=historyMetadata.getAsJsonObject("analysis");status="准确原图片 · 识图分析 "+analysis.get("status").getAsString()+" · 简报仅为不可信设计数据，不认证品质";}
            if(client.currentScreen==this)clearAndInit();
        }));
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,12,13,StudioTheme.ACCENT,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,"查看原任务，不重新准备、上传、生成或放置",width-24),12,30,StudioTheme.MUTED,false);
        if(history!=null){var pixels=history.images().get(selected);int boxW=width-24,boxH=Math.max(1,height-142);double fit=Math.min((double)boxW/pixels.width(),(double)boxH/pixels.height());int w=Math.max(1,(int)(pixels.width()*fit)),h=Math.max(1,(int)(pixels.height()*fit)),x=(width-w)/2,y=77+(boxH-h)/2;
            d.fill(x,y,x+w,y+h,0xff35434c);if(texture!=null)d.drawTexture(texture,x,y,0,0,w,h,w,h);
            var annotation=historyMetadata.getAsJsonObject("manifest").getAsJsonArray("references").get(selected).getAsJsonObject().getAsJsonObject("annotation");String label=StudioReferenceScreen.purposeLabel(annotation.get("purpose").getAsString())+" / "+StudioReferenceScreen.viewLabel(annotation.get("view").getAsString())+" · "+annotation.get("caption").getAsString();d.drawText(textRenderer,StudioTheme.fit(textRenderer,label,width-24),12,height-65,StudioTheme.MUTED,false);
        }
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,status,width-24),12,height-51,StudioTheme.MUTED,false);super.render(d,mx,my,delta);
    }
    private void dropTexture(){ticket++;if(texture!=null&&client!=null){client.getTextureManager().destroyTexture(texture);texture=null;}}
    @Override public void removed(){dropTexture();}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
