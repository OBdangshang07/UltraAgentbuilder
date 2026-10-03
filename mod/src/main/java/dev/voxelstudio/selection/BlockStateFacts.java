package dev.voxelstudio.selection;

import net.minecraft.block.BlockState;
import net.minecraft.registry.Registries;
import net.minecraft.state.property.Property;
import java.util.*;

/** Registry-owned facts only. Never touches a block entity, NBT or inventory. */
public final class BlockStateFacts {
    public static SelectionScan.BlockFact read(BlockState state) {
        Objects.requireNonNull(state);
        var properties=new TreeMap<String,String>();
        for(var property:state.getProperties()) properties.put(property.getName(),value(state,property));
        String id=Registries.BLOCK.getId(state.getBlock()).toString();
        String suffix=properties.isEmpty()?"":"["+String.join(",",properties.entrySet().stream().map(e->e.getKey()+"="+e.getValue()).toList())+"]";
        return new SelectionScan.BlockFact(id+suffix,state.hasBlockEntity());
    }
    private static <T extends Comparable<T>> String value(BlockState state,Property<T> property) { return property.name(state.get(property)); }
    private BlockStateFacts(){}
}
