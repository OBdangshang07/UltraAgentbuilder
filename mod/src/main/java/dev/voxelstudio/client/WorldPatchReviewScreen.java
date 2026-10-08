package dev.voxelstudio.client;
import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;
/** Bounded raw-input pages; never wrap a multi-megabyte prompt on a UI tick. */
final class WorldPatchReviewScreen extends Screen {
    private final Screen parent;private final JsonObject prepared;private final Runnable confirm;private final String details,prompt;
    private int x,w,scroll,page;private boolean raw;private List<net.minecraft.text.OrderedText> lines;
    WorldPatchReviewScreen(Screen parent,JsonObject prepared,Runnable confirm){this(parent,prepared,WorldPatchTaskReceipt.details(prepared),confirm);}
    WorldPatchReviewScreen(Screen parent,JsonObject prepared,String details,Runnable confirm){super(Text.literal("原位改造内容审核 · 尚不发送"));this.parent=parent;this.prepared=prepared;this.confirm=confirm;this.details=details;prompt=prepared.getAsJsonObject("task").getAsJsonObject("disclosure").get("modelPrompt").getAsString();}
    private void text(){String value=details;if(raw)value="完整原始模型输入 · 第 "+(page+1)+"/"+pages()+" 页（仅显示，原字节不变）\n\n"+WorldPatchPromptPages.at(prompt,page);lines=textRenderer.wrapLines(Text.literal(value),w-28);scroll=0;}
    private int pages(){return WorldPatchPromptPages.count(prompt);}
    @Override protected void init(){w=Math.min(600,width-24);x=(width-w)/2;text();int part=(w-36)/3;
        addDrawableChild(new StudioTheme.Button(x+12,height-72,part,22,raw?"查看披露摘要":"完整输入分页",StudioTheme.Kind.NORMAL,()->{raw=!raw;text();clearAndInit();}));
        addDrawableChild(new StudioTheme.Button(x+16+part,height-72,part,22,"上一原文页",StudioTheme.Kind.NORMAL,()->{if(raw&&page>0){page--;text();}}));addDrawableChild(new StudioTheme.Button(x+20+part*2,height-72,part,22,"下一原文页",StudioTheme.Kind.NORMAL,()->{if(raw&&page+1<pages()){page++;text();}}));
        addDrawableChild(new StudioTheme.Button(x+12,height-40,(w-30)/2,24,"返回 · 不确认",StudioTheme.Kind.NORMAL,this::close));addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-40,(w-30)/2,24,"确认内容 · 冻结但不发送",StudioTheme.Kind.PRIMARY,confirm));
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);d.enableScissor(x+10,48,x+w-10,height-85);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-85)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-137);return true;}
    @Override public void close(){client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
