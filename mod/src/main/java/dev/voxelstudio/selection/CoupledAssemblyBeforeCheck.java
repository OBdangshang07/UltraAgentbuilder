package dev.voxelstudio.selection;

import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/** Cooperative fresh ORIGINAL W+six faces, not a part-only comparison. No
 * writes, chunk loads, replacement capture, old lease or final consent here. */
public final class CoupledAssemblyBeforeCheck {
    public enum State { CHECKING,MATCHED,CONFLICT,CANCELLED,FAILED }
    public record Progress(State state,String reason,long checked,long total,long reads,int steps,long maxStepNanos){}
    public record Result(CoupledAssemblyBinding binding,long checked,long known,long unknown,long reads,int steps,long maxStepNanos){public boolean canAuthorizePlacement(){return false;}public boolean physicsVerified(){return false;}}
    public interface Source {
        default void beginStep(){}
        SelectionScan.Identity identity();
        /** Fresh NONLOADING query. Null is unknown/unloaded, not AIR. */
        Object loadedChunk(int x,int z);
        SelectionScan.BlockFact read(SelectionRegion.Point point);
    }
    static final class Plan {
        final AssemblyCoupledCompiler.Compiled compiled;final CoupledAssemblyInput input;final CoupledAssemblyPreview preview;
        final SelectionBaseline baseline;final CoupledAssemblyBinding binding;final List<SelectionRegion> regions;final long total;
        private Plan(AssemblyCoupledCompiler.Compiled compiled,CoupledAssemblyInput input,CoupledAssemblyPreview preview,BooleanSupplier cancelled){
            WorldPatchJson.cancelled(cancelled);this.compiled=compiled;this.input=input;this.preview=preview;baseline=compiled.baseline();binding=input.binding();
            if(!compiled.fromOriginalInput(input)||!preview.fromOriginalInput(input)||!preview.binding().equals(binding)||!baseline.selection.equals(binding.selection())||baseline.contextRevision!=binding.contextRevision()||!baseline.snapshotHash.equals(binding.snapshotHash())||!baseline.selectionHash.equals(binding.selectionHash())||compiled.writes().size()!=binding.totalWrites()||preview.totalWrites()!=binding.totalWrites())throw new IllegalArgumentException("Fresh coupled BEFORE requires same original COMPLETE input/reconstruction/display");
            var plan=compiled.plan();if(!WorldPatchJson.text(plan.get("planHash")).equals(binding.couplingPlanHash())||!WorldPatchJson.text(plan.get("policyHash")).equals(binding.couplingPolicyHash())||!WorldPatchJson.text(plan.get("assetHash")).equals(binding.assetHash())||!WorldPatchJson.text(plan.get("cellsHash")).equals(binding.cellsHash()))throw new IllegalArgumentException("Original coupled whole plan identity changed");
            int visits=0;for(var write:compiled.writes()){
                if((visits++&1023)==0)WorldPatchJson.cancelled(cancelled);var row=preview.at(write.position());var fact=baseline.at(write.position());
                if(row==null||fact==null||fact.blockEntity()||!fact.state().equals(write.before())||!row.before().equals(write.before())||!row.after().equals(write.after())||!row.difference().name().toLowerCase(Locale.ROOT).equals(write.difference()))throw new IllegalArgumentException("Original coupled difference/BEFORE row changed");
            }
            regions=baseline.checkRegions();total=regions.stream().mapToLong(SelectionRegion::cells).sum();WorldPatchJson.cancelled(cancelled);
        }
    }
    static Plan prepare(AssemblyCoupledCompiler.Compiled compiled,CoupledAssemblyInput input,CoupledAssemblyPreview preview,BooleanSupplier cancelled){return new Plan(Objects.requireNonNull(compiled),Objects.requireNonNull(input),Objects.requireNonNull(preview),Objects.requireNonNull(cancelled));}
    private final Plan plan;private final Source source;private final LongSupplier clock;private final int maximumCells;private final long maximumNanos;
    private final SelectionChunkFence chunks=new SelectionChunkFence();private final Map<Long,int[]> touched=new LinkedHashMap<>();
    private State state=State.CHECKING;private String reason="逐 tick 只读复核原完整 W 与紧邻六面";private int regionIndex,steps;private long offset,checked,known,unknown,reads,maxStepNanos;
    CoupledAssemblyBeforeCheck(Plan plan,Source source,int maximumCells,long maximumNanos,LongSupplier clock){this.plan=Objects.requireNonNull(plan);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);if(maximumCells<1||maximumCells>4096||maximumNanos<1||maximumNanos>2_000_000)throw new IllegalArgumentException("Bounded original coupled BEFORE budget required");this.maximumCells=maximumCells;this.maximumNanos=maximumNanos;}
    public Progress progress(){return new Progress(state,reason,checked,plan.total,reads,steps,maxStepNanos);}
    public void cancel(){if(state==State.CHECKING||state==State.MATCHED)stop(State.CANCELLED,"完整 coupled BEFORE 已取消；不采用部分结果");}
    private void stop(State next,String reason){state=next;this.reason=reason;}
    private boolean current(){var actual=Objects.requireNonNull(source.identity());var b=plan.baseline;var w=b.selection.world();if(!w.worldId().equals(actual.worldId())||!w.dimension().equals(actual.dimension())||b.selection.revision()!=actual.selectionRevision()||b.contextRevision!=actual.contextRevision()){stop(State.CONFLICT,"原世界、维度、选区或环境版本已变化；不刷新或重绑");return false;}return true;}
    private Object chunk(int x,int z){var value=source.loadedChunk(x,z);if(!chunks.observe(x,z,value))throw new ChunkConflict();long key=((long)x<<32)^(z&0xffffffffL);touched.putIfAbsent(key,new int[]{x,z});return value;}
    private boolean stableChunks(){if(!chunks.stable(touched.size(),source::loadedChunk)){stop(State.CONFLICT,"原区块实例或覆盖已改变；不加载或替换");return false;}return true;}
    private static final class ChunkConflict extends RuntimeException{}
    public Progress step(){
        if(state!=State.CHECKING)return progress();long started=clock.getAsLong();steps++;
        try{
            source.beginStep();int work=0;
            while(state==State.CHECKING&&current()&&regionIndex<plan.regions.size()&&work<maximumCells&&clock.getAsLong()-started<maximumNanos){
                var region=plan.regions.get(regionIndex);int width=region.max().x()-region.min().x(),length=region.max().z()-region.min().z();var p=new SelectionRegion.Point(region.min().x()+(int)(offset%width),region.min().y()+(int)(offset/((long)width*length)),region.min().z()+(int)(offset/width%length));
                var expected=plan.baseline.at(p);var loaded=chunk(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));if((expected!=null)!=(loaded!=null)){stop(State.CONFLICT,"原完整 W/六面区块覆盖已改变："+p);break;}
                if(expected!=null){reads++;var actual=source.read(p);if(!expected.equals(actual)){stop(State.CONFLICT,"原服务器 BEFORE 状态/实体事实已改变："+p);break;}}
                if(state!=State.CHECKING||!current())break;if(expected==null)unknown++;else known++;checked++;work++;offset++;if(offset==region.cells()){regionIndex++;offset=0;}
            }
            if(state==State.CHECKING&&current()&&regionIndex==plan.regions.size()&&stableChunks()&&current())stop(State.MATCHED,"原完整 W 与六面一致；仍无写入权限或物理存盘证明");
        }catch(ChunkConflict conflict){stop(State.CONFLICT,"原区块实例变化；不采用另一个同坐标区块");}catch(Exception error){stop(State.FAILED,String.valueOf(error.getMessage()));}
        finally{maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
    public Result result(){
        if(state!=State.MATCHED)throw new IllegalStateException("No current COMPLETE original coupled BEFORE result");
        try{source.beginStep();if(!current()||!stableChunks()||!current())throw new IllegalStateException("Original coupled BEFORE no longer current");}
        catch(Exception error){if(state==State.MATCHED)stop(State.FAILED,String.valueOf(error.getMessage()));throw new IllegalStateException("Original coupled BEFORE invalidated; no refresh",error);}
        return new Result(plan.binding,checked,known,unknown,reads,steps,maxStepNanos);
    }
}
