package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;
import java.util.function.LongSupplier;

/** A cooperative server-tick reader. No source write/load/NBT methods exist. */
public final class SelectionScan {
    public record Identity(String worldId,String dimension,long selectionRevision,long contextRevision){}
    public record BlockFact(String state,boolean blockEntity){public BlockFact {if(state==null||state.length()>512||!state.matches("[a-z0-9_.-]+:[a-z0-9_./-]+(?:\\[[a-z0-9_=,.-]+\\])?"))throw new IllegalArgumentException("Invalid block fact");}}
    public interface Source {
        /** Called once per synchronous read step. Implementations may cache
         * already-loaded chunks only until the next step, never across ticks. */
        default void beginStep(){}
        Identity identity();boolean loaded(int x,int z);BlockFact read(SelectionRegion.Point point);
    }
    public enum State { READING,CAPTURED,DETACHED,CANCELLED,STALE,UNSTABLE,FAILED }
    public record Progress(State state,String reason,long processed,long total,long reads,int restarts,int steps,long maxStepNanos){}
    private final WorldSelection selection;private final Source source;private final List<WorldSelection.Chunk> expected;private final LongSupplier clock;
    private final int maxCells;private final long maxNanos;private final int maxRestarts;
    private State state=State.READING;private String reason="";private long initialRevision=-1,lastRevision=-1,processed,reads,estimatedBytes,maxStepNanos;private int chunkIndex,offset,restarts,steps;
    private JsonArray chunks=new JsonArray();private JsonObject active;private JsonArray palette,runs;private Map<String,Integer> paletteIds;private int lastPalette=-1,lastRunCount;
    public SelectionScan(WorldSelection selection,Source source){this(selection,source,4096,5000000,2,System::nanoTime);}
    public SelectionScan(WorldSelection selection,Source source,int maxCells,long maxNanos,int maxRestarts,LongSupplier clock){
        this.selection=Objects.requireNonNull(selection);this.source=Objects.requireNonNull(source);this.clock=Objects.requireNonNull(clock);this.expected=selection.chunks();
        if(maxCells<1||maxCells>16384||maxNanos<1||maxNanos>5000000||maxRestarts<0||maxRestarts>2)throw new IllegalArgumentException("Invalid bounded scan budget");this.maxCells=maxCells;this.maxNanos=maxNanos;this.maxRestarts=maxRestarts;
    }
    public Progress progress(){return new Progress(state,reason,processed,selection.context().cells(),reads,restarts,steps,maxStepNanos);}
    public void cancel(){if(state==State.READING||state==State.CAPTURED)stop(State.CANCELLED,"读取已取消");}
    private void stop(State next,String why){state=next;reason=why;clearData();}
    private void clearData(){chunks=new JsonArray();active=null;palette=null;runs=null;paletteIds=null;}
    private boolean guard(){var id=Objects.requireNonNull(source.identity());
        if(!selection.world().worldId().equals(id.worldId)||!selection.world().dimension().equals(id.dimension)||selection.revision()!=id.selectionRevision){stop(State.STALE,"世界、维度或选区已改变");return false;}
        if(id.contextRevision<0||id.contextRevision>9007199254740991L||id.contextRevision<lastRevision)throw new IllegalStateException("选区变化计数不连续");lastRevision=id.contextRevision;
        if(initialRevision<0)initialRevision=id.contextRevision;
        if(initialRevision!=id.contextRevision){if(restarts>=maxRestarts){stop(State.UNSTABLE,"选区持续变化，无法取得一致快照");return false;}restarts++;clearData();state=State.READING;initialRevision=id.contextRevision;chunkIndex=offset=0;processed=estimatedBytes=0;return false;}
        return true;
    }
    private void begin(WorldSelection.Chunk e){active=new JsonObject();active.addProperty("x",e.x());active.addProperty("z",e.z());active.addProperty("coverage","known");palette=new JsonArray();runs=new JsonArray();active.add("palette",palette);active.add("runs",runs);paletteIds=new HashMap<>();lastPalette=-1;lastRunCount=0;offset=0;estimatedBytes+=512;}
    private void flushRun(){if(lastPalette<0)return;var run=new JsonArray();run.add(lastPalette);run.add(lastRunCount);runs.add(run);lastPalette=-1;lastRunCount=0;}
    private void unknown(WorldSelection.Chunk e){processed-=offset;processed+=e.region().cells();var c=new JsonObject();c.addProperty("x",e.x());c.addProperty("z",e.z());c.addProperty("coverage","unknown");c.add("palette",new JsonArray());c.add("runs",new JsonArray());chunks.add(c);active=null;chunkIndex++;offset=0;}
    private void read(WorldSelection.Chunk e){var r=e.region();int w=r.max().x()-r.min().x(),l=r.max().z()-r.min().z();var point=new SelectionRegion.Point(r.min().x()+offset%w,r.min().y()+offset/(w*l),r.min().z()+offset/w%l);
        reads++;var fact=source.read(point);Integer id=paletteIds.get(fact.state());
        if(id==null){if(palette.size()>=SelectionLimits.paletteStates())throw new IllegalStateException("方块状态种类超限");id=palette.size();var p=new JsonObject();p.addProperty("state",fact.state());p.addProperty("blockEntity",fact.blockEntity());palette.add(p);paletteIds.put(fact.state(),id);estimatedBytes+=fact.state().length()*3L+80;}
        else if(palette.get(id).getAsJsonObject().get("blockEntity").getAsBoolean()!=fact.blockEntity())throw new IllegalStateException("方块实体事实互相矛盾");
        if(lastPalette==id)lastRunCount++;else{flushRun();lastPalette=id;lastRunCount=1;estimatedBytes+=32;}
        if(estimatedBytes>SelectionLimits.snapshotBytes())throw new IllegalStateException("快照大小超限");offset++;processed++;
    }
    public Progress step(){if(state!=State.READING)return progress();long started=clock.getAsLong();steps++;
        try{source.beginStep();if(guard()){int work=0;while(chunkIndex<expected.size()&&work<maxCells&&clock.getAsLong()-started<maxNanos){if(!guard())break;var e=expected.get(chunkIndex);if(!source.loaded(e.x(),e.z())){unknown(e);work++;continue;}if(active==null)begin(e);read(e);work++;if(offset==e.region().cells()){flushRun();chunks.add(active);active=null;offset=0;chunkIndex++;}}
            if(guard()&&chunkIndex==expected.size()){for(var c:chunks){var v=c.getAsJsonObject();if(v.get("coverage").getAsString().equals("known")&&!source.loaded(v.get("x").getAsInt(),v.get("z").getAsInt()))throw new IllegalStateException("区块卸载但变化计数未更新");}if(guard())state=State.CAPTURED;}
        }}catch(Exception error){stop(State.FAILED,error.getMessage());}finally{maxStepNanos=Math.max(maxStepNanos,clock.getAsLong()-started);}return progress();
    }
    /** Heavy serialization/Bridge validation must be scheduled outside game tick. */
    public JsonObject capture(){if(state!=State.CAPTURED)throw new IllegalStateException("没有完整快照");if(!guard())throw new IllegalStateException("快照已变化，请重新读取");var f=new JsonObject();f.addProperty("start",initialRevision);f.addProperty("end",initialRevision);var c=new JsonObject();c.add("fence",f);c.add("chunks",chunks.deepCopy());return c;}
    /** Constant-time ownership transfer on the server thread; worker receives
     * the sealed private buffer. The service rechecks its live fence afterward. */
    public JsonObject detachCapture(){if(state!=State.CAPTURED)throw new IllegalStateException("没有完整快照");if(!guard())throw new IllegalStateException("快照已变化，请重新读取");var f=new JsonObject();f.addProperty("start",initialRevision);f.addProperty("end",initialRevision);var c=new JsonObject();c.add("fence",f);c.add("chunks",chunks);chunks=new JsonArray();active=null;state=State.DETACHED;return c;}
    public WorldSelection selection(){return selection;}
}
