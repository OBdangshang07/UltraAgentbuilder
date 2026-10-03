package dev.voxelstudio;

import net.minecraft.world.World;
import net.minecraft.util.math.BlockPos;
import java.util.*;

/** Only active bounded regions are tracked; no unbounded per-block/world history. */
public final class WorldChangeTracker {
    private static final Map<World,List<Watch>> WATCHES=new WeakHashMap<>();
    public static final class Watch implements AutoCloseable {
        private final World world;private final int x,y,z,w,h,l;private volatile long revision;
        private Watch(World world,int x,int y,int z,int w,int h,int l){this.world=world;this.x=x;this.y=y;this.z=z;this.w=w;this.h=h;this.l=l;}
        public long revision(){return revision;}
        boolean contains(BlockPos p){return p.getX()>=x&&(long)p.getX()<((long)x+w)&&p.getY()>=y&&(long)p.getY()<((long)y+h)&&p.getZ()>=z&&(long)p.getZ()<((long)z+l);}
        public void close(){synchronized(WATCHES){var list=WATCHES.get(world);if(list!=null){list.remove(this);if(list.isEmpty())WATCHES.remove(world);}}}
    }
    private static Watch bounded(World world,int x,int y,int z,int w,int h,int l){if(world==null||w<1||h<1||l<1)throw new IllegalArgumentException("Invalid watched region");synchronized(WATCHES){var list=WATCHES.computeIfAbsent(world,k->new ArrayList<>());if(list.size()>=8)throw new IllegalStateException("Too many active region checks");var watch=new Watch(world,x,y,z,w,h,l);list.add(watch);return watch;}}
    public static Watch watch(World world,Placement p){return bounded(world,p.anchor().getX(),p.anchor().getY(),p.anchor().getZ(),p.width(),p.asset().height,p.length());}
    public static Watch watch(World world,dev.voxelstudio.selection.SelectionRegion r){return bounded(world,r.min().x(),r.min().y(),r.min().z(),r.max().x()-r.min().x(),r.max().y()-r.min().y(),r.max().z()-r.min().z());}
    public static void block(World world,BlockPos pos){synchronized(WATCHES){var list=WATCHES.get(world);if(list!=null)for(var w:list)if(w.contains(pos))w.revision++;}}
    public static void chunk(World world,int x,int z){synchronized(WATCHES){var list=WATCHES.get(world);if(list!=null)for(var w:list)if(x>=Math.floorDiv(w.x,16)&&x<=Math.floorDiv(w.x+w.w-1,16)&&z>=Math.floorDiv(w.z,16)&&z<=Math.floorDiv(w.z+w.l-1,16))w.revision++;}}
    public static void clear(World world){synchronized(WATCHES){var list=WATCHES.remove(world);if(list!=null)for(var w:list)w.revision++;}}
}
