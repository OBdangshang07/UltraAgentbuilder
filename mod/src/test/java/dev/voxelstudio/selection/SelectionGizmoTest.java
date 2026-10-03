package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class SelectionGizmoTest {
    private final SelectionRegion r=new SelectionRegion(new SelectionRegion.Point(-4,-2,-6),new SelectionRegion.Point(4,8,6));
    private SelectionGizmo.Ray ray(double x,double y,double z,double dx,double dy,double dz){return new SelectionGizmo.Ray(new SelectionGizmo.Vector(x,y,z),new SelectionGizmo.Vector(dx,dy,dz));}
    @Test void bothSidesAndNegativeWorldCoordinatesUseCorrectFace(){var a=SelectionGizmo.hit(r,ray(-10,2,0,1,0,0),100);assertEquals(0,a.axis());assertFalse(a.maximum());assertEquals(6,a.distance());var b=SelectionGizmo.hit(r,ray(10,2,0,-1,0,0),100);assertTrue(b.maximum());assertEquals(4,b.point().x());}
    @Test void insideRaysChooseExitNotInvisibleBackwardsFace(){var a=SelectionGizmo.hit(r,ray(0,0,0,0,1,0),100);assertEquals(1,a.axis());assertTrue(a.maximum());assertEquals(8,a.distance());}
    @Test void missedBehindParallelAndOutOfReachRaysDoNotCaptureDrag(){assertNull(SelectionGizmo.hit(r,ray(10,20,0,-1,0,0),100));assertNull(SelectionGizmo.hit(r,ray(10,2,0,1,0,0),100));assertNull(SelectionGizmo.hit(r,ray(-10,2,0,1,0,0),5));}
    @Test void ambiguousAxisViewCannotJumpToHugeCoordinates(){assertNull(SelectionGizmo.axisCoordinate(ray(0,0,-10,0,0,1),2,new SelectionGizmo.Vector(0,0,0)));assertThrows(IllegalArgumentException.class,()->ray(0,0,0,0,0,0));}
    @Test void dragCoordinateUsesAxisAndDoesNotTeleportInitialFace(){var anchor=new SelectionGizmo.Vector(0,0,0);var a=SelectionGizmo.axisCoordinate(ray(0,3,-10,0,-1,1),1,anchor);var b=SelectionGizmo.axisCoordinate(ray(0,5,-10,0,-1,1),1,anchor);assertEquals(2,b-a,1e-9);var face=new SelectionGizmo.Face(1,true,1,anchor);assertEquals(8,SelectionGizmo.movedFace(r,face,a,a));assertEquals(10,SelectionGizmo.movedFace(r,face,a,b));}
    @Test void nonfiniteValuesAndCoordinateOverflowAreRejected(){assertThrows(IllegalArgumentException.class,()->new SelectionGizmo.Vector(Double.NaN,0,0));assertThrows(ArithmeticException.class,()->SelectionGizmo.movedFace(r,new SelectionGizmo.Face(0,true,1,new SelectionGizmo.Vector(0,0,0)),0,Double.MAX_VALUE));}
}
