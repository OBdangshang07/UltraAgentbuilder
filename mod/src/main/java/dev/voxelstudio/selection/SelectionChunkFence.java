package dev.voxelstudio.selection;

import java.lang.ref.WeakReference;
import java.util.*;
import java.util.function.BiFunction;

/** Identity witness, NOT a cross-tick read cache. Each comparison requires a
 * fresh nonloading getNow query. Weak references do not keep chunks loaded. */
public final class SelectionChunkFence {
    private record Entry(int x,int z,boolean known,WeakReference<Object> identity) {
        boolean matches(Object current){return known?current!=null&&identity.get()==current:current==null;}
    }
    private final Map<Long,Entry> entries=new HashMap<>();
    private static long key(int x,int z){return ((long)x<<32)^(z&0xffffffffL);}
    public boolean observe(int x,int z,Object current){long key=key(x,z);var prior=entries.get(key);
        if(prior!=null)return prior.matches(current);if(entries.size()>=SelectionLimits.chunks())throw new IllegalStateException("区块身份见证额度超限");
        entries.put(key,new Entry(x,z,current!=null,new WeakReference<>(current)));return true;
    }
    public boolean stable(int expectedChunks,BiFunction<Integer,Integer,Object> freshQuery){
        if(entries.size()!=expectedChunks)return false;for(var e:entries.values())if(!e.matches(freshQuery.apply(e.x,e.z)))return false;return true;
    }
    public void reset(){entries.clear();}
}
