package dev.voxelstudio.client;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.voxelstudio.selection.*;
import net.minecraft.block.*;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.VertexBuffer;
import net.minecraft.client.render.*;
import net.minecraft.client.render.model.BakedQuad;
import net.minecraft.client.texture.SpriteAtlasTexture;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.fluid.FluidState;
import net.minecraft.registry.Registries;
import net.minecraft.util.math.*;
import net.minecraft.util.math.random.Random;
import net.minecraft.world.BlockRenderView;
import net.minecraft.world.biome.ColorResolver;
import net.minecraft.world.chunk.light.LightingProvider;
import org.joml.Matrix4f;
import java.util.*;
import java.util.concurrent.*;

/** Sparse, fixed-world-coordinate read-only overlay. No Asset, Placement,
 * model call or block writer. Original/proposed meshes stay distinct. */
final class WorldPatchPreviewRenderer implements AutoCloseable {
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{var t=new Thread(r,"voxel-patch-mesh");t.setDaemon(true);return t;});
    private record Mesh(VertexBuffer buffer,int x,int y,int z,boolean original){}
    private final List<Mesh> meshes=new ArrayList<>();
    private volatile long generation;
    private volatile boolean cpuBusy;
    private boolean closed;
    volatile boolean building;
    volatile String error;
    volatile long faces,buildMillis;
    long completedDraws;
    /** Never queues work: controller waits for the previous worker to finish. */
    boolean idle(){return !cpuBusy;}
    void rebuild(WorldPatchPreview preview,WorldPatchPreview.Filter filter){
        rebuild((WorldDifferenceView)preview,filter);
    }
    /** Shared geometry only: this does not convert a whole set into the
     * legacy candidate, binding or placement lifecycle. */
    void rebuild(WorldDifferenceView preview,WorldPatchPreview.Filter filter){
        if(closed||cpuBusy)throw new IllegalStateException("Patch renderer unavailable/busy");
        preview.checked(filter);long ticket=++generation;release();building=cpuBusy=true;error=null;faces=0;long started=System.nanoTime();
        var client=MinecraftClient.getInstance();
        worker.execute(()->{
            try{
                var states=new HashMap<String,BlockState>();
                for(var text:preview.palette()){
                    if(ticket!=generation)return;
                    var state=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
                    if(state.hasBlockEntity()||!state.getFluidState().isEmpty()||!state.isAir()&&state.getRenderType()!=BlockRenderType.MODEL)throw new IllegalArgumentException("Unsupported static preview state: "+text);
                    states.put(text,state);
                }
                var random=Random.create(42);long builtFaces=0;
                for(boolean original:new boolean[]{true,false}){
                    var view=new View(preview,filter,states,original);
                    for(var section:preview.sections()){
                        if(ticket!=generation)return;
                        var buffer=new BufferBuilder(65536);buffer.begin(VertexFormat.DrawMode.QUADS,VertexFormats.POSITION_COLOR_TEXTURE);
                        BufferBuilder.BuiltBuffer built=null;
                        try{
                            for(var row:section.rows()){
                                if(ticket!=generation)return;
                                if(!filter.includes(row))continue;
                                String text=WorldPatchPreview.displayState(row,filter.mode(),original);if(text==null)continue;
                                var point=row.position();var pos=new BlockPos(point.x(),point.y(),point.z());var state=states.get(text);var model=client.getBlockRenderManager().getModel(state);
                                int color=filter.mode()==WorldPatchPreview.Mode.CHANGES?(original?0xff6666:row.difference()==WorldPatchPreview.Difference.ADDED?0x77ffd5:0xffd277):0xffffff;
                                int alpha=filter.mode()==WorldPatchPreview.Mode.CHANGES&&original&&row.difference()==WorldPatchPreview.Difference.REPLACED?75:185;
                                for(int f=0;f<7;f++){
                                    Direction side=f<6?Direction.values()[f]:null;
                                    if(side!=null){var neighbor=pos.offset(side);var other=view.getBlockState(neighbor);if(other.isOpaqueFullCube(view,neighbor)||state.isSideInvisible(other,side))continue;}
                                    random.setSeed(state.getRenderingSeed(pos));
                                    for(BakedQuad quad:model.getQuads(state,side,random)){
                                        if(++builtFaces>2_000_000)throw new IllegalStateException("Patch preview face quota exceeded");
                                        int tint=quad.hasColor()?client.getBlockColors().getColor(state,view,pos,quad.getColorIndex()):0xffffff;
                                        float shade=switch(quad.getFace()){case DOWN->.55f;case NORTH,SOUTH->.8f;case EAST,WEST->.7f;default->1f;};
                                        int[] vertices=quad.getVertexData();int stride=vertices.length/4;
                                        for(int k=0;k<4;k++){
                                            int at=k*stride;
                                            // Visual-only 0.2% surface separation prevents fighting with
                                            // the unchanged live world. Original coordinates are untouched.
                                            float vx=(Float.intBitsToFloat(vertices[at])-.5f)*1.004f+.5f;
                                            float vy=(Float.intBitsToFloat(vertices[at+1])-.5f)*1.004f+.5f;
                                            float vz=(Float.intBitsToFloat(vertices[at+2])-.5f)*1.004f+.5f;
                                            buffer.vertex(point.x()-section.x()*16+vx,point.y()-section.y()*16+vy,point.z()-section.z()*16+vz)
                                                .color((int)((tint>>16&255)*(color>>16&255)/255f*shade),(int)((tint>>8&255)*(color>>8&255)/255f*shade),(int)((tint&255)*(color&255)/255f*shade),alpha)
                                                .texture(Float.intBitsToFloat(vertices[at+4]),Float.intBitsToFloat(vertices[at+5])).next();
                                        }
                                    }
                                }
                            }
                            built=buffer.endNullable();
                        }finally{
                            // Cancellation/exception before end must release the active
                            // native buffer, not retain an incomplete section for adoption.
                            if(buffer.isBuilding()){var abandoned=buffer.endNullable();if(abandoned!=null)abandoned.release();}
                        }
                        if(built==null)continue;
                        var ready=built;var uploaded=new CompletableFuture<Void>();
                        client.execute(()->{
                            VertexBuffer gpu=null;try{
                                if(closed||ticket!=generation){ready.release();return;}
                                gpu=new VertexBuffer(VertexBuffer.Usage.STATIC);gpu.bind();gpu.upload(ready);VertexBuffer.unbind();meshes.add(new Mesh(gpu,section.x()*16,section.y()*16,section.z()*16,original));gpu=null;
                            }catch(Throwable failure){uploaded.completeExceptionally(failure);}finally{if(gpu!=null)gpu.close();VertexBuffer.unbind();uploaded.complete(null);}
                        });
                        uploaded.get(30,TimeUnit.SECONDS);faces=builtFaces;
                    }
                }
                client.execute(()->{if(ticket==generation&&!closed){building=false;buildMillis=(System.nanoTime()-started)/1_000_000;}});
            }catch(Exception failure){client.execute(()->{if(ticket==generation&&!closed){generation++;release();error=String.valueOf(failure.getMessage());building=false;}});}
            finally{cpuBusy=false;}
        });
    }
    void draw(Matrix4f view,Matrix4f projection,Vec3d camera){
        if(closed||building||error!=null||meshes.isEmpty()||ProjectionRenderer.program==null)return;
        var sorted=new ArrayList<>(meshes);sorted.sort(Comparator.comparingDouble((Mesh m)->camera.squaredDistanceTo(m.x+8,m.y+8,m.z+8)).reversed().thenComparing(m->!m.original));
        try(var saved=new ProjectionRenderState()){
            RenderSystem.enableBlend();RenderSystem.defaultBlendFunc();RenderSystem.enableDepthTest();RenderSystem.depthMask(false);RenderSystem.disableCull();
            RenderSystem.setShaderColor(1,1,1,1);RenderSystem.setShaderTexture(0,SpriteAtlasTexture.BLOCK_ATLAS_TEXTURE);ProjectionRenderer.program.getUniform("UseTexture").set(1f);
            try{for(var mesh:sorted){var matrix=new Matrix4f(view).translate((float)(mesh.x-camera.x),(float)(mesh.y-camera.y),(float)(mesh.z-camera.z));mesh.buffer.bind();mesh.buffer.draw(matrix,projection,ProjectionRenderer.program);}}finally{VertexBuffer.unbind();}
        }completedDraws++;
    }
    void clear(){generation++;building=false;error=null;release();}
    private void release(){for(var mesh:meshes)mesh.buffer.close();meshes.clear();}
    @Override public void close(){if(closed)return;closed=true;clear();worker.shutdownNow();}
    private static final class View implements BlockRenderView {
        private final WorldDifferenceView preview;private final WorldPatchPreview.Filter filter;private final Map<String,BlockState> states;private final boolean original;
        View(WorldDifferenceView preview,WorldPatchPreview.Filter filter,Map<String,BlockState> states,boolean original){this.preview=preview;this.filter=filter;this.states=states;this.original=original;}
        @Override public BlockState getBlockState(BlockPos p){
            if(Math.abs((long)p.getX())>30000000||Math.abs((long)p.getZ())>30000000||p.getY()<-2048||p.getY()>2048)return Blocks.AIR.getDefaultState();
            var row=preview.at(new SelectionRegion.Point(p.getX(),p.getY(),p.getZ()));if(row==null||!filter.includes(row))return Blocks.AIR.getDefaultState();var text=WorldPatchPreview.displayState(row,filter.mode(),original);return text==null?Blocks.AIR.getDefaultState():states.get(text);
        }
        @Override public BlockEntity getBlockEntity(BlockPos p){return null;}
        @Override public FluidState getFluidState(BlockPos p){return getBlockState(p).getFluidState();}
        @Override public int getHeight(){var w=preview.selection().world();return w.maxY()-w.minY();}
        @Override public int getBottomY(){return preview.selection().world().minY();}
        @Override public float getBrightness(Direction d,boolean shaded){return 1;}
        @Override public LightingProvider getLightingProvider(){return null;}
        @Override public int getColor(BlockPos p,ColorResolver resolver){return 0x91bd59;}
        @Override public int getLightLevel(net.minecraft.world.LightType type,BlockPos p){return 15;}
    }
}
