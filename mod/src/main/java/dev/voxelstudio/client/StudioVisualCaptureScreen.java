package dev.voxelstudio.client;
import com.google.gson.JsonArray;import dev.voxelstudio.*;import net.minecraft.client.gui.DrawContext;import net.minecraft.client.gui.screen.Screen;import net.minecraft.text.Text;import net.minecraft.util.math.BlockPos;import java.util.function.Consumer;
final class StudioVisualCaptureScreen extends Screen {
    private final Screen parent;private final Asset asset;private final Consumer<JsonArray> success;private final Consumer<Throwable> failure;private final ProjectionRenderer renderer=new ProjectionRenderer();private boolean started,done;
    StudioVisualCaptureScreen(Screen parent,Asset asset,Consumer<JsonArray> success,Consumer<Throwable> failure){super(Text.literal("准备四个建筑视角"));this.parent=parent;this.asset=asset;this.success=success;this.failure=failure;}
    @Override protected void init(){if(!started){started=true;renderer.rebuild(new Placement(asset,BlockPos.ORIGIN,0,false,0,false));}var back=addDrawableChild(new StudioTheme.Button(width/2-80,height-45,160,24,"取消，不调用模型",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(back);}
    @Override public void tick(){if(done||renderer.building)return;done=true;try{if(renderer.error!=null)throw new IllegalStateException(renderer.error);var images=AssetReviewCapture.capture(asset,renderer);client.setScreen(parent);success.accept(images);}catch(Exception e){client.setScreen(parent);failure.accept(e);}}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);d.drawCenteredTextWithShadow(textRenderer,"正在离屏渲染四个建筑视角…",width/2,height/2-10,StudioTheme.TEXT);d.drawCenteredTextWithShadow(textRenderer,"不含游戏世界、界面或桌面；尚未调用模型",width/2,height/2+10,StudioTheme.MUTED);super.render(d,mx,my,delta);}
    @Override public void removed(){renderer.close();}
    @Override public void close(){done=true;client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
