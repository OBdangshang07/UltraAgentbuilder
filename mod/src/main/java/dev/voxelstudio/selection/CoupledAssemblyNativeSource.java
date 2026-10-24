package dev.voxelstudio.selection;

import java.util.*;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;

/** Actual forward native source from an opaque original coupled world only.
 * No JSON, disk Review, old source, per-part candidate or baseline factory.
 * Service/UI/undo integration and installed physics tests remain required. */
final class CoupledAssemblyNativeSource implements CoupledAssemblyExecution.Source,AutoCloseable {
    private final MinecraftServer server;private final SelectionReadService.CoupledNativeWorld origin;
    private final CoupledNativeWriteGate gate;private final CoupledAssemblyNativeCheck oracle;
    private final Map<String,BlockState> states=new HashMap<>();private final BlockPos.Mutable position=new BlockPos.Mutable();
    private long revision;private boolean closed;
    CoupledAssemblyNativeSource(MinecraftServer server,SelectionReadService.CoupledNativeWorld origin){
        this.server=Objects.requireNonNull(server);this.origin=Objects.requireNonNull(origin);thread();
        if(!origin.compiled.fromOriginalInput(origin.input)||!origin.compiled.baseline().selection.equals(origin.selection))throw new IllegalArgumentException("Original server-owned complete coupled reconstruction required");
        revision=origin.input.binding().contextRevision();
        gate=new CoupledNativeWriteGate(origin.compiled.groups().size(),index->{
            var group=origin.compiled.groups().get(index);var rows=new ArrayList<WorldPatchCompiler.Write>(2);
            for(int operation:group.operationIndices())rows.add(origin.compiled.writes().get(operation));return List.copyOf(rows);
        });
        var world=origin.selection.world();oracle=new CoupledAssemblyNativeCheck(CoupledAssemblyNativeCheck.Mode.FORWARD,world.minY(),world.maxY(),this::nativeState);
    }
    private void thread(){if(!server.isOnThread())throw new IllegalStateException("Coupled native access requires original server thread");}
    public void beginStep(){thread();}
    public CoupledAssemblyExecution.Frame frame(){
        thread();var player=server.getPlayerManager().getPlayer(origin.player);var identity=origin.selection.world();long actual=origin.watch.revision();
        boolean allowed=!closed&&!gate.broken()&&!server.isDedicated()&&player!=null&&player.isCreative()&&server.isHost(player.getGameProfile())&&player.getServerWorld()==origin.world
            &&origin.world.getBottomY()==identity.minY()&&origin.world.getTopY()==identity.maxY()&&actual==revision+gate.writtenInActiveGroup();
        return new CoupledAssemblyExecution.Frame(identity.worldId(),origin.world.getRegistryKey().getValue().toString(),origin.selection.revision(),actual,allowed);
    }
    public Object loadedChunk(int x,int z){
        thread();if(!frame().creativeHost())throw new IllegalStateException("Original coupled source/frame is no longer current");
        var value=origin.world.getChunkManager().getWorldChunk(x,z);
        if(!origin.chunks.observe(x,z,value))throw new IllegalStateException("Original coupled chunk instance changed; no load/replacement");return value;
    }
    private BlockState nativeState(SelectionRegion.Point point){
        thread();if(!origin.selection.context().contains(point))throw new IllegalStateException("Native group read outside original C");
        var chunk=(WorldChunk)loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));
        if(chunk==null)throw new IllegalStateException("Original coupled chunk unloaded; no load");return chunk.getBlockState(position.set(point.x(),point.y(),point.z()));
    }
    public SelectionScan.BlockFact read(SelectionRegion.Point point){return BlockStateFacts.read(nativeState(point));}
    public boolean verifyGroup(List<WorldPatchCompiler.Write> rows,boolean after){
        thread();try{
            if(!after){if(!frame().creativeHost()||!gate.expects(rows)||!oracle.check(rows,false))return false;return gate.arm(rows);}
            if(!gate.fullyWritten(rows)||!frame().creativeHost()||!oracle.check(rows,true)){gate.revoke();return false;}
            revision+=gate.complete(rows);return true;
        }catch(Exception error){gate.revoke();return false;}
    }
    private BlockState state(String text)throws Exception{
        var value=states.get(text);if(value==null){value=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
            if(value.hasBlockEntity()||!BlockStateFacts.read(value).state().equals(text))throw new IllegalStateException("Exact original native target required");states.put(text,value);}return value;
    }
    public boolean set(WorldPatchCompiler.Write write){
        thread();try{
            if(!frame().creativeHost()||!gate.permits(write)||!origin.selection.edit().contains(write.position())||origin.selection.protectedAt(write.position()))throw new IllegalStateException("Unarmed/reordered/out-of-scope original coupled write");
            var p=write.position();var pos=position.set(p.x(),p.y(),p.z());
            if(origin.world.isOutOfHeightLimit(pos)||!origin.world.getWorldBorder().contains(pos)||!read(p).equals(new SelectionScan.BlockFact(write.before(),false)))throw new IllegalStateException("Original coupled BEFORE, border or height changed");
            var target=state(write.after());loadedChunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));
            boolean changed=origin.world.setBlockState(pos,target,Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS);
            if(changed)gate.applied(write);else gate.revoke();return changed;
        }catch(RuntimeException error){gate.revoke();throw error;}catch(Exception error){gate.revoke();throw new IllegalStateException(error);}
    }
    @Override public void close(){thread();if(!closed){closed=true;gate.revoke();origin.watch.close();states.clear();}}
}
