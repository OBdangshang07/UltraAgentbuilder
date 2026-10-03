package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Same bundled data contract used by Bridge; no caller/model overrides. */
public final class SelectionLimits {
    private static final JsonObject DATA=load();
    private static JsonObject load(){try(var in=SelectionLimits.class.getResourceAsStream("/voxelstudio-bundle/contracts/world-selection-limits.json")){
        if(in==null)throw new IOException("Missing selection contract");var v=JsonParser.parseReader(new InputStreamReader(in,StandardCharsets.UTF_8)).getAsJsonObject();
        if(v.get("version").getAsInt()!=1||v.size()!=8||v.getAsJsonArray("axes").size()!=3)throw new IOException("Invalid selection contract");
        for(String key:new String[]{"contextCells","editCells","protectedRegions","chunks","snapshotBytes","paletteStates"})if(v.get(key).getAsLong()<=0)throw new IOException("Invalid selection quota");return v;
    }catch(Exception e){throw new IllegalStateException("Cannot load selection contract; no scan authorized",e);}}
    public static int axis(int axis){return DATA.getAsJsonArray("axes").get(axis).getAsInt();}
    public static long contextCells(){return DATA.get("contextCells").getAsLong();}
    public static long editCells(){return DATA.get("editCells").getAsLong();}
    public static int protectedRegions(){return DATA.get("protectedRegions").getAsInt();}
    public static int chunks(){return DATA.get("chunks").getAsInt();}
    public static int snapshotBytes(){return DATA.get("snapshotBytes").getAsInt();}
    public static int paletteStates(){return DATA.get("paletteStates").getAsInt();}
    private SelectionLimits(){}
}
