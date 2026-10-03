package dev.voxelstudio.selection;

/** Pure world-space hit/drag math. It creates no block interaction events. */
public final class SelectionGizmo {
    public record Vector(double x,double y,double z) {
        public Vector { if(!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(z))throw new IllegalArgumentException("Nonfinite vector"); }
        public double axis(int axis){return switch(axis){case 0->x;case 1->y;case 2->z;default->throw new IllegalArgumentException("Invalid axis");};}
        public Vector subtract(Vector v){return new Vector(x-v.x,y-v.y,z-v.z);}
        public Vector add(Vector v){return new Vector(x+v.x,y+v.y,z+v.z);}
        public Vector scale(double n){return new Vector(x*n,y*n,z*n);}
        public double dot(Vector v){return x*v.x+y*v.y+z*v.z;}
    }
    public record Ray(Vector origin,Vector direction) {
        public Ray { double length=Math.sqrt(direction.dot(direction));if(length<1e-9)throw new IllegalArgumentException("Empty ray");direction=direction.scale(1/length); }
        public Vector at(double t){return origin.add(direction.scale(t));}
    }
    public record Face(int axis,boolean maximum,double distance,Vector point) {}
    public static Face hit(SelectionRegion r,Ray ray,double maximumDistance) {
        if(!Double.isFinite(maximumDistance)||maximumDistance<=0)throw new IllegalArgumentException("Invalid reach");
        double near=Double.NEGATIVE_INFINITY,far=Double.POSITIVE_INFINITY;int enter=-1,exit=-1;boolean enterMax=false,exitMax=false;
        for(int a=0;a<3;a++){
            double origin=ray.origin.axis(a),direction=ray.direction.axis(a),min=r.min().axis(a),max=r.max().axis(a);
            if(Math.abs(direction)<1e-9){if(origin<min||origin>max)return null;continue;}
            double t1=(min-origin)/direction,t2=(max-origin)/direction;boolean firstMax=false,lastMax=true;
            if(t1>t2){double tmp=t1;t1=t2;t2=tmp;firstMax=true;lastMax=false;}
            if(t1>near){near=t1;enter=a;enterMax=firstMax;}if(t2<far){far=t2;exit=a;exitMax=lastMax;}
            if(near>far)return null;
        }
        if(far<0)return null;
        boolean inside=near<0;double distance=inside?far:near;int axis=inside?exit:enter;
        if(axis<0||distance>maximumDistance)return null;return new Face(axis,inside?exitMax:enterMax,distance,ray.at(distance));
    }
    /** Closest point on the face-normal axis. Parallel view is ambiguous and
     * rejected; no enormous jump or silent axis fallback is permitted. */
    public static Double axisCoordinate(Ray ray,int axis,Vector anchor) {
        if(axis<0||axis>2)throw new IllegalArgumentException("Invalid axis");
        var offset=ray.origin.subtract(anchor);double d=ray.direction.axis(axis),denominator=1-d*d;
        if(denominator<1e-5)return null;
        double t=(d*offset.axis(axis)-ray.direction.dot(offset))/denominator;
        if(t<0)return null;
        return ray.origin.axis(axis)+t*d;
    }
    public static int movedFace(SelectionRegion initial,Face face,double initialCoordinate,double currentCoordinate) {
        if(!Double.isFinite(initialCoordinate)||!Double.isFinite(currentCoordinate))throw new IllegalArgumentException("Nonfinite drag");
        long delta=Math.round(currentCoordinate-initialCoordinate),original=(face.maximum?initial.max():initial.min()).axis(face.axis);
        return Math.toIntExact(Math.addExact(original,delta));
    }
    private SelectionGizmo(){}
}
