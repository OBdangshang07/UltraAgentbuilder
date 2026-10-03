package dev.voxelstudio.client;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.voxelstudio.*;
import net.minecraft.block.*;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.VertexBuffer;
import net.minecraft.client.render.*;
import net.minecraft.client.render.model.*;
import net.minecraft.client.texture.SpriteAtlasTexture;
import net.minecraft.fluid.FluidState;
import net.minecraft.util.math.*;
import net.minecraft.util.math.random.Random;
import net.minecraft.world.BlockRenderView;
import net.minecraft.world.biome.ColorResolver;
import net.minecraft.world.chunk.light.LightingProvider;
import org.joml.Matrix4f;
import java.util.*;
import java.util.concurrent.*;

/** Cached block-model meshes: translation does not rebuild geometry or call the agent. */
public final class ProjectionRenderer implements AutoCloseable {
    public static net.minecraft.client.gl.ShaderProgram program;
    public static void registerShader(){net.fabricmc.fabric.api.client.rendering.v1.CoreShaderRegistrationCallback.EVENT.register(context->context.register(new net.minecraft.util.Identifier("voxel_studio","projection"),VertexFormats.POSITION_COLOR_TEXTURE,shader->program=shader));}
    private final ExecutorService worker = new ThreadPoolExecutor(1,1,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1),r -> { Thread t = new Thread(r, "voxel-mesh"); t.setDaemon(true); return t; },new ThreadPoolExecutor.DiscardOldestPolicy());
    private final List<Mesh> meshes = new ArrayList<>();
    private final List<Mesh> sorted=new ArrayList<>();
    private Vec3d sortedCamera;
    public int cutLayer=-1;
    /** Asset-only section band; zero preserves the ordinary preview/projection behavior. */
    public int minLayer=0;
    /** Asset-only section clipping; defaults leave normal projection unchanged. */
    public int minX=0,minZ=0,maxX=-1,maxZ=-1;
    public boolean night,singleLayer;
    public volatile long faceCount,buildMillis;
    public double drawCpuMillis;
    /** Successful real mesh draws, including hidden-window development runs. */
    public long completedDraws;
    private volatile long generation;
    public volatile boolean building;
    public volatile String error;
    private record Mesh(VertexBuffer buffer, float x, float y, float z) {}
    public void rebuild(Placement placement) {
        long ticket = ++generation; release(); building = true; error = null;
        var client = MinecraftClient.getInstance();int cutoff=cutLayer,bottom=minLayer,left=minX,near=minZ,right=maxX<0?placement.width():maxX,far=maxZ<0?placement.length():maxZ;boolean dark=night,onlyLayer=singleLayer;long started=System.nanoTime();faceCount=0;
        worker.execute(() -> {
            try {
                if(bottom<0||bottom>=placement.asset().height||cutoff>=0&&bottom>cutoff)throw new IllegalArgumentException("Invalid section band");
                if(left<0||near<0||right>placement.width()||far>placement.length()||right<=left||far<=near)throw new IllegalArgumentException("Invalid asset section clip");
                var view = new View(placement,cutoff,bottom,onlyLayer,left,near,right,far); Random random = Random.create(42); long faces = 0;
                for (int cy = 0; cy < placement.asset().height; cy += 16) for (int cz = 0; cz < placement.length(); cz += 16) for (int cx = 0; cx < placement.width(); cx += 16) {
                    if (generation != ticket) return;
                    BufferBuilder buffer = new BufferBuilder(65536); buffer.begin(VertexFormat.DrawMode.QUADS, VertexFormats.POSITION_COLOR_TEXTURE);
                    for (int y = cy; y < Math.min(cy + 16, placement.asset().height); y++) for (int z = cz; z < Math.min(cz + 16, placement.length()); z++) for (int x = cx; x < Math.min(cx + 16, placement.width()); x++) {
                        BlockPos pos = new BlockPos(x, y, z); BlockState state = view.getBlockState(pos);
                        if (state.getRenderType() != BlockRenderType.MODEL) continue;
                        BakedModel model = client.getBlockRenderManager().getModel(state);
                        for (int f = 0; f < 7; f++) {
                            Direction dir = f < 6 ? Direction.values()[f] : null;
                            if (dir != null) {
                                BlockPos neighbor = pos.offset(dir); BlockState other = view.getBlockState(neighbor);
                                if (other.isOpaqueFullCube(view, neighbor) || state.isSideInvisible(other, dir)) continue;
                            }
                            random.setSeed(state.getRenderingSeed(pos));
                            for (BakedQuad quad : model.getQuads(state, dir, random)) {
                                if (++faces > 2000000) throw new IllegalStateException("Preview face quota exceeded; use a smaller building");
                                int tint = quad.hasColor() ? client.getBlockColors().getColor(state, view, pos, quad.getColorIndex()) : 0xffffff;
                                float shade = state.getLuminance() > 0 ? 1 : switch (quad.getFace()) { case DOWN -> .55f; case NORTH, SOUTH -> .8f; case EAST, WEST -> .7f; default -> 1f; };
                                if(dark&&state.getLuminance()==0)shade*=.22f;
                                int[] v = quad.getVertexData(); int stride = v.length / 4;
                                for (int k = 0; k < 4; k++) {
                                    int at = k * stride;
                                    buffer.vertex(x + Float.intBitsToFloat(v[at]), y + Float.intBitsToFloat(v[at+1]), z + Float.intBitsToFloat(v[at+2]))
                                        .color((int)((tint >> 16 & 255) * shade), (int)((tint >> 8 & 255) * shade), (int)((tint & 255) * shade), 255)
                                        .texture(Float.intBitsToFloat(v[at+4]), Float.intBitsToFloat(v[at+5])).next();
                                }
                            }
                        }
                    }
                    BufferBuilder.BuiltBuffer built = buffer.endNullable();
                    if (built == null) continue;
                    float mx = cx + 8, my = cy + 8, mz = cz + 8;
                    // One upload at a time bounds outstanding off-heap mesh memory.
                    CompletableFuture<Void> uploaded = new CompletableFuture<>();
                    client.execute(() -> {
                        try {
                            if (generation != ticket) { built.release(); return; }
                            VertexBuffer gpu = new VertexBuffer(VertexBuffer.Usage.STATIC); gpu.bind(); gpu.upload(built); VertexBuffer.unbind();
                            meshes.add(new Mesh(gpu, mx, my, mz));
                        } finally { uploaded.complete(null); }
                    });
                    uploaded.get(30, TimeUnit.SECONDS);
                    faceCount=faces;
                }
                client.execute(() -> { if (generation == ticket) {building = false;buildMillis=(System.nanoTime()-started)/1_000_000;} });
            } catch (Exception e) { client.execute(() -> { if (generation == ticket) { error = e.getMessage(); building = false; } }); }
        });
    }
    public void draw(Matrix4f modelView, Matrix4f projection, float opacity, boolean materials, Vec3d localCamera) {
        draw(modelView,projection,opacity,materials,localCamera,false);
    }
    /** Depth writes are enabled only for opaque, asset-only review captures. */
    public void draw(Matrix4f modelView, Matrix4f projection, float opacity, boolean materials, Vec3d localCamera,boolean opaqueCapture) {
        if (meshes.isEmpty()||program==null) return;
        long started=System.nanoTime();
        try(var saved=new ProjectionRenderState()){
        RenderSystem.enableBlend(); RenderSystem.defaultBlendFunc(); RenderSystem.enableDepthTest(); RenderSystem.depthMask(opaqueCapture); RenderSystem.disableCull();
        RenderSystem.setShaderColor(1, 1, 1, opacity); RenderSystem.setShaderTexture(0, SpriteAtlasTexture.BLOCK_ATLAS_TEXTURE);
        program.getUniform("UseTexture").set(materials?1f:0f);
        if(sorted.size()!=meshes.size()||sortedCamera==null||sortedCamera.squaredDistanceTo(localCamera)>.25){sorted.clear();sorted.addAll(meshes);sorted.sort(Comparator.comparingDouble((Mesh m) -> localCamera.squaredDistanceTo(m.x, m.y, m.z)).reversed());sortedCamera=localCamera;}
        try{for (Mesh mesh : sorted) { mesh.buffer.bind(); mesh.buffer.draw(modelView, projection, program); }}finally{VertexBuffer.unbind();}
        }
        completedDraws++;
        drawCpuMillis=(System.nanoTime()-started)/1_000_000.0;
    }
    private void release() { for (Mesh mesh : meshes) mesh.buffer.close(); meshes.clear();sorted.clear();sortedCamera=null; }
    public void clear() { generation++; release(); building = false; }
    @Override public void close() { clear(); worker.shutdownNow(); }
    private static class View implements BlockRenderView {
        private final Placement p;
        private final int cut,bottom;
        private final int left,near,right,far;
        private final boolean single;
        View(Placement p,int cut,int bottom,boolean single,int left,int near,int right,int far) { this.p = p;this.cut=cut;this.bottom=bottom;this.single=single;this.left=left;this.near=near;this.right=right;this.far=far; }
        @Override public BlockState getBlockState(BlockPos pos) {
            int x = pos.getX(), y = pos.getY(), z = pos.getZ();
            if (x < left || z < near || y < bottom || x >= right || z >= far || y >= p.asset().height||cut>=0&&(y>cut||single&&y!=cut)) return Blocks.AIR.getDefaultState();
            int a = x, b = z;
            switch(p.rotation()) { case 1 -> { a = z; b = p.asset().length - 1 - x; } case 2 -> { a = p.asset().width - 1 - x; b = p.asset().length - 1 - z; } case 3 -> { a = p.asset().width - 1 - z; b = x; } }
            if (p.mirror()) a = p.asset().width - 1 - a;
            return p.state(p.asset().index(a,y,b));
        }
        @Override public BlockEntity getBlockEntity(BlockPos pos) { return null; }
        @Override public FluidState getFluidState(BlockPos pos) { return getBlockState(pos).getFluidState(); }
        @Override public int getHeight() { return p.asset().height; }
        @Override public int getBottomY() { return 0; }
        @Override public float getBrightness(Direction d, boolean shaded) { return 1; }
        @Override public LightingProvider getLightingProvider() { return null; }
        @Override public int getColor(BlockPos p, ColorResolver resolver) { return 0x91bd59; }
        @Override public int getLightLevel(net.minecraft.world.LightType type, BlockPos p) { return 15; }
    }
}
