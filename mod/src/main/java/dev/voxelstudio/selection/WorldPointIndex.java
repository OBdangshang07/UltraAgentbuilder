package dev.voxelstudio.selection;

import java.util.*;

/** Defensive immutable coordinate lookup, not identity or write authority.
 * Dense Point record hashes cluster badly in Map.copyOf's flat MapN table.
 * Preserve Point equality/hash and all coordinates; use HashMap's collision
 * handling instead. Ordered writes and wire serialization stay separate. */
public final class WorldPointIndex {
    public static <V> Map<SelectionRegion.Point,V> copy(Map<SelectionRegion.Point,? extends V> source){
        Objects.requireNonNull(source);
        var copy=new HashMap<SelectionRegion.Point,V>();
        source.forEach((point,value)->copy.put(Objects.requireNonNull(point),Objects.requireNonNull(value)));
        return Collections.unmodifiableMap(copy);
    }
    private WorldPointIndex(){}
}
