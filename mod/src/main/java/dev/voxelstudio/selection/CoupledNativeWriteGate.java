package dev.voxelstudio.selection;

import java.util.*;
import java.util.function.IntFunction;

/** Per-source exact group/cursor gate. No world or consent API. Expected
 * rows are fetched lazily (at most two), never indexed en masse on a tick. */
final class CoupledNativeWriteGate {
    private final int count;private final IntFunction<List<WorldPatchCompiler.Write>> expected;
    private List<WorldPatchCompiler.Write> active;private int next,cursor;private boolean broken;
    CoupledNativeWriteGate(int count,IntFunction<List<WorldPatchCompiler.Write>> expected){
        if(count<1||count>SelectionLimits.editCells())throw new IllegalArgumentException("Complete original group count required");this.count=count;this.expected=Objects.requireNonNull(expected);
    }
    private List<WorldPatchCompiler.Write> nextRows(){
        var rows=List.copyOf(expected.apply(next));if(rows.isEmpty()||rows.size()>2||rows.size()==2&&rows.get(0).position().equals(rows.get(1).position()))throw new IllegalStateException("Original one/two-cell group required");return rows;
    }
    boolean expects(List<WorldPatchCompiler.Write> rows){return !broken&&active==null&&next<count&&nextRows().equals(rows);}
    boolean arm(List<WorldPatchCompiler.Write> rows){if(!expects(rows))return false;active=nextRows();cursor=0;return true;}
    boolean permits(WorldPatchCompiler.Write row){return !broken&&active!=null&&cursor<active.size()&&active.get(cursor).equals(row);}
    void applied(WorldPatchCompiler.Write row){if(!permits(row)){revoke();throw new IllegalStateException("Unarmed, reordered or repeated original group write");}cursor++;}
    boolean fullyWritten(List<WorldPatchCompiler.Write> rows){return !broken&&active!=null&&active.equals(rows)&&cursor==active.size();}
    int complete(List<WorldPatchCompiler.Write> rows){
        if(!fullyWritten(rows)){revoke();throw new IllegalStateException("Half or different group cannot close");}
        int size=active.size();active=null;cursor=0;next++;return size;
    }
    /** Inverse-only no-write disposition. It must name the exact next whole
     * group while unarmed; a half-written group can never become preserved. */
    void preserve(List<WorldPatchCompiler.Write> rows){
        if(!expects(rows)){revoke();throw new IllegalStateException("Only the exact next unarmed complete inverse group may be preserved");}next++;
    }
    int writtenInActiveGroup(){return active==null?0:cursor;}boolean broken(){return broken;}
    void revoke(){broken=true;active=null;cursor=0;}
}
