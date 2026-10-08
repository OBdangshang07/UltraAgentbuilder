package dev.voxelstudio.selection;

import java.util.*;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;

/** Server-thread-only source, constructible only inside the native package
 * with the original explicitly detached world lease. No client/server remote
 * path, load/generate API, NBT, entities, drop handling or command execution. */
final class WorldPatchNativeSource implements WorldPatchExecution.Source,AutoCloseable {
    private final MinecraftServer server;private final SelectionReadService.NativeWorld origin;private final Map<SelectionRegion.Point,WorldPatchCompiler.Write> writes;
    private final Map<String,BlockState> states=new HashMap<>();private final BlockPos.Mutable position=new BlockPos.Mutable();private boolean closed;
    WorldPatchNativeSource(MinecraftServer server,SelectionReadService.NativeWorld origin,List<WorldPatchCompiler.Write> rows){
        this.server=Objects.requireNonNull(server);this.origin=Objects.requireNonNull(origin);var map=new HashMap<SelectionRegion.Point,WorldPatchCompiler.Write>();for(var row:rows){if(!origin.selection.edit().contains(row.position())||origin.selection.protectedAt(row.position())||map.put(row.position(),row)!=null)throw new IllegalArgumentException("Native write outside original W-P/duplicate");WorldPatchStatePolicy.requireStatic(row.before());WorldPatchStatePolicy.requireStatic(row.after());}writes=WorldPointIndex.copy(map);
    }
    private void thread(){if(!server.isOnThread())throw new IllegalStateException("Native world access requires server thread");}
    void undoCurrent(){thread();var p=server.getPlayerManager().getPlayer(origin.player);if(!closed||server.isDedicated()||p==null||!p.isCreative()||!server.isHost(p.getGameProfile())||p.getServerWorld()!=origin.world)throw new IllegalStateException("撤销只允许原单人创造房主、原世界/维度与已封闭事务");}
    WorldPatchNativeSource forUndo(WorldPatchExecution.UndoOrigin undo,List<WorldPatchCompiler.Write> rows){
        undoCurrent();var lease=origin.forUndo(undo);try{return new WorldPatchNativeSource(server,lease,rows);}catch(RuntimeException e){lease.watch.close();throw e;}
    }
    public void beginStep(){thread();}
    public WorldPatchExecution.Frame frame(){thread();var p=server.getPlayerManager().getPlayer(origin.player);var w=origin.selection.world();boolean allowed=!closed&&!server.isDedicated()&&p!=null&&p.isCreative()&&server.isHost(p.getGameProfile())&&p.getServerWorld()==origin.world;return new WorldPatchExecution.Frame(w.worldId(),origin.world.getRegistryKey().getValue().toString(),origin.selection.revision(),origin.watch.revision(),allowed);}
    public Object loadedChunk(int x,int z){thread();if(closed)throw new IllegalStateException("Native world source closed");var value=origin.world.getChunkManager().getWorldChunk(x,z);if(!origin.chunks.observe(x,z,value))throw new IllegalStateException("原区块实例/覆盖变化；不重载");return value;}
    public SelectionScan.BlockFact read(SelectionRegion.Point point){
        thread();if(!origin.selection.context().contains(point))throw new IllegalStateException("Native read outside original C");var chunk=(WorldChunk)loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));if(chunk==null)throw new IllegalStateException("Native target unloaded; no load");return BlockStateFacts.read(chunk.getBlockState(position.set(point.x(),point.y(),point.z())));
    }
    private BlockState state(String text)throws Exception{
        var value=states.get(text);if(value==null){value=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();if(value.hasBlockEntity()||!BlockStateFacts.read(value).state().equals(text))throw new IllegalStateException("原生完整目标状态不能精确重建");states.put(text,value);}return value;
    }
    public boolean set(WorldPatchCompiler.Write write){
        thread();if(!frame().creativeHost()||!write.equals(writes.get(write.position())))throw new IllegalStateException("No original native write/host authority");var p=write.position();var pos=position.set(p.x(),p.y(),p.z());if(origin.world.isOutOfHeightLimit(pos)||!origin.world.getWorldBorder().contains(pos))throw new IllegalStateException("目标超出原高度/边界");
        if(!read(p).equals(new SelectionScan.BlockFact(write.before(),false)))throw new IllegalStateException("原生 set 前 BEFORE 已改变");
        try{var after=state(write.after());loadedChunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));
            // On this server thread the target has just been proved loaded.
            // FORCE_STATE avoids neighbour shape dispatch; static policy and
            // actual Minecraft physics still require isolated acceptance.
            return origin.world.setBlockState(pos,after,Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS);
        }catch(RuntimeException e){throw e;}catch(Exception e){throw new IllegalStateException(e);}
    }
    @Override public void close(){thread();if(!closed){closed=true;origin.watch.close();states.clear();}}
}
