package dev.voxelstudio.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.List;
import java.util.function.BiConsumer;

/** Storage-only confirmation. Purge has two independent acknowledgements;
 * never reuse the unrelated world-navigation acknowledgement. */
final class StudioReferenceArchiveConfirmScreen extends Screen {
    private final Screen parent;
    private final String details,label,purpose;
    private final BiConsumer<Boolean,Boolean> proceed;
    private final ReferenceArchiveConfirmation consent;
    private List<net.minecraft.text.OrderedText> lines;
    private int scroll,x,w;
    private boolean active;
    private StudioTheme.Button action,deleteAck,copiesAck;
    StudioReferenceArchiveConfirmScreen(Screen parent,String title,String details,String label,String purpose,BiConsumer<Boolean,Boolean> proceed){
        super(Text.literal(title));consent=new ReferenceArchiveConfirmation(purpose);
        this.parent=parent;this.details=details;this.label=label;this.purpose=purpose;this.proceed=proceed;
    }
    private boolean purge(){return consent.purge();}
    @Override protected void init(){
        active=true;w=Math.max(160,Math.min(560,width-24));x=(width-w)/2;consent.resize();
        lines=textRenderer.wrapLines(Text.literal(details),w-24);scroll=StudioLayout.clampScroll(scroll,lines.size()*14,bodyHeight());
        var back=addDrawableChild(new StudioTheme.Button(x+8,height-33,(w-22)/2,23,"返回，不执行",StudioTheme.Kind.NORMAL,this::close));
        action=addDrawableChild(new StudioTheme.Button(x+14+(w-22)/2,height-33,(w-22)/2,23,label,purge()?StudioTheme.Kind.DANGER:StudioTheme.Kind.PRIMARY,()->{
            if(!active||client.currentScreen!=this||!consent.submit())return;action.active=false;proceed.accept(consent.deletion(),consent.copies());
        }));
        if(purge()){
            deleteAck=addDrawableChild(new StudioTheme.Button(x+8,height-88,w-16,22,"[ ] 接受永久删除这些归档文件，不可撤销",StudioTheme.Kind.NORMAL,()->{consent.toggleDeletion();update();}));
            copiesAck=addDrawableChild(new StudioTheme.Button(x+8,height-61,w-16,22,"[ ] 已知任务原图、模型回答及审计仍保留",StudioTheme.Kind.NORMAL,()->{consent.toggleCopies();update();}));
        }
        update();setInitialFocus(back);
    }
    private void update(){action.active=consent.ready();if(purge()){
        deleteAck.setMessage(Text.literal((consent.deletion()?"[✓]":"[ ]")+" 接受永久删除这些归档文件，不可撤销"));
        copiesAck.setMessage(Text.literal((consent.copies()?"[✓]":"[ ]")+" 已知任务原图、模型回答及审计仍保留"));deleteAck.active=copiesAck.active=!consent.submitted();
    }}
    private int bodyBottom(){return height-(purge()?100:46);}
    private int bodyHeight(){return Math.max(1,bodyBottom()-49);}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,10,w,height-20);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,title.getString(),w-16),x+8,23,purge()?StudioTheme.WARN:StudioTheme.ACCENT,false);
        d.enableScissor(x+7,47,x+w-7,bodyBottom());int y=49-scroll;for(var line:lines){d.drawText(textRenderer,line,x+10,y,StudioTheme.TEXT,false);y+=14;}d.disableScissor();super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll=StudioLayout.clampScroll(scroll-(int)(amount*28),lines.size()*14,bodyHeight());return true;}
    @Override public boolean keyPressed(int key,int scan,int mods){if(key==org.lwjgl.glfw.GLFW.GLFW_KEY_PAGE_DOWN||key==org.lwjgl.glfw.GLFW.GLFW_KEY_PAGE_UP){scroll=StudioLayout.clampScroll(scroll+(key==org.lwjgl.glfw.GLFW.GLFW_KEY_PAGE_DOWN?1:-1)*bodyHeight(),lines.size()*14,bodyHeight());return true;}return super.keyPressed(key,scan,mods);}
    @Override public void close(){client.setScreen(parent);}
    @Override public void removed(){active=false;}
    @Override public boolean shouldPause(){return false;}
}
