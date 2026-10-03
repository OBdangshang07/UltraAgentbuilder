package dev.voxelstudio.client;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

final class StudioImportScreen extends Screen {
    private final Screen parent;private TextFieldWidget directory;private String entered="";
    StudioImportScreen(Screen parent){super(Text.literal("导入原生建筑资产包"));this.parent=parent;}
    @Override protected void init(){directory=addDrawableChild(new TextFieldWidget(textRenderer,16,92,width-32,22,Text.literal("原生资产包目录的绝对路径")));directory.setMaxLength(2048);directory.setText(entered);directory.setChangedListener(s->entered=s);
        addDrawableChild(new StudioTheme.Button(16,height-38,(width-40)/2,24,"返回",StudioTheme.Kind.NORMAL,this::close));
        addDrawableChild(new StudioTheme.Button(24+(width-40)/2,height-38,(width-40)/2,24,"校验并加载预览",StudioTheme.Kind.PRIMARY,()->{StudioScreen.importBundle(entered.trim());client.setScreen(parent);}));
    }
    @Override public void tick(){directory.tick();}
    @Override public void render(DrawContext d,int x,int y,float delta){d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,16,17,StudioTheme.ACCENT,false);int row=38;for(var line:textRenderer.wrapLines(Text.literal("填写包含 manifest.json 和 cells.bin 的本机目录。保留 keep/clear/set；不调用 AI、不自动放置。此入口不是任意 HTML 或 .schem 转换器。"),width-32)){d.drawText(textRenderer,line,16,row,StudioTheme.MUTED,false);row+=12;}super.render(d,x,y,delta);}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
