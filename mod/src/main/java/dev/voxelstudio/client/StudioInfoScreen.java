package dev.voxelstudio.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;

/** Scrollable full details, also used for frozen world-write confirmations. */
final class StudioInfoScreen extends Screen {
    private final Screen parent;private final String details,actionLabel;private final Runnable action;
    private final boolean danger;private int scroll,x,w;
    private final boolean requireAcknowledgement;private boolean acknowledged;private StudioTheme.Button proceed,acknowledge;
    private List<net.minecraft.text.OrderedText> lines;
    StudioInfoScreen(Screen parent,String title,String details) {this(parent,title,details,"复制详情",false,()->net.minecraft.client.MinecraftClient.getInstance().keyboard.setClipboard(details));}
    StudioInfoScreen(Screen parent,String title,String details,String actionLabel,boolean danger,Runnable action) {this(parent,title,details,actionLabel,danger,false,action);}
    StudioInfoScreen(Screen parent,String title,String details,String actionLabel,boolean danger,boolean requireAcknowledgement,Runnable action) {super(Text.literal(title));this.parent=parent;this.details=details;this.actionLabel=actionLabel;this.danger=danger;this.requireAcknowledgement=requireAcknowledgement;this.action=action;}
    @Override protected void init(){
        w=Math.min(490,width-32);x=(width-w)/2;lines=textRenderer.wrapLines(Text.literal(details),w-28);
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-42,(w-30)/2,24,danger?"返回检查":"返回",StudioTheme.Kind.NORMAL,this::close));
        acknowledged=false;
        proceed=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-42,(w-30)/2,24,actionLabel,danger?StudioTheme.Kind.DANGER:StudioTheme.Kind.PRIMARY,()->{if(!requireAcknowledgement||acknowledged)action.run();}));proceed.active=!requireAcknowledgement;
        if(requireAcknowledgement)acknowledge=addDrawableChild(new StudioTheme.Button(x+12,height-71,w-24,22,"[ ] 我确认：通行未验证，仍要建造",StudioTheme.Kind.NORMAL,()->{acknowledged=!acknowledged;acknowledge.setMessage(Text.literal((acknowledged?"[✓]":"[ ]")+" 我确认：通行未验证，仍要建造"));proceed.active=acknowledged;}));
        setInitialFocus(back);
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,14,w,height-28);
        d.drawText(textRenderer,title,x+12,26,danger?StudioTheme.WARN:StudioTheme.ACCENT,false);
        d.enableScissor(x+10,47,x+w-10,height-(requireAcknowledgement?83:53));
        int y=49-scroll;for(var line:lines){d.drawText(textRenderer,line,x+14,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();
        if(lines.size()*14>height-bodyReserved())d.drawText(textRenderer,"滚轮查看完整内容",x+12,height-(requireAcknowledgement?83:53),StudioTheme.MUTED,false);
        super.render(d,mx,my,delta);
    }
    private int bodyReserved(){return requireAcknowledgement?134:104;}
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,height-bodyReserved());return true;}
    @Override public boolean keyPressed(int key,int scan,int mods){if(key==org.lwjgl.glfw.GLFW.GLFW_KEY_PAGE_DOWN||key==org.lwjgl.glfw.GLFW.GLFW_KEY_PAGE_UP){scroll=StudioLayout.clampScroll(scroll+(key==org.lwjgl.glfw.GLFW.GLFW_KEY_PAGE_DOWN?1:-1)*Math.max(28,height-120),lines.size()*14,height-bodyReserved());return true;}return super.keyPressed(key,scan,mods);}
    void auditAcknowledgement(){if(!requireAcknowledgement||proceed.active)throw new IllegalStateException("Unverified build enabled without acknowledgement");proceed.onPress();acknowledge.onPress();if(!proceed.active)throw new IllegalStateException("Explicit acknowledgement did not enable action");acknowledge.onPress();if(proceed.active)throw new IllegalStateException("Unchecking acknowledgement did not disable action");proceed.onPress();}
    void auditScrollTo(String marker){
        for(int i=0;i<lines.size();i++){var text=new StringBuilder();lines.get(i).accept((index,style,point)->{text.appendCodePoint(point);return true;});if(text.toString().contains(marker)){scroll=StudioLayout.clampScroll(i*14,lines.size()*14,height-bodyReserved());return;}}
        throw new IllegalStateException("Missing expected details section: "+marker);
    }
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
