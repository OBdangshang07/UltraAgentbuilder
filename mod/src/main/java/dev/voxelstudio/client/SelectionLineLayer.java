package dev.voxelstudio.client;

import net.minecraft.client.render.*;
import java.util.List;

/** Color-only, depth-independent overlay. RenderLayer.getLines would re-enable
 * depth testing when it flushes, hiding underground/occluded selection bounds. */
final class SelectionLineLayer extends RenderLayer {
    static final RenderLayer INSTANCE=new SelectionLineLayer();
    private static List<RenderPhase> phases(){return List.of(LINES_PROGRAM,TRANSLUCENT_TRANSPARENCY,DISABLE_CULLING,ALWAYS_DEPTH_TEST,COLOR_MASK,FULL_LINE_WIDTH);}
    private SelectionLineLayer(){super("voxel_selection_lines",VertexFormats.LINES,VertexFormat.DrawMode.LINES,16384,false,false,()->phases().forEach(RenderPhase::startDrawing),()->{var p=phases();for(int i=p.size()-1;i>=0;i--)p.get(i).endDrawing();});}
}
