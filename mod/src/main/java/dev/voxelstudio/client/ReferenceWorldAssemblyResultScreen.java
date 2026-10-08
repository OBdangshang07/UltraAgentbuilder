package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** Rendering the observer's last verified state creates no call or placement
 * authority. Closing this screen leaves the real client-tick observer alive. */
final class ReferenceWorldAssemblyResultScreen extends Screen {
    private final Screen parent;private final JsonObject reference;private int x,w,scroll;
    private List<net.minecraft.text.OrderedText> lines=List.of();private String displayed="",message="";
    ReferenceWorldAssemblyResultScreen(Screen parent,JsonObject reference){super(Text.literal("完整联合任务 · 后台继续 / 不重发"));this.parent=parent;this.reference=ReferenceWorldAssemblyReceipt.verifyReference(reference.deepCopy());StudioClient.ASSEMBLY.watch(this.reference,null);}
    @Override protected void init(){w=Math.min(650,width-24);x=(width-w)/2;int part=(w-30)/2;
        var pending=addDrawableChild(new StudioTheme.Button(x+12,height-74,w-24,22,"整组差异 / 最终世界确认 · 待接入，不可单片建造",StudioTheme.Kind.NORMAL,()->{}));pending.active=false;
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-38,part,24,"返回 · 生成继续",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(back);
        addDrawableChild(new StudioTheme.Button(x+18+part,height-38,part,24,"只 GET 原任务",StudioTheme.Kind.NORMAL,()->StudioClient.ASSEMBLY.refresh(reference)));displayed="";rebuild();}
    private void rebuild(){var view=StudioClient.ASSEMBLY.view(reference);String details=ReferenceWorldAssemblyReceipt.observationDetails(reference,view.status());message=view.message();
        if(!details.equals(displayed)){displayed=details;lines=textRenderer.wrapLines(Text.literal(details),w-28);scroll=StudioLayout.clampScroll(scroll,lines.size()*14,height-157);}}
    @Override public void tick(){rebuild();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,48,x+w-10,height-111);int y=50-scroll;for(var line:lines){if(y+14>=48&&y<height-111)d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,message,w-24),x+12,height-98,StudioTheme.WARN,false);super.render(d,mx,my,delta);}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-157);return true;}
    @Override public void close(){client.setScreen(parent);}@Override public boolean shouldPause(){return false;}
}
