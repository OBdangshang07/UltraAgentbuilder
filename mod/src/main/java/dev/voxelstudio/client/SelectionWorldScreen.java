package dev.voxelstudio.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/** Explicit mouse-capture tool over the world. All clicks/scrolls are consumed,
 * so vanilla mining, placement, hotbar and projection cannot fire underneath. */
class SelectionWorldScreen extends Screen {
    private final Screen parent;private final SelectionController tool=StudioClient.SELECTION;
    SelectionWorldScreen(Screen parent){super(Text.literal("只读世界选区"));this.parent=parent;}
    @Override protected void init(){tool.visible=true;addDrawableChild(new StudioTheme.Button(12,height-34,150,22,"返回选区面板",StudioTheme.Kind.NORMAL,this::close));addDrawableChild(new StudioTheme.Button(168,height-34,150,22,"返回游戏移动视角",StudioTheme.Kind.NORMAL,()->client.setScreen(null)));}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(8,8,width-8,61,0xd9101d28);d.drawText(textRenderer,"只读选区 · 左键第一点 / 右键第二点 · Shift+左键拖动边界",16,15,StudioTheme.ACCENT,false);
        d.drawText(textRenderer,"不挖掘、不放置；Esc 返回面板。返回游戏移动视角后，按 B 重进选区。",16,29,StudioTheme.MUTED,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,tool.message,width-32),16,43,StudioTheme.WARN,false);
        super.render(d,mx,my,delta);
    }
    @Override public boolean mouseClicked(double x,double y,int button){
        if(y>=height-40||y<65){super.mouseClicked(x,y,button);return true;}
        if(!tool.ready())return true;
        if(button==0&&boundaryDragRequested()){tool.beginDrag(x,y);return true;}
        try{var p=tool.point(x,y);if(button==0)tool.first(p);else if(button==1)tool.second(p);}catch(Exception e){tool.message=e.getMessage();}
        return true;
    }
    @Override public boolean mouseDragged(double x,double y,int button,double dx,double dy){if(button==0)tool.drag(x,y);return true;}
    /** Separate modifier query also lets the opt-in in-game test dispatch the
     * real drag event path without synthesizing desktop keyboard input. */
    protected boolean boundaryDragRequested(){return hasShiftDown();}
    @Override public boolean mouseReleased(double x,double y,int button){tool.endDrag();return true;}
    @Override public boolean mouseScrolled(double x,double y,double amount){return true;}
    @Override public void removed(){tool.endDrag();}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
