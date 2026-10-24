package dev.voxelstudio.selection;

import java.util.*;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.chunk.WorldChunk;

/** Native inverse source for the original same-live sealed grouped apply.
 * Its independent UNDO handoff and complete original inverse Plan cannot be
 * supplied by JSON, a report, an equal copy or a forward native source. The
 * player gateway/UI and installed persistence tests remain separate gates. */
final class CoupledAssemblyUndoNativeSource implements CoupledAssemblyUndoExecution.Source,AutoCloseable {
    private final MinecraftServer server;private final SelectionReadService.CoupledUndoNativeWorld origin;
    private final CoupledNativeWriteGate gate;private final CoupledAssemblyNativeCheck oracle;
    private final Map<String,BlockState> states=new HashMap<>();private final BlockPos.Mutable position=new BlockPos.Mutable();
    private long revision;private boolean closed;
    CoupledAssemblyUndoNativeSource(MinecraftServer server,SelectionReadService.CoupledUndoNativeWorld origin,CoupledAssemblyUndoJournal.Plan plan){
        this.server=Objects.requireNonNull(server);this.origin=Objects.requireNonNull(origin);thread();
        if(origin.world.getServer()!=server)throw new IllegalArgumentException("Original inverse server differs");origin.claim(Objects.requireNonNull(plan));
        revision=origin.initialRevision;gate=new CoupledNativeWriteGate(plan.groups().size(),index->plan.groups().get(index).writes());
        var world=origin.selection.world();oracle=new CoupledAssemblyNativeCheck(CoupledAssemblyNativeCheck.Mode.UNDO,world.minY(),world.maxY(),this::nativeState);
    }
    private void thread(){if(!server.isOnThread())throw new IllegalStateException("Coupled native inverse requires original server thread");}
    public void beginStep(){thread();}
    public CoupledAssemblyExecution.Frame frame(){
        thread();var player=server.getPlayerManager().getPlayer(origin.player);var identity=origin.selection.world();long actual=origin.watch.revision();
        boolean allowed=!closed&&!gate.broken()&&!server.isDedicated()&&player!=null&&player.isCreative()&&server.isHost(player.getGameProfile())&&player.getServerWorld()==origin.world
            &&origin.world.getBottomY()==identity.minY()&&origin.world.getTopY()==identity.maxY()&&actual==revision+gate.writtenInActiveGroup();
        return new CoupledAssemblyExecution.Frame(identity.worldId(),origin.world.getRegistryKey().getValue().toString(),origin.selection.revision(),actual,allowed);
    }
    public Object loadedChunk(int x,int z){
        thread();if(!frame().creativeHost())throw new IllegalStateException("Original coupled inverse epoch/frame changed");
        var value=origin.world.getChunkManager().getWorldChunk(x,z);
        if(!origin.chunks.observe(x,z,value))throw new IllegalStateException("Original inverse chunk unloaded/replaced; no load");return value;
    }
    private BlockState nativeState(SelectionRegion.Point point){
        thread();if(!origin.selection.context().contains(point))throw new IllegalStateException("Inverse read outside original C");
        var chunk=(WorldChunk)loadedChunk(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));if(chunk==null)throw new IllegalStateException("Original inverse chunk unloaded");
        return chunk.getBlockState(position.set(point.x(),point.y(),point.z()));
    }
    public SelectionScan.BlockFact read(SelectionRegion.Point point){return BlockStateFacts.read(nativeState(point));}
    public boolean preserveGroup(List<WorldPatchCompiler.Write> rows){
        thread();try{if(!frame().creativeHost()||!gate.expects(rows)){gate.revoke();return false;}gate.preserve(rows);return true;}catch(Exception error){gate.revoke();return false;}
    }
    public boolean verifyGroup(List<WorldPatchCompiler.Write> rows,boolean after){
        thread();try{
            if(!after){if(!frame().creativeHost()||!gate.expects(rows)||!oracle.check(rows,false))return false;return gate.arm(rows);}
            if(!gate.fullyWritten(rows)||!frame().creativeHost()||!oracle.check(rows,true)){gate.revoke();return false;}
            revision+=gate.complete(rows);return true;
        }catch(Exception error){gate.revoke();return false;}
    }
    private BlockState state(String text)throws Exception{
        var value=states.get(text);if(value==null){value=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();
            if(value.hasBlockEntity()||!BlockStateFacts.read(value).state().equals(text))throw new IllegalStateException("Exact original inverse native target required");states.put(text,value);}return value;
    }
    public boolean set(WorldPatchCompiler.Write write){
        thread();try{
            if(!frame().creativeHost()||!gate.permits(write)||!origin.selection.edit().contains(write.position())||origin.selection.protectedAt(write.position()))throw new IllegalStateException("Unarmed/reordered/out-of-scope original inverse write");
            var p=write.position();var pos=position.set(p.x(),p.y(),p.z());
            if(origin.world.isOutOfHeightLimit(pos)||!origin.world.getWorldBorder().contains(pos)||!read(p).equals(new SelectionScan.BlockFact(write.before(),false)))throw new IllegalStateException("Original inverse AFTER, border or height changed");
            var target=state(write.after());loadedChunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));
            boolean changed=origin.world.setBlockState(pos,target,Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS);
            if(changed)gate.applied(write);else gate.revoke();return changed;
        }catch(RuntimeException error){gate.revoke();throw error;}catch(Exception error){gate.revoke();throw new IllegalStateException(error);}
    }
    @Override public void close(){thread();if(!closed){closed=true;gate.revoke();origin.watch.close();states.clear();}}
}
