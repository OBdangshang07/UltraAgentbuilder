package dev.voxelstudio.client;
import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
final class WorldPatchTaskScreen extends Screen {
    private final Screen parent;private JsonObject recipient;private StudioEditBoxWidget prompt;private int x,w;
    private final ReferenceImageDraft pictures=new ReferenceImageDraft();private ReferenceImageDraft.Snapshot attached;private BridgeClient.ReferencePixels pixels;
    private volatile long contentRevision;
    private String text="保留周围环境与保护区，在内层设计一个精致的入口广场，组织铺装、通行与立面衔接。",error="";
    WorldPatchTaskScreen(Screen parent){super(Text.literal("AI 原位改造 · 准备内容"));this.parent=parent;}
    @Override protected void init(){w=Math.min(560,width-24);x=(width-w)/2;try{if(recipient==null)recipient=StudioScreen.contextRecipient();}catch(Exception e){recipient=null;error=e.getMessage();}
        prompt=addDrawableChild(new StudioEditBoxWidget(textRenderer,x+12,94,w-24,Math.max(36,height-280),Text.literal("原位改造任务"),Text.literal("描述内层改造要求")));prompt.setMaxLength(6000);prompt.setText(text);prompt.setChangeListener(v->{if(!text.equals(v)){text=v;contentRevision++;}});
        addDrawableChild(new StudioTheme.Button(x+12,height-152,w-24,24,"参考图（可选）· 编辑准确图片",StudioTheme.Kind.NORMAL,this::editPictures));
        addDrawableChild(new StudioTheme.Button(x+12,height-122,w-24,24,"不用参考图 · 保留图片编辑，仅走文字",StudioTheme.Kind.NORMAL,()->{attached=null;pixels=null;contentRevision++;error="已明确改用文字路线；没有重发或删除图片记录。";clearAndInit();}));
        var prepare=addDrawableChild(new StudioTheme.Button(x+12,height-92,w-24,24,pixels==null?"准备逐格披露 · 不调用模型":"准备参考图＋选区披露 · 不调用模型",StudioTheme.Kind.PRIMARY,()->{try{
            if(recipient==null||!recipient.equals(StudioScreen.contextRecipient()))throw new IllegalStateException("模型选择已改变，请重新打开");
            if(pixels==null)StudioClient.SELECTION.preparePatch(this,WorldPatchTaskReceipt.intent(recipient.get("agent").getAsString(),recipient.get("model").getAsString(),recipient.get("effort").getAsString(),text));
            else{var exact=attached;if(!pictures.current(exact))throw new IllegalStateException("图片编辑已改变；请重新准备，不降级为文字");
                long revision=contentRevision;var m=ReferencePixelPreparationReceipt.verify(exact,pixels.manifest());StudioClient.SELECTION.prepareReferencePatch(this,ReferenceWorldPatchTaskReceipt.intent(recipient.get("model").getAsString(),recipient.get("effort").getAsString(),text,exact.ownerId(),m.get("setHash").getAsString()),m,()->revision==contentRevision&&pictures.current(exact));}
        }catch(Exception e){error=e.getMessage();}}));prepare.active=recipient!=null;
        addDrawableChild(new StudioTheme.Button(x+12,height-36,w-24,22,"返回选区",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(prompt);
    }
    private void editPictures(){try{
        if(recipient==null||!recipient.equals(StudioScreen.contextRecipient()))throw new IllegalStateException("模型选择改变，请重新打开任务");
        var source=StudioClient.SELECTION.referencePatchSourceGate();
        client.setScreen(new StudioReferenceScreen(this,pictures,new StudioReferenceScreen.PixelTarget(source,(snapshot,prepared)->{
            if(!source.getAsBoolean()||!pictures.current(snapshot)||!recipient.equals(StudioScreen.contextRecipient()))throw new IllegalStateException("原选区、图片或模型改变；未采用旧准备");
            ReferencePixelPreparationReceipt.verify(snapshot,prepared.manifest());attached=snapshot;pixels=prepared;contentRevision++;error="已核验 "+snapshot.photos().size()+" 张准确图片；准备联合披露后独立确认，未发送模型。";client.setScreen(this);
        })));
    }catch(Exception e){error=e.getMessage();}}
    @Override public void tick(){prompt.tick();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,recipient==null?"先在创作页选择模型":recipient.toString(),w-24),x+12,48,StudioTheme.TEXT,false);d.drawText(textRenderer,"这次披露包含逐格 W 和六邻接面，不使用旧摘要同意。",x+12,70,StudioTheme.WARN,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,error.isEmpty()?StudioClient.SELECTION.statusText():error,w-24),x+12,height-60,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public void close(){client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
