package dev.voxelstudio.selection;

import com.google.gson.*;

/** Absolute min-inclusive/max-exclusive box, independent of Minecraft rendering. */
public record SelectionRegion(Point min, Point max) {
    public record Point(int x,int y,int z) {
        public Point { if(Math.abs((long)x)>30000000||Math.abs((long)z)>30000000||Math.abs((long)y)>2048)throw new IllegalArgumentException("坐标超出支持范围"); }
        public int axis(int axis){return switch(axis){case 0->x;case 1->y;case 2->z;default->throw new IllegalArgumentException("Invalid axis");};}
        public JsonArray json(){var a=new JsonArray();a.add(x);a.add(y);a.add(z);return a;}
    }
    public SelectionRegion {
        if(min==null||max==null)throw new IllegalArgumentException("选区需要两个边界");
        for(int axis=0;axis<3;axis++)if(max.axis(axis)<=min.axis(axis)||(long)max.axis(axis)-min.axis(axis)>SelectionLimits.axis(axis))throw new IllegalArgumentException("选区为空、颠倒或过大");
    }
    public long cells(){return (long)(max.x-min.x)*(max.y-min.y)*(max.z-min.z);}
    public boolean contains(Point point){return point.x>=min.x&&point.x<max.x&&point.y>=min.y&&point.y<max.y&&point.z>=min.z&&point.z<max.z;}
    public boolean contains(SelectionRegion other){for(int axis=0;axis<3;axis++)if(min.axis(axis)>other.min.axis(axis)||max.axis(axis)<other.max.axis(axis))return false;return true;}
    public SelectionRegion height(int bottom,int top){if(min.y<bottom||max.y>top)throw new IllegalArgumentException("选区超出维度高度");return this;}
    public static SelectionRegion corners(Point a,Point b){return new SelectionRegion(new Point(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.min(a.z,b.z)),new Point(Math.addExact(Math.max(a.x,b.x),1),Math.addExact(Math.max(a.y,b.y),1),Math.addExact(Math.max(a.z,b.z),1)));}
    public SelectionRegion move(int axis,int step){int[] lo={min.x,min.y,min.z},hi={max.x,max.y,max.z};if(axis<0||axis>2)throw new IllegalArgumentException("Invalid axis");lo[axis]=Math.addExact(lo[axis],step);hi[axis]=Math.addExact(hi[axis],step);return new SelectionRegion(new Point(lo[0],lo[1],lo[2]),new Point(hi[0],hi[1],hi[2]));}
    public SelectionRegion face(int axis,boolean maximum,int coordinate){int[] lo={min.x,min.y,min.z},hi={max.x,max.y,max.z};if(axis<0||axis>2)throw new IllegalArgumentException("Invalid axis");(maximum?hi:lo)[axis]=coordinate;return new SelectionRegion(new Point(lo[0],lo[1],lo[2]),new Point(hi[0],hi[1],hi[2]));}
    public JsonObject json(){var o=new JsonObject();o.add("min",min.json());o.add("max",max.json());return o;}
}
