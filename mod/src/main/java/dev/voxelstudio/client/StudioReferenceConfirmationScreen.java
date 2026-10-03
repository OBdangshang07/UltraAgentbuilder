package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import java.io.ByteArrayInputStream;
import java.util.*;

/** Exact job-owned-picture preview, free consent, then a distinct SEND.
 * A disabled process capability cannot be enabled by this UI or HTTP. */
final class StudioReferenceConfirmationScreen extends Screen {
    private final Screen parent;
    private final ReferenceImageDraft draft;
    private final ReferenceImageDraft.Snapshot snapshot;
    private final JsonObject generation;
    private final String world;
    private final BridgeClient.ReferencePreparation prepared;
    private final List<Identifier> textures=new ArrayList<>();
    private int ticket,selected;
    private boolean busy,confirmed,sendingEnabled;
    private String status="先核对实际像素和完整标注，再免费确认准备；调用模型还需独立 SEND。";
    private StudioTheme.Button action;
    StudioReferenceConfirmationScreen(Screen parent,ReferenceImageDraft draft,ReferenceImageDraft.Snapshot snapshot,JsonObject generation,String world,BridgeClient.ReferencePreparation prepared){
        super(Text.literal("核对实际参考图 · 尚未发送模型"));this.parent=parent;this.draft=draft;this.snapshot=snapshot;this.generation=generation.deepCopy();this.world=world;this.prepared=prepared;
    }
    private boolean current(){return draft.current(snapshot)&&StudioScreen.referenceGenerationCurrent(generation,world);}
    private void requireCurrent(){if(!current())throw new IllegalStateException("图片、模型、提示词、预算或世界已变化；须重新准备确认");}
    @Override protected void init(){
        dropTextures();int count=prepared.images().size(),slot=(width-24)/count;
        for(int i=0;i<count;i++){final int index=i;addDrawableChild(new StudioTheme.Button(12+i*slot,47,slot-3,23,"图片 "+(i+1),i==selected?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{selected=index;clearAndInit();}));}
        addDrawableChild(new StudioTheme.Button(12,height-35,Math.max(74,(width-36)/3),23,"返回编辑",StudioTheme.Kind.NORMAL,this::close));
        addDrawableChild(new StudioTheme.Button(18+(width-36)/3,height-35,Math.max(74,(width-36)/3),23,"完整标注 / 预算",StudioTheme.Kind.NORMAL,()->client.setScreen(new StudioInfoScreen(this,"准确图片、提示词与共享预算",ReferencePreparationReceipt.details(prepared.preparation())))));
        action=addDrawableChild(new StudioTheme.Button(24+2*((width-36)/3),height-35,Math.max(74,(width-36)/3),23,confirmed?"打开独立 SEND 确认":"免费确认图片准备",StudioTheme.Kind.PRIMARY,()->{if(!confirmed)confirmFree();else confirmSend();}));
        int observed=++ticket;var pixels=prepared.images().get(selected);
        ReferenceImageIO.work(()->NativeImage.read(new ByteArrayInputStream(pixels.png()))).whenComplete((image,error)->client.execute(()->{
            if(observed!=ticket||client.currentScreen!=this){if(image!=null)image.close();return;}if(error!=null){status=StudioMessages.error(error);return;}
            var t=new NativeImageBackedTexture(image);try{textures.add(client.getTextureManager().registerDynamicTexture("voxel-reference-confirmed",t));}catch(Throwable e){t.close();status=StudioMessages.error(e);}
        }));
        action.active=!busy&&current()&&(!confirmed||sendingEnabled);setInitialFocus(children().get(count));
    }
    private void confirmFree(){
        try{requireCurrent();}catch(Exception e){status=StudioMessages.error(e);return;}if(busy)return;busy=true;status="正在保存准确图片准备确认；零模型调用。";
        StudioClient.BRIDGE.confirmReference(prepared.preparation()).thenCompose(receipt->StudioClient.BRIDGE.referenceSendingEnabled()).whenComplete((enabled,error)->client.execute(()->{
            busy=false;if(error!=null){status=StudioMessages.error(error);return;}confirmed=true;sendingEnabled=Boolean.TRUE.equals(enabled);
            status=sendingEnabled?"本机准备已确认。点击独立 SEND 并再次确认后才调用模型。":"本机准备已确认；该版本的正式识图发送尚未开放，不会调用模型。";
            if(client.currentScreen==this)clearAndInit();
        }));
    }
    private void confirmSend(){
        try{requireCurrent();}catch(Exception e){status=StudioMessages.error(e);return;}if(busy||!confirmed||!sendingEnabled)return;
        String details=ReferencePreparationReceipt.details(prepared.preparation())+"\n\n现在确认的是模型 SEND，会使用所选账户额度。之后只查询这个原任务，网络回执未知时不会自动重发。没有建造权限，不修改当前世界。";
        client.setScreen(new StudioInfoScreen(this,"独立确认 · 发送参考图生成建筑",details,"确认 SEND · 开始生成",true,()->{
            try{requireCurrent();}catch(Exception e){status=StudioMessages.error(e);client.setScreen(this);return;}
            if(busy)return;busy=true;
            StudioClient.BRIDGE.referenceSendingEnabled().whenComplete((enabled,error)->client.execute(()->{
                busy=false;if(error!=null||!Boolean.TRUE.equals(enabled)||!current()){status=error!=null?StudioMessages.error(error):"发送能力或原请求已改变；未发送。";if(client.currentScreen!=this)client.setScreen(this);return;}
                StudioScreen.submitReference(prepared.preparation(),world);client.setScreen(new StudioScreen());
            }));
        }));
    }
    @Override public void tick(){action.active=!busy&&current()&&(!confirmed||sendingEnabled);}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,12,13,StudioTheme.ACCENT,false);
        var p=prepared.preparation();var g=p.getAsJsonObject("generation");d.drawText(textRenderer,StudioTheme.fit(textRenderer,ReferencePreparationReceipt.text(p,"model")+" · "+ReferencePreparationReceipt.text(g,"qualityTier")+" · 共用上限 "+ReferencePreparationReceipt.number(g,"assemblyCalls")+" 次",width-24),12,29,StudioTheme.TEXT,false);
        var pixels=prepared.images().get(selected);int boxW=width-24,boxH=Math.max(1,height-141);double fit=Math.min((double)boxW/pixels.width(),(double)boxH/pixels.height());int w=Math.max(1,(int)(pixels.width()*fit)),h=Math.max(1,(int)(pixels.height()*fit)),x=(width-w)/2,y=77+(boxH-h)/2;
        d.fill(x,y,x+w,y+h,0xff35434c);if(!textures.isEmpty())d.drawTexture(textures.get(0),x,y,0,0,w,h,w,h);
        var a=p.getAsJsonArray("references").get(selected).getAsJsonObject().getAsJsonObject("annotation");String annotation=StudioReferenceScreen.purposeLabel(a.get("purpose").getAsString())+" / "+StudioReferenceScreen.viewLabel(a.get("view").getAsString())+" · "+a.get("caption").getAsString();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,annotation,width-24),12,height-65,StudioTheme.MUTED,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,current()?status:"原草稿或请求已变化；必须返回重新准备。",width-24),12,height-51,current()?StudioTheme.MUTED:StudioTheme.WARN,false);super.render(d,mx,my,delta);
    }
    private void dropTextures(){if(client!=null)for(var texture:textures)client.getTextureManager().destroyTexture(texture);textures.clear();}
    @Override public void removed(){ticket++;dropTextures();}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
