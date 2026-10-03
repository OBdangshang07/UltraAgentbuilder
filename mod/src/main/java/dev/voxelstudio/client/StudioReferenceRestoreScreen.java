package dev.voxelstudio.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import java.io.ByteArrayInputStream;

/** Verified pixels for an explicitly selected preparation. The separate final
 * confirmation only replaces the editor, not disk/model/world state. */
final class StudioReferenceRestoreScreen extends Screen {
    private final Screen parent;
    private final StudioReferenceScreen editor;
    private final ReferenceImageRestoreReceipt.Loaded loaded;
    private final String owner;
    private final long revision;
    private int selected,ticket;
    private Identifier texture;
    private String status="已核验原图片；尚未替换当前编辑，不调用模型。";
    StudioReferenceRestoreScreen(Screen parent,StudioReferenceScreen editor,ReferenceImageRestoreReceipt.Loaded loaded,String owner,long revision){
        super(Text.literal("服务器规范化图片 · 新草稿导入预览"));this.parent=parent;this.editor=editor;this.loaded=loaded;this.owner=owner;this.revision=revision;
    }
    private boolean editable(){return editor.serverImagesEditable()&&owner.equals(editor.serverImagesOwner())&&revision==editor.serverImagesRevision();}
    @Override protected void init(){
        dropTexture();int count=loaded.photos().size();selected=Math.max(0,Math.min(selected,count-1));
        for(int i=0;i<count;i++){final int index=i;int slot=(width-24)/count;
            addDrawableChild(new StudioTheme.Button(12+i*slot,48,slot-3,23,"准备图片 "+(i+1),i==selected?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{if(client.currentScreen==this){selected=index;clearAndInit();}}));
        }
        int bw=Math.max(74,(width-36)/3);
        addDrawableChild(new StudioTheme.Button(12,height-35,bw,23,"返回，不替换",StudioTheme.Kind.NORMAL,this::close));
        addDrawableChild(new StudioTheme.Button(18+bw,height-35,bw,23,"完整图片与边界",StudioTheme.Kind.NORMAL,()->{if(client.currentScreen==this)client.setScreen(new StudioInfoScreen(this,"图片导入完整范围",ReferenceImageRestoreReceipt.details(loaded)));}));
        var restore=addDrawableChild(new StudioTheme.Button(24+2*bw,height-35,bw,23,"核对并替换编辑",StudioTheme.Kind.PRIMARY,this::confirm));restore.active=editable();
        var pixels=loaded.photos().get(selected).output();int observed=++ticket;
        ReferenceImageIO.work(()->NativeImage.read(new ByteArrayInputStream(pixels.png()))).whenComplete((image,error)->client.execute(()->{
            if(observed!=ticket||client.currentScreen!=this){if(image!=null)image.close();return;}
            if(error!=null){status=StudioMessages.error(error);return;}
            var registered=new NativeImageBackedTexture(image);
            try{texture=client.getTextureManager().registerDynamicTexture("voxel-reference-restore",registered);}
            catch(Throwable e){registered.close();status=StudioMessages.error(e);}
        }));
    }
    private void confirm(){
        if(client.currentScreen!=this||!editable())return;
        final Screen[] confirmation=new Screen[1];
        confirmation[0]=new StudioInfoScreen(this,"确认替换当前图片编辑？",ReferenceImageRestoreReceipt.details(loaded),"替换为新图片草稿",false,()->{
            if(client.currentScreen!=confirmation[0])return;
            try{
                if(!editable())throw new IllegalStateException("原任务或图片编辑已变化，旧确认无效；未替换");
                editor.restoreServerImages(loaded,owner,revision);
            }catch(Exception e){status=StudioMessages.error(e);client.setScreen(this);}
        });
        client.setScreen(confirmation[0]);
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,12,13,StudioTheme.ACCENT,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,"规范化像素，不是原图编辑；旧提示词、预算和 SEND 不继承",width-24),12,30,StudioTheme.MUTED,false);
        var photo=loaded.photos().get(selected);var pixels=photo.output();int boxW=width-24,boxH=Math.max(1,height-142);
        double fit=Math.min((double)boxW/pixels.width(),(double)boxH/pixels.height());int w=Math.max(1,(int)(pixels.width()*fit)),h=Math.max(1,(int)(pixels.height()*fit)),x=(width-w)/2,y=77+(boxH-h)/2;
        d.fill(x,y,x+w,y+h,0xff35434c);if(texture!=null)d.drawTexture(texture,x,y,0,0,w,h,w,h);
        var a=photo.annotation();String label=StudioReferenceScreen.purposeLabel(a.get("purpose").getAsString())+" / "+StudioReferenceScreen.viewLabel(a.get("view").getAsString())+" · "+a.get("caption").getAsString();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,label,width-24),12,height-65,StudioTheme.MUTED,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,editable()?status:"当前编辑/任务已变化；只能查看，不替换",width-24),12,height-51,StudioTheme.MUTED,false);super.render(d,mx,my,delta);
    }
    private void dropTexture(){ticket++;if(texture!=null&&client!=null){client.getTextureManager().destroyTexture(texture);texture=null;}}
    @Override public void removed(){dropTexture();}
    @Override public void close(){if(client.currentScreen==this)client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
