package dev.voxelstudio.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;
import java.util.function.LongConsumer;

/** No mod-defined token ceiling. Empty/zero internal selection means no SDK override. */
final class StudioOutputBudgetScreen extends Screen {
    private final Screen parent;private final LongConsumer selected;private final String configured;
    private TextFieldWidget input;private String entered,error="";
    StudioOutputBudgetScreen(Screen parent,long value,String configured,LongConsumer selected){super(Text.literal("DeepSeek 输出预算"));this.parent=parent;this.selected=selected;this.configured=configured;entered=value==0?"":Long.toString(value);}
    static long parseBudget(String value){
        String text=value.trim();if(text.isEmpty())return 0;
        if(!text.matches("[0-9]+"))throw new IllegalArgumentException("请输入正整数；留空即跟随 Harness 配置");
        try{long n=Long.parseLong(text);if(n<1||n>9007199254740991L)throw new NumberFormatException();return n;}
        catch(NumberFormatException e){throw new IllegalArgumentException("数值不能用协议整数表示；留空可使用模型配置");}
    }
    @Override protected void init(){
        input=addDrawableChild(new TextFieldWidget(textRenderer,16,108,width-32,22,Text.literal("自定义 tokens；留空跟随模型")));input.setMaxLength(16);input.setText(entered);input.setChangedListener(s->entered=s);
        int w=(width-48)/3;
        var back=addDrawableChild(new StudioTheme.Button(16,height-38,w,24,"返回",StudioTheme.Kind.NORMAL,this::close));
        addDrawableChild(new StudioTheme.Button(24+w,height-38,w,24,"跟随 Harness",StudioTheme.Kind.NORMAL,()->{selected.accept(0);close();}));
        addDrawableChild(new StudioTheme.Button(32+2*w,height-38,w,24,"保存预算",StudioTheme.Kind.PRIMARY,()->{try{selected.accept(parseBudget(entered));close();}catch(IllegalArgumentException e){error=e.getMessage();}}));setInitialFocus(back);
    }
    @Override public void tick(){input.tick();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,16,17,StudioTheme.ACCENT,false);
        int y=38;for(var line:textRenderer.wrapLines(Text.literal("默认由 Harness / 模型配置决定，模组不指定 token 上限。也可手填任意协议可表示的正整数，由服务端验证是否支持；预算越大可能耗时和计费越多。"),width-32)){d.drawText(textRenderer,line,16,y,StudioTheme.MUTED,false);y+=12;}
        d.drawText(textRenderer,"本机目录预算（非服务端实时上限）："+configured,16,91,StudioTheme.MUTED,false);
        y=140;for(var line:textRenderer.wrapLines(Text.literal(error.isEmpty()?"留空＝跟随配置。保存只更改选项，不调用模型；提交前仍需确认调用次数。":error),width-32)){d.drawText(textRenderer,line,16,y,error.isEmpty()?StudioTheme.MUTED:StudioTheme.ERROR,false);y+=12;}
        super.render(d,mx,my,delta);
    }
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
