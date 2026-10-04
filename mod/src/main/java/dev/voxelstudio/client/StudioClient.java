package dev.voxelstudio.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.*;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.*;
import net.fabricmc.fabric.api.resource.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.resource.*;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Vec3d;
import com.mojang.blaze3d.systems.RenderSystem;
import org.joml.Matrix4f;
import org.lwjgl.glfw.GLFW;

public final class StudioClient implements ClientModInitializer {
    public static final BridgeClient BRIDGE = StudioFlowSelfTest.bridge();
    public static final ProjectionController PROJECTION = new ProjectionController();
    static final SelectionController SELECTION = new SelectionController();
    static final WorldPatchPreviewController PATCH_PREVIEW = new WorldPatchPreviewController();
    private static final java.util.Map<String,KeyBinding> KEYS = new java.util.HashMap<>();
    private static Matrix4f worldView,worldProjection;
    private static Vec3d worldCamera;
    private static final net.minecraft.client.render.VertexConsumerProvider.Immediate OUTLINES=net.minecraft.client.render.VertexConsumerProvider.immediate(new net.minecraft.client.render.BufferBuilder(16384));
    private static KeyBinding key(String id, int code) { var binding=KeyBindingHelper.registerKeyBinding(new KeyBinding("key.voxel_studio." + id, InputUtil.Type.KEYSYM, code, "key.categories.voxel_studio"));KEYS.put(id,binding);return binding; }
    @Override public void onInitializeClient() {
        ProjectionRenderer.registerShader();
        var open = key("open", GLFW.GLFW_KEY_V); var lock = key("lock", GLFW.GLFW_KEY_K); var rotate = key("rotate", GLFW.GLFW_KEY_R); var mirror = key("mirror", GLFW.GLFW_KEY_M); var hide = key("hide", GLFW.GLFW_KEY_H);
        var west = key("west", GLFW.GLFW_KEY_LEFT); var east = key("east", GLFW.GLFW_KEY_RIGHT); var north = key("north", GLFW.GLFW_KEY_UP); var south = key("south", GLFW.GLFW_KEY_DOWN); var up = key("up", GLFW.GLFW_KEY_PAGE_UP); var down = key("down", GLFW.GLFW_KEY_PAGE_DOWN);
        var confirm = key("confirm", GLFW.GLFW_KEY_ENTER);
        var snap=key("snap",GLFW.GLFW_KEY_G);
        var selection=key("selection",GLFW.GLFW_KEY_B);
        var axis=key("axis",GLFW.GLFW_KEY_UNKNOWN);var draftUndo=key("draft_undo",GLFW.GLFW_KEY_UNKNOWN);var draftRedo=key("draft_redo",GLFW.GLFW_KEY_UNKNOWN);
        ClientTickEvents.END_CLIENT_TICK.register(c -> {
            StudioPresentationSelfTest.tick(c);
            StudioSelfTest.tick(c);
            StudioFlowSelfTest.tick(c);
            StudioUiSelfTest.tick(c);
            StudioAssetRenderSelfTest.tick(c);
            StudioEvidenceSelfTest.tick(c);
            StudioOnboardingSelfTest.tick(c);
            ProjectionRenderSelfTest.tick(c);
            StudioScreen.backgroundTick();
            StudioNativeEvidence.tick(c);
            SELECTION.tick(c);
            PATCH_PREVIEW.tick(c);
            SelectionSelfTest.tick(c);
            WorldPatchTransactionSelfTest.tick(c);
            if(StudioSelfTest.enabled()||SelectionSelfTest.enabled()||WorldPatchTransactionSelfTest.enabled()){
                // Only explicit isolated dev runs suppress human hotkeys. World
                // state tracking/rendering and all production placement guards stay active.
                for(var binding:KEYS.values())while(binding.wasPressed()){}
                PROJECTION.tick();return;
            }
            while (open.wasPressed()) if (c.player != null && c.currentScreen == null) c.setScreen(new StudioScreen());
            while (selection.wasPressed()) if (c.player != null && c.currentScreen == null) c.setScreen(new SelectionScreen(new StudioScreen()));
            PROJECTION.tick();
            if (c.currentScreen != null || PATCH_PREVIEW.preview()!=null || !PROJECTION.visible || PROJECTION.busy || PROJECTION.restoring) {for(var entry:KEYS.entrySet())if(!entry.getKey().equals("open"))while(entry.getValue().wasPressed()){}return;}
            int step = net.minecraft.client.gui.screen.Screen.hasControlDown() ? 8 : 1;
            while (lock.wasPressed()) PROJECTION.toggleLock(); while (rotate.wasPressed()) PROJECTION.rotate(); while (mirror.wasPressed()) PROJECTION.mirror(); while (hide.wasPressed()) PROJECTION.visible = false;
            while (west.wasPressed()) PROJECTION.move(-step,0,0); while (east.wasPressed()) PROJECTION.move(step,0,0); while (north.wasPressed()) PROJECTION.move(0,0,-step); while (south.wasPressed()) PROJECTION.move(0,0,step); while (up.wasPressed()) PROJECTION.move(0,step,0); while (down.wasPressed()) PROJECTION.move(0,-step,0);
            while(snap.wasPressed())PROJECTION.snapToSurface();
            while (confirm.wasPressed()) {if(!PROJECTION.locked)PROJECTION.toggleLock();else StudioScreen.confirmPlacement();}
            while(axis.wasPressed())PROJECTION.cycleAxis();while(draftUndo.wasPressed())PROJECTION.undoDraft();while(draftRedo.wasPressed())PROJECTION.redoDraft();
        });
        WorldRenderEvents.START.register(context->{worldView=new Matrix4f(context.matrixStack().peek().getPositionMatrix());worldProjection=new Matrix4f(context.projectionMatrix());worldCamera=context.camera().getPos();});
        HudRenderCallback.EVENT.register((draw, delta) -> StudioHud.render(draw,KEYS));
        ResourceManagerHelper.get(ResourceType.CLIENT_RESOURCES).registerReloadListener(new SimpleSynchronousResourceReloadListener() {
            @Override public Identifier getFabricId() { return new Identifier("voxel_studio", "projection_models"); }
            @Override public void reload(ResourceManager manager) { MinecraftClient.getInstance().execute(() -> { if (PROJECTION.asset != null) PROJECTION.renderer.rebuild(PROJECTION.placement()); PATCH_PREVIEW.reload(); }); }
        });
        ClientLifecycleEvents.CLIENT_STOPPING.register(c -> { StudioEvidenceShutdown.observe(c,true);PATCH_PREVIEW.close();SELECTION.close();StudioNativeEvidence.clear(); BRIDGE.close(); PROJECTION.close(); });
        ClientChunkEvents.CHUNK_LOAD.register((w,c)->dev.voxelstudio.WorldChangeTracker.chunk(w,c.getPos().x,c.getPos().z));
        ClientChunkEvents.CHUNK_UNLOAD.register((w,c)->dev.voxelstudio.WorldChangeTracker.chunk(w,c.getPos().x,c.getPos().z));
    }
    public static void renderProjectionAfterWorld(){
        if(worldView==null)return;
        int drawTarget=org.lwjgl.opengl.GL11.glGetInteger(org.lwjgl.opengl.GL30.GL_DRAW_FRAMEBUFFER_BINDING),readTarget=org.lwjgl.opengl.GL11.glGetInteger(org.lwjgl.opengl.GL30.GL_READ_FRAMEBUFFER_BINDING);
        int[] viewport=new int[4];org.lwjgl.opengl.GL11.glGetIntegerv(org.lwjgl.opengl.GL11.GL_VIEWPORT,viewport);
        try(var saved=new ProjectionRenderState()){
            MinecraftClient.getInstance().getFramebuffer().beginWrite(true);
            try(var selectionState=new ProjectionRenderState()){SELECTION.render(worldView,worldProjection,worldCamera);}
            try(var patchState=new ProjectionRenderState()){PATCH_PREVIEW.render(worldView,worldProjection,worldCamera);}
            var p = PROJECTION; if (!p.visible || p.asset == null) return;
            MinecraftClient.getInstance().getFramebuffer().beginWrite(true);
            Vec3d camera = worldCamera;
            Matrix4f matrix = new Matrix4f(worldView).translate((float)(p.anchor.getX()-camera.x), (float)(p.anchor.getY()-camera.y), (float)(p.anchor.getZ()-camera.z));
            ProjectionRenderSelfTest.beforeMesh();
            p.renderer.draw(matrix, worldProjection, p.opacity, p.materials, camera.subtract(Vec3d.of(p.anchor)));
            ProjectionRenderSelfTest.afterMesh(matrix,worldProjection,camera.subtract(Vec3d.of(p.anchor)));
            var lines = OUTLINES;
            var vertices = lines.getBuffer(net.minecraft.client.render.RenderLayer.getLines());
            var matrices = new net.minecraft.client.util.math.MatrixStack();matrices.multiplyPositionMatrix(worldView); matrices.push(); matrices.translate(-camera.x,-camera.y,-camera.z);
            net.minecraft.client.render.WorldRenderer.drawBox(matrices, vertices, p.anchor.getX(),p.anchor.getY(),p.anchor.getZ(),p.anchor.getX()+p.placement().width(),p.anchor.getY()+p.asset.height,p.anchor.getZ()+p.placement().length(),.3f,.8f,1f,.8f);
            // World-axis references, not editable world blocks or a claimed full drag gizmo.
            double ax=p.anchor.getX()+.5,ay=p.anchor.getY()+.5,az=p.anchor.getZ()+.5;
            for(int i=0;i<3;i++){double ex=ax+(i==0?3:0),ey=ay+(i==1?3:0),ez=az+(i==2?3:0);float r=i==0?1:.15f,g=i==1?1:.15f,b=i==2?1:.15f;
                net.minecraft.client.render.WorldRenderer.drawBox(matrices,vertices,ax-.025,ay-.025,az-.025,ex+.025,ey+.025,ez+.025,r,g,b,.95f);
                net.minecraft.client.render.WorldRenderer.drawBox(matrices,vertices,ex-.12,ey-.12,ez-.12,ex+.12,ey+.12,ez+.12,r,g,b,.95f);
            }
            for (var pos : p.conflictPositions) net.minecraft.client.render.WorldRenderer.drawBox(matrices, vertices, pos.getX(),pos.getY(),pos.getZ(),pos.getX()+1,pos.getY()+1,pos.getZ()+1,1f,.35f,.1f,.85f);
            for (var pos : p.unknownPositions) net.minecraft.client.render.WorldRenderer.drawBox(matrices, vertices, pos.getX(),pos.getY(),pos.getZ(),pos.getX()+1,pos.getY()+1,pos.getZ()+1,.8f,.3f,1f,.85f);
            matrices.pop(); lines.draw();
        }finally{org.lwjgl.opengl.GL30.glBindFramebuffer(org.lwjgl.opengl.GL30.GL_DRAW_FRAMEBUFFER,drawTarget);org.lwjgl.opengl.GL30.glBindFramebuffer(org.lwjgl.opengl.GL30.GL_READ_FRAMEBUFFER,readTarget);RenderSystem.viewport(viewport[0],viewport[1],viewport[2],viewport[3]);worldView=null;ProjectionRenderSelfTest.afterWorld();}
    }
}
