package dev.voxelstudio;

import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;

public final class ProjectionTools {
    public enum Axis { LOOK, X, Y, Z }
    public static double distance(double current,double steps){return Math.max(2,Math.min(96,current+steps));}
    public static BlockPos facingAnchor(Vec3d eye,Vec3d look,double distance,int width,int length){
        Vec3d point=eye.add(look.normalize().multiply(distance));
        return BlockPos.ofFloored(point.x-width/2.0,point.y,point.z-length/2.0);
    }
    public static BlockPos nudge(Axis axis,double x,double y,double z,int amount){
        Axis resolved=axis;
        if(resolved==Axis.LOOK)resolved=Math.abs(y)>Math.max(Math.abs(x),Math.abs(z))?Axis.Y:Math.abs(x)>Math.abs(z)?Axis.X:Axis.Z;
        double component=switch(resolved){case X->x;case Y->y;default->z;};int signed=component<0?-amount:amount;
        return switch(resolved){case X->new BlockPos(signed,0,0);case Y->new BlockPos(0,signed,0);default->new BlockPos(0,0,signed);};
    }
}
