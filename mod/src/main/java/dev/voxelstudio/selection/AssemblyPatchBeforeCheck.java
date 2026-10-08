package dev.voxelstudio.selection;

import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/** One cooperative comparison for an independently reconstructed WHOLE set.
 * This is not a legacy single-patch binding, placement lease or write token.
 * No world writes, chunk loads, replacement capture or per-part refresh. */
public final class AssemblyPatchBeforeCheck {
    public enum State { CHECKING,MATCHED,CONFLICT,CANCELLED,FAILED }
    public record Progress(State state,String reason,long checked,long total,long reads,int steps,long maxStepNanos){}
    public record Result(AssemblyPatchBinding binding,long checked,long known,long unknown,long reads,int steps,long maxStepNanos){
        public boolean canAuthorizePlacement(){return false;}
        public boolean physicsVerified(){return false;}
    }
    public interface Source {
        default void beginStep(){}
        SelectionScan.Identity identity();
        boolean loaded(int x,int z);
        SelectionScan.BlockFact read(SelectionRegion.Point point);
    }
    /** Only the pure compiler's privately constructed complete reconstruction
     * may prepare this plan. Downloaded facts or a v1 hash cannot replace it. */
    static final class Plan {
        final AssemblyPatchCompiler.Compiled compiled;
        final AssemblyPatchPreview preview;
        final SelectionBaseline baseline;
        final AssemblyPatchBinding binding;
        final List<SelectionRegion> regions;
        final long total;
        private Plan(AssemblyPatchCompiler.Compiled compiled,AssemblyPatchPreview preview,BooleanSupplier cancelled){
            WorldPatchJson.cancelled(cancelled);this.compiled=compiled;this.preview=preview;
            baseline=compiled.baseline();binding=compiled.binding();regions=baseline.checkRegions();
            total=regions.stream().mapToLong(SelectionRegion::cells).sum();
            if(!binding.equals(preview.binding())||!binding.selection().equals(baseline.selection)
                    ||binding.contextRevision()!=baseline.contextRevision||!binding.snapshotHash().equals(baseline.snapshotHash)
                    ||!binding.selectionHash().equals(baseline.selectionHash)||compiled.writes().size()!=binding.totalWrites()
                    ||preview.totalWrites()!=binding.totalWrites())throw new IllegalArgumentException("整组 BEFORE 必须绑定完整原重建和同一差异");
            int visits=0;
            for(var write:compiled.writes()){
                if((visits++&1023)==0)WorldPatchJson.cancelled(cancelled);
                var row=preview.at(write.position());var fact=baseline.at(write.position());
                if(row==null||fact==null||fact.blockEntity()||!fact.state().equals(write.before())
                        ||!row.before().equals(write.before())||!row.after().equals(write.after())
                        ||!row.difference().name().toLowerCase(Locale.ROOT).equals(write.difference()))throw new IllegalArgumentException("整组差异或 BEFORE 不属于原服务器完整事实");
            }
            for(var guard:compiled.guards()){
                if((visits++&1023)==0)WorldPatchJson.cancelled(cancelled);
                var fact=baseline.at(guard.position());
                if(fact==null||fact.blockEntity()!=guard.blockEntity()||!fact.state().equals(guard.before()))throw new IllegalArgumentException("整组原邻接事实发生替换");
            }
            WorldPatchJson.cancelled(cancelled);
        }
    }
    static Plan prepare(AssemblyPatchCompiler.Compiled compiled,AssemblyPatchPreview preview,BooleanSupplier cancelled){
        return new Plan(Objects.requireNonNull(compiled),Objects.requireNonNull(preview),Objects.requireNonNull(cancelled));
    }
    private final Plan plan;
    private final Source source;
    private final LongSupplier clock;
    private final int maxCells;
    private final long maxNanos;
    private State state=State.CHECKING;
    private String reason="逐 tick 只读复核整组原 W 与紧邻面";
    private int regionIndex,steps;
    private long offset,checked,known,unknown,reads,maxStepNanos;
    AssemblyPatchBeforeCheck(Plan plan,Source source,int maxCells,long maxNanos,LongSupplier clock){
        this.plan=Objects.requireNonNull(plan);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);
        if(maxCells<1||maxCells>4096||maxNanos<1||maxNanos>2_000_000)throw new IllegalArgumentException("Invalid bounded whole BEFORE budget");
        this.maxCells=maxCells;this.maxNanos=maxNanos;
    }
    public Progress progress(){return new Progress(state,reason,checked,plan.total,reads,steps,maxStepNanos);}
    public void cancel(){if(state==State.CHECKING||state==State.MATCHED)stop(State.CANCELLED,"整组 BEFORE 已取消；不采用部分结果");}
    private void stop(State state,String reason){this.state=state;this.reason=reason;}
    private boolean current(){
        var actual=Objects.requireNonNull(source.identity());var b=plan.baseline;var world=b.selection.world();
        if(!world.worldId().equals(actual.worldId())||!world.dimension().equals(actual.dimension())
                ||b.selection.revision()!=actual.selectionRevision()||b.contextRevision!=actual.contextRevision()){
            stop(State.CONFLICT,"原世界、维度、选区或环境版本已改变；不会重绑整组");return false;
        }
        return true;
    }
    public Progress step(){
        if(state!=State.CHECKING)return progress();long started=clock.getAsLong();steps++;
        try{
            source.beginStep();int work=0;
            while(current()&&regionIndex<plan.regions.size()&&work<maxCells&&clock.getAsLong()-started<maxNanos){
                var region=plan.regions.get(regionIndex);int width=region.max().x()-region.min().x(),length=region.max().z()-region.min().z();
                var p=new SelectionRegion.Point(region.min().x()+(int)(offset%width),region.min().y()+(int)(offset/((long)width*length)),region.min().z()+(int)(offset/width%length));
                var expected=plan.baseline.at(p);boolean loaded=source.loaded(Math.floorDiv(p.x(),16),Math.floorDiv(p.z(),16));
                if((expected!=null)!=loaded){stop(State.CONFLICT,"整组原区块覆盖已改变："+p);break;}
                if(expected!=null){
                    reads++;var actual=source.read(p);
                    if(!expected.equals(actual)){stop(State.CONFLICT,"整组服务器 BEFORE 已改变："+p);break;}
                }
                if(!current())break;
                if(expected==null)unknown++;else known++;checked++;work++;offset++;
                if(offset==region.cells()){regionIndex++;offset=0;}
            }
            if(state==State.CHECKING&&current()&&regionIndex==plan.regions.size())stop(State.MATCHED,"完整原 W 与紧邻面一致；仍无物理验证或写入权限");
        }catch(Exception error){stop(State.FAILED,String.valueOf(error.getMessage()));}
        finally{maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}
        return progress();
    }
    public Result result(){
        if(state!=State.MATCHED)throw new IllegalStateException("没有原整组当前完整 BEFORE 结果");
        try{if(!current())throw new IllegalStateException("整组 BEFORE 后原环境身份已改变");}
        catch(Exception error){if(state==State.MATCHED)stop(State.FAILED,String.valueOf(error.getMessage()));throw new IllegalStateException("原整组 BEFORE 不再有效",error);}
        return new Result(plan.binding,checked,known,unknown,reads,steps,maxStepNanos);
    }
}
