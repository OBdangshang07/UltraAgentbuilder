package dev.voxelstudio.selection;

import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.function.LongSupplier;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic Source only; its support booleans are NOT native game evidence. */
final class CoupledAssemblyUndoTestFixtures {
    static final class Clock implements LongSupplier{long now;public long getAsLong(){return now+=100;}}
    static final class Queue implements Executor{final ArrayDeque<Runnable> work=new ArrayDeque<>();boolean worker;public void execute(Runnable r){work.add(r);}void pump(){while(!work.isEmpty()){worker=true;try{work.remove().run();}finally{worker=false;}}}}
    static final class Memory implements CoupledAssemblyExecution.Source {
        final CoupledAssemblyJournal.Plan plan;final Queue queue;final Map<SelectionRegion.Point,SelectionScan.BlockFact> changed=new HashMap<>();final Map<List<Integer>,Object> chunks=new HashMap<>();final List<WorldPatchCompiler.Write> attempts=new ArrayList<>();
        long revision;boolean host=true,unloaded,replaced,undo,failLower,denyLower,denyUpper,throwAfterLower,extraRevision,support=true,afterSupport=true;Runnable upper=()->{};
        Memory(CoupledAssemblyJournal.Plan plan,Queue queue){this.plan=plan;this.queue=queue;revision=plan.binding().contextRevision();}
        private void thread(){assertFalse(queue.worker,"World access on disk worker");}
        public void beginStep(){thread();}public CoupledAssemblyExecution.Frame frame(){thread();var s=plan.binding().selection();return new CoupledAssemblyExecution.Frame(s.world().worldId(),s.world().dimension(),s.revision(),revision,host);}
        public Object loadedChunk(int x,int z){thread();return unloaded?null:replaced?new Object():chunks.computeIfAbsent(List.of(x,z),k->new Object());}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){thread();return changed.getOrDefault(p,plan.compiled().baseline().at(p));}
        public boolean verifyGroup(List<WorldPatchCompiler.Write> group,boolean after){thread();return after?afterSupport:support;}
        public boolean set(WorldPatchCompiler.Write w){
            thread();attempts.add(w);assertEquals(w.before(),read(w.position()).state());assertFalse(plan.binding().selection().protectedAt(w.position()));
            boolean lower=undo&&w.before().contains("half=lower"),isUpper=undo&&w.before().contains("half=upper");if(lower&&failLower)throw new IllegalStateException("Synthetic inverse lower failed");if(lower&&denyLower||isUpper&&denyUpper)return false;
            changed.put(w.position(),new SelectionScan.BlockFact(w.after(),false));revision++;if(extraRevision)revision++;if(isUpper)upper.run();if(lower&&throwAfterLower)throw new IllegalStateException("Synthetic inverse lower mutated then threw");return true;
        }
        void editDoorHalf(String half){var w=plan.compiled().writes().stream().filter(r->r.after().contains("half="+half)).findFirst().orElseThrow();changed.put(w.position(),new SelectionScan.BlockFact("minecraft:diamond_block",false));}
    }
    record Forward(CoupledAssemblyJournal.Live live,Queue queue,Clock clock,Memory memory,CoupledAssemblyExecution engine){}
    record Undo(Forward forward,CoupledAssemblyUndoJournal.Live live,CoupledAssemblyUndoExecution.Disk disk,CoupledAssemblyUndoExecution engine){}
    static Forward forward(Path temp,String name)throws Exception{
        var live=CoupledAssemblyJournal.create(temp,CoupledAssemblyTestFixtures.plan(name));var queue=new Queue();var clock=new Clock();var memory=new Memory(live.plan(),queue);var engine=new CoupledAssemblyExecution(new CoupledAssemblyExecution.Disk(live,queue),memory,128,2_000_000,clock);
        for(int i=0;i<20000&&engine.progress().state()!=CoupledAssemblyExecution.State.COMPLETED;i++){engine.step();queue.pump();}assertEquals(CoupledAssemblyExecution.State.COMPLETED,engine.progress().state(),engine.progress().toString());memory.undo=true;memory.attempts.clear();return new Forward(live,queue,clock,memory,engine);
    }
    static Undo undo(Path temp,String name,int budget)throws Exception{var f=forward(temp,name);return undo(temp,f,budget);}
    static Undo undo(Path temp,Forward f,int budget)throws Exception{var live=CoupledAssemblyUndoJournal.create(temp,f.engine.undoOrigin());var disk=new CoupledAssemblyUndoExecution.Disk(live,f.queue);return new Undo(f,live,disk,new CoupledAssemblyUndoExecution(disk,f.memory,budget,2_000_000,f.clock));}
    static boolean terminal(CoupledAssemblyUndoExecution.State s){return Set.of(CoupledAssemblyUndoExecution.State.COMPLETED,CoupledAssemblyUndoExecution.State.CANCELLED,CoupledAssemblyUndoExecution.State.CONFLICT,CoupledAssemblyUndoExecution.State.REVIEW_REQUIRED).contains(s);}
    static void finish(Undo r){for(int i=0;i<20000&&!terminal(r.engine.progress().state());i++){r.engine.step();r.forward.queue.pump();}assertTrue(terminal(r.engine.progress().state()),r.engine.progress().toString());}
    static void applying(Undo r){r.engine.step();assertEquals(CoupledAssemblyUndoExecution.State.WAIT_INTENT,r.engine.progress().state());assertTrue(r.forward.memory.attempts.isEmpty());r.forward.queue.pump();r.engine.step();assertEquals(CoupledAssemblyUndoExecution.State.APPLYING,r.engine.progress().state());}
    private CoupledAssemblyUndoTestFixtures(){}
}
