package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import java.util.*;

/** Separate display-only lifecycle. No building controller or writer route. */
final class AssemblyPatchPreviewController implements AutoCloseable {
    final WorldPatchPreviewRenderer renderer=new WorldPatchPreviewRenderer();
    private AssemblyPatchPreview preview;
    private AssemblyPatchCheckedCandidate candidate;
    private WorldPatchPreview.Filter filter;
    private boolean pending,closed;
    boolean visible=true;
    int lastVisibleMarkers,lastRemovedMarkers;
    String message="整组预览尚未加载；没有建造权限";
    private final VertexConsumerProvider.Immediate lines=VertexConsumerProvider.immediate(new BufferBuilder(16384));
    AssemblyPatchPreview preview(){return preview;}
    AssemblyPatchCheckedCandidate candidate(){return candidate;}
    WorldPatchPreview.Filter filter(){return filter;}
    /** The background whole loader and same-Capture client fences must verify
     * the exact original snapshot upstream. This local method grants no write. */
    void showReadOnly(AssemblyPatchCheckedCandidate value){if(closed)throw new IllegalStateException("Preview closed");Objects.requireNonNull(value);clear();candidate=value;preview=value.preview();filter=preview.all(WorldPatchPreview.Mode.CHANGES);StudioClient.PATCH_PREVIEW.clear();StudioClient.PROJECTION.visible=false;visible=true;pending=true;message="完整整组差异 · 固定原位置 · 应用需独立确认";}
    void filter(WorldPatchPreview.Filter next){if(preview==null)throw new IllegalStateException("No preview");filter=preview.checked(next);renderer.clear();pending=true;}
    void reload(){if(preview!=null){renderer.clear();pending=true;}}
    void tick(MinecraftClient c){
        if(preview==null||closed)return;
        var tool=StudioClient.SELECTION;
        if(c.world==null||c.player==null||!tool.matchesAssembly(preview.binding())){clear();message="世界、选区或原快照已失效；差异预览清空";return;}
        if(pending&&renderer.idle()){pending=false;renderer.rebuild(preview,filter);}
    }
    void render(Matrix4f view,Matrix4f projection,Vec3d camera){
        lastVisibleMarkers=lastRemovedMarkers=0;
        if(preview==null||!visible||pending)return;
        renderer.draw(view,projection,camera);
        // Color-only outline makes deletions/replaced BEFORE distinguishable
        // even when the original world surface is opaque. It never clears it.
        var stack=new MatrixStack();stack.multiplyPositionMatrix(view);var vertices=lines.getBuffer(SelectionLineLayer.INSTANCE);int count=0;
        markers: for(var section:preview.sections())for(var row:section.rows()){
            if(!filter.includes(row))continue;
            // AFTER is an overlay, not a replacement world renderer. Keep a
            // red deletion marker even though target AIR has no model, so the
            // unchanged live block cannot be mistaken for a proposed keep.
            boolean deletion=filter.mode()==WorldPatchPreview.Mode.AFTER&&row.difference()==WorldPatchPreview.Difference.REMOVED;
            if(!deletion&&WorldPatchPreview.displayState(row,filter.mode(),true)==null&&WorldPatchPreview.displayState(row,filter.mode(),false)==null)continue;
            // Bounded emphasis overlay, not a claim that a partial filter is
            // a partial patch. Large previews retain full native mesh content.
            if(count++>=4096)break markers;
            lastVisibleMarkers++;if(row.difference()==WorldPatchPreview.Difference.REMOVED)lastRemovedMarkers++;
            var p=row.position();float r=row.difference()==WorldPatchPreview.Difference.ADDED?.25f:1,g=row.difference()==WorldPatchPreview.Difference.REMOVED?.25f:.8f,b=row.difference()==WorldPatchPreview.Difference.ADDED?1:.25f;
            WorldRenderer.drawBox(stack,vertices,p.x()-camera.x-.002,p.y()-camera.y-.002,p.z()-camera.z-.002,p.x()+1-camera.x+.002,p.y()+1-camera.y+.002,p.z()+1-camera.z+.002,r,g,b,.85f);
        }lines.draw();
    }
    void clear(){renderer.clear();preview=null;candidate=null;filter=null;pending=false;lastVisibleMarkers=lastRemovedMarkers=0;message="整组预览已清空；没有建造权限";}
    @Override public void close(){if(closed)return;clear();closed=true;renderer.close();}
}
