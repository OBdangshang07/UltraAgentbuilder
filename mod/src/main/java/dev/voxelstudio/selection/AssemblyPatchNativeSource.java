package dev.voxelstudio.selection;

import java.util.*;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;

/** Whole-native source only. This is not the final-confirmation gateway;
 * no public report, client JSON or legacy per-part lease can construct it.
 * Static policy remains closed to unverified paired/scheduled physics. */
final class AssemblyPatchNativeSource implements AssemblyPatchExecution.Source,AutoCloseable {
    private final MinecraftServer server;private final SelectionReadService.AssemblyNativeWorld origin;
    private final Map<SelectionRegion.Point,WorldPatchCompiler.Write> writes;private final Map<String,BlockState> states=new HashMap<>();
    private final BlockPos.Mutable position=new BlockPos.Mutable();private boolean closed;
    AssemblyPatchNativeSource(MinecraftServer server,SelectionReadService.AssemblyNativeWorld origin,List<WorldPatchCompiler.Write> rows){
        this.server=Objects.requireNonNull(server);this.origin=Objects.requireNonNull(origin);
        if(!origin.writes.equals(rows))throw new IllegalArgumentException("Whole source must retain exact original ordered writes or sealed-prefix inverse");
        var indexed=new HashMap<SelectionRegion.Point,WorldPatchCompiler.Write>();
        for(var row:rows){
            if(!origin.selection.edit().contains(row.position())||origin.selection.protectedAt(row.position())||indexed.put(row.position(),row)!=null)throw new IllegalArgumentException("Whole native write outside original W-P or duplicate");
            WorldPatchStatePolicy.requireStatic(row.before());WorldPatchStatePolicy.requireStatic(row.after());
        }
        writes=WorldPointIndex.copy(indexed);
    }
    private void thread(){if(!server.isOnThread())throw new IllegalStateException("Whole native access requires server thread");}
    void undoCurrent(){
        thread();var player=server.getPlayerManager().getPlayer(origin.player);
        if(!closed||server.isDedicated()||player==null||!player.isCreative()||!server.isHost(player.getGameProfile())||player.getServerWorld()!=origin.world)throw new IllegalStateException("整组撤销只允许原单人创造房主、原世界/维度与已封闭事务");
    }
    AssemblyPatchNativeSource forUndo(AssemblyPatchExecution.UndoOrigin undo,List<WorldPatchCompiler.Write> rows){
        undoCurrent();var lease=origin.forUndo(undo);
        try{return new AssemblyPatchNativeSource(server,lease,rows);}catch(RuntimeException error){lease.watch.close();throw error;}
    }
    public void beginStep(){thread();}
    public AssemblyPatchExecution.Frame frame(){
        thread();var player=server.getPlayerManager().getPlayer(origin.player);var world=origin.selection.world();
        boolean allowed=!closed&&!server.isDedicated()&&player!=null&&player.isCreative()&&server.isHost(player.getGameProfile())&&player.getServerWorld()==origin.world;
        return new AssemblyPatchExecution.Frame(world.worldId(),origin.world.getRegistryKey().getValue().toString(),origin.selection.revision(),origin.watch.revision(),allowed);
    }
    public Object loadedChunk(int x,int z){
        thread();if(closed)throw new IllegalStateException("Whole native source closed");
        var chunk=origin.world.getChunkManager().getWorldChunk(x,z);
        if(!origin.chunks.observe(x,z,chunk))throw new IllegalStateException("原整组区块实例或覆盖变化；不重载");return chunk;
    }
    public SelectionScan.BlockFact read(SelectionRegion.Point point){
        thread();if(!origin.selection.context().contains(point))throw new IllegalStateException("Whole native read outside original C");
        var chunk=(WorldChunk)loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));if(chunk==null)throw new IllegalStateException("Whole native target unloaded; no load");
        return BlockStateFacts.read(chunk.getBlockState(position.set(point.x(),point.y(),point.z())));
    }
    private BlockState state(String text)throws Exception{
        var value=states.get(text);
        if(value==null){value=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
            if(value.hasBlockEntity()||!BlockStateFacts.read(value).state().equals(text))throw new IllegalStateException("整组原生目标完整状态不能精确重建");states.put(text,value);}
        return value;
    }
    public boolean set(WorldPatchCompiler.Write write){
        thread();if(!frame().creativeHost()||!write.equals(writes.get(write.position())))throw new IllegalStateException("No original whole native write/host authority");
        var point=write.position();var pos=position.set(point.x(),point.y(),point.z());
        if(origin.world.isOutOfHeightLimit(pos)||!origin.world.getWorldBorder().contains(pos))throw new IllegalStateException("整组目标超出原高度或边界");
        if(!read(point).equals(new SelectionScan.BlockFact(write.before(),false)))throw new IllegalStateException("整组原生 set 前 BEFORE 已改变");
        try{var after=state(write.after());loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));
            return origin.world.setBlockState(pos,after,Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS);
        }catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException(error);}
    }
    @Override public void close(){thread();if(!closed){closed=true;origin.watch.close();states.clear();}}
}
