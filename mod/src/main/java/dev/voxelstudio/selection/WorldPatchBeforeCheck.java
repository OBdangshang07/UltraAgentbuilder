package dev.voxelstudio.selection;

import java.util.*;
import java.util.function.LongSupplier;
import java.util.function.BooleanSupplier;

/** Cooperative fresh BEFORE comparison, not a compiler, physics validator,
 * placement token or transaction. There is deliberately NO write/load API. */
public final class WorldPatchBeforeCheck {
    public enum State { CHECKING,MATCHED,CONFLICT,CANCELLED,FAILED }
    public record Progress(State state,String reason,long checked,long total,long reads,int steps,long maxStepNanos){}
    public record Result(WorldPatchPreview.Binding binding,long checked,long known,long unknown,long reads,int steps,long maxStepNanos){
        public boolean canAuthorizePlacement(){return false;}
        public boolean physicsVerified(){return false;}
    }
    public interface Source {
        default void beginStep(){}
        SelectionScan.Identity identity();
        boolean loaded(int x,int z);
        SelectionScan.BlockFact read(SelectionRegion.Point point);
    }
    /** Only original server facts can create this plan. Downloads are never
     * allowed to choose the baseline facts or a replacement snapshot. */
    static final class Plan {
        final SelectionBaseline baseline;final WorldPatchPreview.Binding binding;final List<SelectionRegion> regions;final long total;
        private Plan(SelectionBaseline b,WorldPatchPreview preview,BooleanSupplier cancelled){
            baseline=b;binding=preview.binding();regions=b.checkRegions();total=regions.stream().mapToLong(SelectionRegion::cells).sum();
            if(!binding.selection().equals(b.selection)||binding.contextRevision()!=b.contextRevision||!binding.snapshotHash().equals(b.snapshotHash)||!binding.selectionHash().equals(b.selectionHash))throw new IllegalArgumentException("候选不属于原服务器快照");
            int rows=0;for(var section:preview.sections())for(var row:section.rows()){
                if((rows++&1023)==0&&(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted()))throw new java.util.concurrent.CancellationException("BEFORE preparation cancelled");
                var fact=b.at(row.position());if(fact==null||fact.blockEntity()||!fact.state().equals(row.before()))throw new IllegalArgumentException("候选 BEFORE 不属于原服务器事实");
                // These are the original guards, not freshly substituted ones.
                // Static-state/physics policy and final confirmation remain
                // separate gates even when this exact comparison succeeds.
                for(int axis=0;axis<3;axis++)for(int side:new int[]{-1,1}){
                    var p=row.position();int[] xyz={p.x(),p.y(),p.z()};xyz[axis]+=side;
                    var neighbor=b.at(new SelectionRegion.Point(xyz[0],xyz[1],xyz[2]));
                    if(neighbor==null||neighbor.blockEntity())throw new IllegalArgumentException("候选缺少原始已知邻接 BEFORE");
                }
            }
            if(rows!=preview.totalWrites()||rows<1)throw new IllegalArgumentException("候选改动集合不完整");
        }
    }
    static Plan prepare(SelectionBaseline baseline,WorldPatchPreview preview){return prepare(baseline,preview,()->false);}
    static Plan prepare(SelectionBaseline baseline,WorldPatchPreview preview,BooleanSupplier cancelled){return new Plan(Objects.requireNonNull(baseline),Objects.requireNonNull(preview),Objects.requireNonNull(cancelled));}
    private final Plan plan;private final Source source;private final LongSupplier clock;private final int maxCells;private final long maxNanos;
    private State state=State.CHECKING;private String reason="只读复核原始 BEFORE";private int regionIndex,steps;private long offset,checked,known,unknown,reads,maxStepNanos;
    WorldPatchBeforeCheck(Plan plan,Source source,int maxCells,long maxNanos,LongSupplier clock){
        this.plan=Objects.requireNonNull(plan);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);
        if(maxCells<1||maxCells>4096||maxNanos<1||maxNanos>2_000_000)throw new IllegalArgumentException("Invalid bounded BEFORE budget");this.maxCells=maxCells;this.maxNanos=maxNanos;
    }
    public Progress progress(){return new Progress(state,reason,checked,plan.total,reads,steps,maxStepNanos);}
    public void cancel(){if(state==State.CHECKING||state==State.MATCHED)stop(State.CANCELLED,"BEFORE 校验已取消");}
    private void stop(State next,String why){state=next;reason=why;}
    private boolean guard(){
        var actual=Objects.requireNonNull(source.identity());var b=plan.baseline;var world=b.selection.world();
        if(!world.worldId().equals(actual.worldId())||!world.dimension().equals(actual.dimension())||b.selection.revision()!=actual.selectionRevision()||b.contextRevision!=actual.contextRevision()){
            stop(State.CONFLICT,"原世界、维度、选区或环境版本已改变；不会重新绑定");return false;
        }return true;
    }
    public Progress step(){
        if(state!=State.CHECKING)return progress();long started=clock.getAsLong();steps++;
        try{
            source.beginStep();int work=0;
            while(guard()&&regionIndex<plan.regions.size()&&work<maxCells&&clock.getAsLong()-started<maxNanos){
                var r=plan.regions.get(regionIndex);int w=r.max().x()-r.min().x(),l=r.max().z()-r.min().z();
                var point=new SelectionRegion.Point(r.min().x()+(int)(offset%w),r.min().y()+(int)(offset/((long)w*l)),r.min().z()+(int)(offset/w%l));
                var expected=plan.baseline.at(point);boolean loaded=source.loaded(Math.floorDiv(point.x(),16),Math.floorDiv(point.z(),16));
                if((expected!=null)!=loaded){stop(State.CONFLICT,"原区块覆盖已改变："+point);break;}
                if(expected==null)unknown++;else{
                    reads++;var actual=source.read(point);
                    if(!expected.equals(actual)){stop(State.CONFLICT,"服务器 BEFORE 已改变："+point);break;}known++;
                }
                if(!guard())break;checked++;work++;offset++;if(offset==r.cells()){regionIndex++;offset=0;}
            }
            if(state==State.CHECKING&&guard()&&regionIndex==plan.regions.size())stop(State.MATCHED,"原始目标与紧邻面事实一致；尚无建造权限");
        }catch(Exception error){stop(State.FAILED,String.valueOf(error.getMessage()));}
        finally{maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
    public Result result(){
        if(state!=State.MATCHED||!guard())throw new IllegalStateException("没有当前原快照的完整 BEFORE 校验");
        return new Result(plan.binding,checked,known,unknown,reads,steps,maxStepNanos);
    }
}
