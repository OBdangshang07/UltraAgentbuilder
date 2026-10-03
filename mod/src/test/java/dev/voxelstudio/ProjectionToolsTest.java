package dev.voxelstudio;
import net.minecraft.util.math.BlockPos;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ProjectionToolsTest {
    @Test void facingDistanceUsesViewRayAndBottomCenterWithNegativeCoordinates(){
        assertEquals(new BlockPos(-5,64,-15),ProjectionTools.facingAnchor(new net.minecraft.util.math.Vec3d(0,64,0),new net.minecraft.util.math.Vec3d(0,0,-1),10,10,10));
        assertEquals(new BlockPos(-5,74,-5),ProjectionTools.facingAnchor(new net.minecraft.util.math.Vec3d(0,64,0),new net.minecraft.util.math.Vec3d(0,1,0),10,10,10));
        assertEquals(96,ProjectionTools.distance(95,8));assertEquals(2,ProjectionTools.distance(3,-8));
    }
    DraftHistory.Transform at(int n){return new DraftHistory.Transform(n,64,-n,0,false);}
    @Test void draftUndoRedoRestoresExactTransformAndNewEditClearsRedo(){var h=new DraftHistory();h.remember(at(0),at(1));h.remember(at(1),at(2));assertEquals(at(1),h.undo(at(2)));assertEquals(at(2),h.redo(at(1)));assertEquals(at(1),h.undo(at(2)));h.remember(at(1),at(3));assertFalse(h.canRedo());assertEquals(at(1),h.undo(at(3)));}
    @Test void historyIsBoundedAndClearingDropsAllCrossAssetReferences(){var h=new DraftHistory();for(int i=0;i<80;i++)h.remember(at(i),at(i+1));var state=at(80);int count=0;while(h.canUndo()){state=h.undo(state);count++;}assertEquals(32,count);assertEquals(at(48),state);h.clear();assertFalse(h.canUndo());assertFalse(h.canRedo());}
    @Test void noOpDoesNotConsumeHistoryOrDiscardRedo(){var h=new DraftHistory();h.remember(at(0),at(0));assertFalse(h.canUndo());h.remember(at(0),at(1));h.undo(at(1));h.remember(at(0),at(0));assertTrue(h.canRedo());}
    @Test void lookNudgeSelectsDominantAxisAndRespectsNegativeDirection(){assertEquals(new BlockPos(0,0,-1),ProjectionTools.nudge(ProjectionTools.Axis.LOOK,.1,.1,-.9,1));assertEquals(new BlockPos(0,-8,0),ProjectionTools.nudge(ProjectionTools.Axis.LOOK,.1,-.9,.2,8));assertEquals(new BlockPos(-1,0,0),ProjectionTools.nudge(ProjectionTools.Axis.LOOK,-.9,.1,.2,1));}
    @Test void fixedAxisIgnoresOtherComponentsAndReverseScrollReverses(){assertEquals(new BlockPos(0,1,0),ProjectionTools.nudge(ProjectionTools.Axis.Y,.9,0,-.9,1));assertEquals(new BlockPos(0,0,8),ProjectionTools.nudge(ProjectionTools.Axis.Z,.9,.8,-.1,-8));}
}
