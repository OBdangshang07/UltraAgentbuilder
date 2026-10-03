package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/** Native text/IME input, preparation only. No implicit model invocation. */
final class ContextTaskScreen extends Screen {
    private final Screen parent;private JsonObject recipient;private StudioEditBoxWidget prompt;
    private String text="分析这片选区的方块事实、空间关系和适合改造的位置；推断与未知必须明确标注。",error="";
    private int x,w;
    ContextTaskScreen(Screen parent){super(Text.literal("AI 环境分析 · 准备发送内容"));this.parent=parent;}
    @Override protected void init(){
        w=Math.min(560,width-24);x=(width-w)/2;
        try{recipient=StudioScreen.contextRecipient();}catch(Exception e){recipient=null;error=e.getMessage();}
        prompt=addDrawableChild(new StudioEditBoxWidget(textRenderer,x+12,92,w-24,Math.max(36,height-218),Text.literal("只读环境分析任务"),Text.literal("具体环境分析要求")));
        prompt.setMaxLength(6000);prompt.setText(text);prompt.setChangeListener(value->{text=value;});
        var prepare=addDrawableChild(new StudioTheme.Button(x+12,height-91,w-24,24,"准备精确任务与隐私披露 · 不调用",StudioTheme.Kind.PRIMARY,()->{
            try{if(recipient==null)throw new IllegalStateException("先返回创作页选模型");
                var current=StudioScreen.contextRecipient();if(!current.equals(recipient))throw new IllegalStateException("模型选择已改变，请重新打开任务页");
                var intent=ContextTaskReceipt.analysisIntent(recipient.get("agent").getAsString(),recipient.get("model").getAsString(),recipient.get("effort").getAsString(),text);
                StudioClient.SELECTION.prepareTask(this,intent);
            }catch(Exception e){error=e.getMessage();}
        }));prepare.active=recipient!=null;
        addDrawableChild(new StudioTheme.Button(x+12,height-36,w-24,22,"返回选区",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(prompt);
    }
    @Override public void tick(){prompt.tick();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        String model=recipient==null?"先在创作页选择已就绪的模型":recipient.get("agent").getAsString()+" · "+recipient.get("model").getAsString()+" · "+recipient.get("effort").getAsString();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,model,w-24),x+12,49,StudioTheme.TEXT,false);
        d.drawText(textRenderer,"本页仅准备/确认内容；发送须另行确认，不建造。",x+12,69,StudioTheme.WARN,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,error.isEmpty()?StudioClient.SELECTION.statusText():error,w-24),x+12,height-60,StudioTheme.WARN,false);
        super.render(d,mx,my,delta);
    }
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
