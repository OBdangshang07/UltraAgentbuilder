package dev.voxelstudio.client;

import java.util.LinkedHashSet;

/** Only explicit dev evidence settings; never clamps an invalid floor to a different one. */
final class AssetFloorBands {
    static int[] parse(String requested,int height,int fallback) {
        if(requested==null)return new int[]{fallback};
        String[] tokens=requested.split(",",-1);
        if(tokens.length<1||tokens.length>16)throw new IllegalArgumentException("Choose 1..16 slab Y coordinates");
        var values=new LinkedHashSet<Integer>();
        for(String token:tokens){
            if(!token.matches("[0-9]{1,3}"))throw new IllegalArgumentException("Invalid slab Y coordinate: "+token);
            int y=Integer.parseInt(token);
            if(y+3>=height||!values.add(y))throw new IllegalArgumentException("Slab band outside asset or duplicate Y: "+y);
        }
        return values.stream().mapToInt(Integer::intValue).toArray();
    }
}
