package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/** Normal full-tier entry, separate from the historical one-call patch. Pure
 * picture editing and free preparation cannot send a model or write a world. */
final class ReferenceWorldAssemblyTaskScreen extends Screen {
    private final Screen parent;private final ReferenceImageDraft pictures=new ReferenceImageDraft();
    private ReferenceImageDraft.Snapshot attached;private BridgeClient.ReferencePixels pixels;
    private StudioEditBoxWidget prompt;private int x,w;private volatile long contentRevision;
    private String text="结合周围道路和保留建筑，在内层设计一座具有独特设计语言的办公建筑；精致立面、完整内饰和核心筒，保留保护区。",message="";
    ReferenceWorldAssemblyTaskScreen(Screen parent){super(Text.literal("参考图＋场地 · 完整四档制作"));this.parent=parent;}
    @Override protected void init(){
        w=Math.min(620,width-24);x=(width-w)/2;
        prompt=addDrawableChild(new StudioEditBoxWidget(textRenderer,x+12,96,w-24,Math.max(36,height-302),Text.literal("完整建筑要求"),Text.literal("描述建筑与场地要求")));
        prompt.setMaxLength(16000);prompt.setText(text);prompt.setChangeListener(v->{if(!text.equals(v)){text=v;contentRevision++;}});
        addDrawableChild(new StudioTheme.Button(x+12,height-182,w-24,24,"明确选择 Lite / Pro / Max / Ultra",StudioTheme.Kind.NORMAL,()->StudioScreen.chooseReferenceAssemblyTier(this,()->{contentRevision++;message="已明确更改档位及完整预算；旧准备不可发送。非 Ultra 不沿用分阶段原型。";})));
        addDrawableChild(new StudioTheme.Button(x+12,height-152,w-24,24,"导入 / 编辑参考图 · 不调用模型",StudioTheme.Kind.NORMAL,this::editPictures));
        addDrawableChild(new StudioTheme.Button(x+12,height-122,w-24,24,"清除本次图片选择 · 保留本地原记录",StudioTheme.Kind.NORMAL,()->{attached=null;pixels=null;contentRevision++;message="本次没有图片；不能把完整联合任务暗中改成文字或旧一调用任务。";}));
        addDrawableChild(new StudioTheme.Button(x+12,height-92,w-24,24,"准备完整预算＋图片＋逐格披露 · 不调用",StudioTheme.Kind.PRIMARY,this::prepare));
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-36,w-24,22,"返回选区 · 不发送",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(back);
    }
    private void editPictures(){try{
        var source=StudioClient.SELECTION.referencePatchSourceGate();var selected=StudioScreen.contextRecipient();
        client.setScreen(new StudioReferenceScreen(this,pictures,new StudioReferenceScreen.PixelTarget(source,(snapshot,prepared)->{
            if(!source.getAsBoolean()||!pictures.current(snapshot)||!selected.equals(StudioScreen.contextRecipient()))throw new IllegalStateException("原选区、图片或模型已改变；旧图片准备不采用");
            ReferencePixelPreparationReceipt.verify(snapshot,prepared.manifest());attached=snapshot;pixels=prepared;contentRevision++;
            message="已准备 "+snapshot.photos().size()+" 张准确原图；尚未发送，完整预算需独立确认。";client.setScreen(this);
        })));
    }catch(Exception error){message=StudioMessages.error(error);}}
    private void prepare(){try{
        if(pixels==null||attached==null||!pictures.current(attached))throw new IllegalStateException("先导入准确参考图；不降级成文字改造");
        var snapshot=attached;var manifest=ReferencePixelPreparationReceipt.verify(snapshot,pixels.manifest());
        var generation=StudioScreen.referenceAssemblyGenerationRequest(snapshot.ownerId(),text);long revision=contentRevision;
        StudioClient.SELECTION.prepareReferenceAssembly(this,generation,manifest,()->revision==contentRevision&&pictures.current(snapshot));
    }catch(Exception error){message=StudioMessages.error(error);}}
    @Override public void tick(){prompt.tick();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        String choice;try{choice=StudioScreen.contextRecipient()+" · "+StudioScreen.referenceAssemblyTierSummary();}catch(Exception error){choice="先在创作页连接明确支持图像的 Codex 模型";}
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,choice,w-24),x+12,48,StudioTheme.TEXT,false);
        d.drawText(textRenderer,"原 C 只读 / W−保护区可提议修改；最终建造仍需整组确认。",x+12,70,StudioTheme.WARN,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message.isEmpty()?StudioClient.SELECTION.statusText():message,w-24),x+12,height-60,StudioTheme.WARN,false);super.render(d,mx,my,delta);
    }
    @Override public void close(){client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
