package dev.voxelstudio.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

final class StudioTheme {
    static final int BG=0xef0b121b, PANEL=0xff14212d, BORDER=0xff2b4050, TEXT=0xffe1edf5, MUTED=0xff93aabc,
        ACCENT=0xff70e0c4, WARN=0xffffc285, ERROR=0xffff9393;
    enum Kind { NORMAL, PRIMARY, DANGER, SELECTED }
    static void panel(DrawContext d,int x,int y,int w,int h) { d.fill(x,y,x+w,y+h,PANEL); border(d,x,y,w,h,BORDER); }
    static void border(DrawContext d,int x,int y,int w,int h,int color) {
        d.fill(x,y,x+w,y+1,color);d.fill(x,y+h-1,x+w,y+h,color);d.fill(x,y,x+1,y+h,color);d.fill(x+w-1,y,x+w,y+h,color);
    }
    static String fit(TextRenderer r,String text,int width) { return r.getWidth(text)<=width?text:r.trimToWidth(text,Math.max(0,width-r.getWidth("…")))+"…"; }
    static class Button extends ButtonWidget {
        private final Kind kind;
        Button(int x,int y,int w,int h,String text,Kind kind,Runnable action) {
            super(x,y,w,h,Text.literal(text),b->action.run(),DEFAULT_NARRATION_SUPPLIER);this.kind=kind;
            setTooltip(Tooltip.of(Text.literal(text)));setTooltipDelay(350);
        }
        @Override protected void renderButton(DrawContext d,int mx,int my,float delta) {
            boolean hot=isHovered()||isFocused();
            int fill=!active?0xff182631:kind==Kind.PRIMARY?(hot?0xff8debd5:ACCENT):kind==Kind.DANGER?(hot?0xff683c46:0xff3e2834):kind==Kind.SELECTED?0xff234b4d:hot?0xff304657:0xff203342;
            int ink=!active?0xff627b8c:kind==Kind.PRIMARY?0xff102d2a:kind==Kind.DANGER?ERROR:kind==Kind.SELECTED?ACCENT:TEXT;
            d.fill(getX(),getY(),getX()+width,getY()+height,fill);
            border(d,getX(),getY(),width,height,isFocused()?0xfff1fafb:hot?ACCENT:BORDER);
            var r=MinecraftClient.getInstance().textRenderer;
            String label=fit(r,getMessage().getString(),width-12);
            d.drawText(r,label,getX()+(width-r.getWidth(label))/2,getY()+(height-8)/2,ink,false);
        }
    }
}
