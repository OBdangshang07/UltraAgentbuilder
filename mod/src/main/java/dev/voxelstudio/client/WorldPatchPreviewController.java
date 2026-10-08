package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import java.util.*;

/** Separate display-only lifecycle. No building controller or writer route. */
final class WorldPatchPreviewController implements AutoCloseable {
    final WorldPatchPreviewRenderer renderer=new WorldPatchPreviewRenderer();
    private WorldPatchPreview preview;
    private WorldPatchCheckedCandidate candidate;
    private WorldPatchPreview.Filter filter;
    private boolean pending,closed;
    boolean visible=true;
    int lastVisibleMarkers,lastRemovedMarkers;
    String message="改造预览尚未接入；没有建造权限";
    private final VertexConsumerProvider.Immediate lines=VertexConsumerProvider.immediate(new BufferBuilder(16384));
    WorldPatchPreview preview(){return preview;}
    WorldPatchCheckedCandidate candidate(){return candidate;}
    WorldPatchPreview.Filter filter(){return filter;}
    /** Deliberately no production loader: caller must first verify the exact
     * original snapshot and patch upstream. This local method grants no write. */
    void showReadOnly(WorldPatchPreview value){if(closed)throw new IllegalStateException("Preview closed");Objects.requireNonNull(value);clear();preview=value;filter=value.all(WorldPatchPreview.Mode.CHANGES);StudioClient.PROJECTION.visible=false;visible=true;pending=true;message="实验差异预览 · 原世界位置 · 不可建造";}
    void showAuditableReadOnly(WorldPatchCheckedCandidate value){Objects.requireNonNull(value);showReadOnly(value.preview());candidate=value;}
    void filter(WorldPatchPreview.Filter next){if(preview==null)throw new IllegalStateException("No preview");filter=preview.checked(next);renderer.clear();pending=true;}
    void reload(){if(preview!=null){renderer.clear();pending=true;}}
    void tick(MinecraftClient c){
        if(preview==null||closed)return;
        var tool=StudioClient.SELECTION;
        if(c.world==null||c.player==null||!tool.matchesPreview(preview.binding())){clear();message="世界、选区或原快照已失效；差异预览清空";return;}
        if(pending&&renderer.idle()){pending=false;renderer.rebuild(preview,filter);}
    }
    void render(Matrix4f view,Matrix4f projection,Vec3d camera){
        lastVisibleMarkers=lastRemovedMarkers=0;
        if(preview==null||!visible||pending)return;
        renderer.draw(view,projection,camera);
        // Color-only outline makes deletions/replaced BEFORE distinguishable
        // even when the original world surface is opaque. It never clears it.
        var stack=new MatrixStack();stack.multiplyPositionMatrix(view);var vertices=lines.getBuffer(SelectionLineLayer.INSTANCE);int count=0;
        for(var section:preview.sections())for(var row:section.rows()){
            if(!filter.includes(row))continue;
            // AFTER is an overlay, not a replacement world renderer. Keep a
            // red deletion marker even though target AIR has no model, so the
            // unchanged live block cannot be mistaken for a proposed keep.
            boolean deletion=filter.mode()==WorldPatchPreview.Mode.AFTER&&row.difference()==WorldPatchPreview.Difference.REMOVED;
            if(!deletion&&WorldPatchPreview.displayState(row,filter.mode(),true)==null&&WorldPatchPreview.displayState(row,filter.mode(),false)==null)continue;
            // Bounded emphasis overlay, not a claim that a partial filter is
            // a partial patch. Large previews retain full native mesh content.
            if(count++>=4096)break;
            lastVisibleMarkers++;if(row.difference()==WorldPatchPreview.Difference.REMOVED)lastRemovedMarkers++;
            var p=row.position();float r=row.difference()==WorldPatchPreview.Difference.ADDED?.25f:1,g=row.difference()==WorldPatchPreview.Difference.REMOVED?.25f:.8f,b=row.difference()==WorldPatchPreview.Difference.ADDED?1:.25f;
            WorldRenderer.drawBox(stack,vertices,p.x()-camera.x-.002,p.y()-camera.y-.002,p.z()-camera.z-.002,p.x()+1-camera.x+.002,p.y()+1-camera.y+.002,p.z()+1-camera.z+.002,r,g,b,.85f);
        }lines.draw();
    }
    void clear(){renderer.clear();preview=null;candidate=null;filter=null;pending=false;lastVisibleMarkers=lastRemovedMarkers=0;}
    @Override public void close(){if(closed)return;clear();closed=true;renderer.close();}
}
