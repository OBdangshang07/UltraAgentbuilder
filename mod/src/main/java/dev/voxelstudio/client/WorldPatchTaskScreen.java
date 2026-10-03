package dev.voxelstudio.client;
import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
final class WorldPatchTaskScreen extends Screen {
    private final Screen parent;private JsonObject recipient;private StudioEditBoxWidget prompt;private int x,w;
    private String text="保留周围环境与保护区，在内层设计一个精致的入口广场，组织铺装、通行与立面衔接。",error="";
    WorldPatchTaskScreen(Screen parent){super(Text.literal("AI 原位改造 · 准备内容"));this.parent=parent;}
    @Override protected void init(){w=Math.min(560,width-24);x=(width-w)/2;try{recipient=StudioScreen.contextRecipient();}catch(Exception e){recipient=null;error=e.getMessage();}
        prompt=addDrawableChild(new StudioEditBoxWidget(textRenderer,x+12,94,w-24,Math.max(36,height-220),Text.literal("原位改造任务"),Text.literal("描述内层改造要求")));prompt.setMaxLength(6000);prompt.setText(text);prompt.setChangeListener(v->text=v);
        var prepare=addDrawableChild(new StudioTheme.Button(x+12,height-92,w-24,24,"准备逐格披露 · 不调用模型",StudioTheme.Kind.PRIMARY,()->{try{if(recipient==null||!recipient.equals(StudioScreen.contextRecipient()))throw new IllegalStateException("模型选择已改变，请重新打开");StudioClient.SELECTION.preparePatch(this,WorldPatchTaskReceipt.intent(recipient.get("agent").getAsString(),recipient.get("model").getAsString(),recipient.get("effort").getAsString(),text));}catch(Exception e){error=e.getMessage();}}));prepare.active=recipient!=null;
        addDrawableChild(new StudioTheme.Button(x+12,height-36,w-24,22,"返回选区",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(prompt);
    }
    @Override public void tick(){prompt.tick();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,recipient==null?"先在创作页选择模型":recipient.toString(),w-24),x+12,48,StudioTheme.TEXT,false);d.drawText(textRenderer,"这次披露包含逐格 W 和六邻接面，不使用旧摘要同意。",x+12,70,StudioTheme.WARN,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,error.isEmpty()?StudioClient.SELECTION.statusText():error,w-24),x+12,height-60,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public void close(){client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
