package dev.voxelstudio.client;

import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.widget.EditBoxWidget;
import net.minecraft.text.Text;

/** Native multiline editing plus the same IME focus notification used by single-line fields. */
final class StudioEditBoxWidget extends EditBoxWidget {
    StudioEditBoxWidget(TextRenderer renderer,int x,int y,int width,int height,Text placeholder,Text message){super(renderer,x,y,width,height,placeholder,message);}
    private boolean accepting(){return isFocused()&&active&&visible;}
    @Override public void tick(){super.tick();StudioImeCompat.tick(this,accepting());}
    @Override public boolean charTyped(char chr,int modifiers){
        if(StudioImeCompat.probe(this,chr,accepting()))return true;
        return accepting()&&super.charTyped(chr,modifiers);
    }
}
