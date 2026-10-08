package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;

/** Complete original v2 identity. This is not a legacy single-patch binding,
 * a server attestation, a SEND consent or a world-write capability. */
public record AssemblyPatchBinding(String captureId,WorldSelection selection,long contextRevision,
        String snapshotHash,String selectionHash,String worldContextHash,String jobId,
        String preparationHash,String requestHash,String runtimeHash,String referenceSetHash,
        String contextRecordHash,String referenceBindingHash,String sourceHash,String currentNativeEvidenceHash,
        String assetHash,String cellsHash,String candidateHash,String patchSetHash,
        SelectionRegion.Point origin,List<String> partHashes,List<String> previewHashes,int totalWrites) {
    public AssemblyPatchBinding {
        uuid(captureId);uuid(jobId);Objects.requireNonNull(selection);Objects.requireNonNull(origin);
        if(contextRevision<0||contextRevision>9007199254740991L)fail("Whole context revision out of range");
        for(var value:List.of(snapshotHash,selectionHash,worldContextHash,preparationHash,requestHash,
                runtimeHash,referenceSetHash,contextRecordHash,referenceBindingHash,sourceHash,currentNativeEvidenceHash,
                assetHash,cellsHash,candidateHash,patchSetHash))digest(value);
        if(!SelectionBaseline.hash(selection.json()).equals(selectionHash))fail("Whole selection hash changed");
        if(!selection.edit().min().equals(origin))fail("Whole origin cannot relocate, rotate or rescale original W");
        partHashes=checked(partHashes);previewHashes=checked(previewHashes);
        if(totalWrites<1||totalWrites>SelectionLimits.editCells()||partHashes.size()!=(totalWrites+8191)/8192
                ||previewHashes.size()!=partHashes.size())fail("Incomplete whole parts or original operation count");
        if(!SelectionBaseline.hash(patchSet(worldContextHash,snapshotHash,selectionHash,assetHash,cellsHash,origin,partHashes,totalWrites)).equals(patchSetHash))fail("Whole original patch-set content hash changed");
    }
    private static List<String> checked(List<String> values){
        Objects.requireNonNull(values);if(values.isEmpty()||values.size()>32)fail("Whole part quota exceeded");
        for(var value:values)digest(value);if(new HashSet<>(values).size()!=values.size())fail("Whole hash list repeated");return List.copyOf(values);
    }
    private static void digest(String value){if(value==null||!value.matches("[a-f0-9]{64}"))fail("Whole SHA256 required");}
    private static void uuid(String value){if(value==null||!value.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))fail("Whole original UUID required");}
    private static void fail(String reason){throw new IllegalArgumentException(reason);}
    public boolean movable(){return false;}public boolean canAuthorizePlacement(){return false;}
    private static JsonObject patchSet(String context,String snapshot,String selection,String asset,String cells,SelectionRegion.Point origin,List<String> hashes,int writes){
        var value=new JsonObject();value.addProperty("format","AssemblyWorldPatchSet");value.addProperty("version",2);
        value.addProperty("worldContextHash",context);value.addProperty("snapshotHash",snapshot);value.addProperty("selectionHash",selection);value.addProperty("assetHash",asset);value.addProperty("cellsHash",cells);
        value.add("origin",origin.json());value.addProperty("coordinateTransform","translate-only-original-W-min");value.addProperty("omittedCells","keep");
        value.addProperty("operationCount",writes);value.addProperty("partCount",hashes.size());var parts=new JsonArray();hashes.forEach(parts::add);value.add("partHashes",parts);
        value.addProperty("fullAssetProcessed",true);value.addProperty("partialPublicationAllowed",false);value.addProperty("serverBaselineVerified",false);value.addProperty("physicsVerified",false);value.addProperty("canAuthorizePlacement",false);value.addProperty("worldWrites",0);return value;
    }
    public JsonObject patchSet(){var value=patchSet(worldContextHash,snapshotHash,selectionHash,assetHash,cellsHash,origin,partHashes,totalWrites);value.addProperty("patchSetHash",patchSetHash);return value;}
    public JsonObject json(){
        var value=new JsonObject();value.addProperty("format","AssemblyPatchBinding");value.addProperty("version",2);
        value.addProperty("captureId",captureId);value.add("selection",selection.json());value.addProperty("contextRevision",contextRevision);
        var names=List.of("snapshotHash","selectionHash","worldContextHash","jobId","preparationHash","requestHash","runtimeHash","referenceSetHash","contextRecordHash","referenceBindingHash","sourceHash","currentNativeEvidenceHash","assetHash","cellsHash","candidateHash","patchSetHash");
        var values=List.of(snapshotHash,selectionHash,worldContextHash,jobId,preparationHash,requestHash,runtimeHash,referenceSetHash,contextRecordHash,referenceBindingHash,sourceHash,currentNativeEvidenceHash,assetHash,cellsHash,candidateHash,patchSetHash);
        for(int i=0;i<names.size();i++)value.addProperty(names.get(i),values.get(i));value.add("origin",origin.json());
        var parts=new JsonArray();partHashes.forEach(parts::add);value.add("partHashes",parts);var previews=new JsonArray();previewHashes.forEach(previews::add);value.add("previewHashes",previews);
        value.addProperty("totalWrites",totalWrites);value.addProperty("movable",false);value.addProperty("canAuthorizePlacement",false);return value;
    }
    /** Strict read-only archive identity, never a server attestation. */
    static AssemblyPatchBinding parse(JsonObject v){
        WorldPatchJson.keys(v,"format","version","captureId","selection","contextRevision","snapshotHash","selectionHash","worldContextHash","jobId","preparationHash","requestHash","runtimeHash","referenceSetHash","contextRecordHash","referenceBindingHash","sourceHash","currentNativeEvidenceHash","assetHash","cellsHash","candidateHash","patchSetHash","origin","partHashes","previewHashes","totalWrites","movable","canAuthorizePlacement");
        if(!WorldPatchJson.text(v.get("format")).equals("AssemblyPatchBinding"))fail("Whole archive format changed");WorldPatchJson.integer(v.get("version"),2,2);
        for(var name:List.of("movable","canAuthorizePlacement")){var f=v.get(name);if(f==null||!f.isJsonPrimitive()||!f.getAsJsonPrimitive().isBoolean()||f.getAsBoolean())fail("Whole archive cannot acquire permissions");}
        var selection=selection(v.getAsJsonObject("selection"));
        var parts=new ArrayList<String>();for(var h:v.getAsJsonArray("partHashes"))parts.add(WorldPatchJson.text(h));
        var previews=new ArrayList<String>();for(var h:v.getAsJsonArray("previewHashes"))previews.add(WorldPatchJson.text(h));
        return new AssemblyPatchBinding(WorldPatchJson.text(v.get("captureId")),selection,WorldPatchJson.integer(v.get("contextRevision"),0,9007199254740991L),
                WorldPatchJson.text(v.get("snapshotHash")),WorldPatchJson.text(v.get("selectionHash")),WorldPatchJson.text(v.get("worldContextHash")),WorldPatchJson.text(v.get("jobId")),
                WorldPatchJson.text(v.get("preparationHash")),WorldPatchJson.text(v.get("requestHash")),WorldPatchJson.text(v.get("runtimeHash")),WorldPatchJson.text(v.get("referenceSetHash")),
                WorldPatchJson.text(v.get("contextRecordHash")),WorldPatchJson.text(v.get("referenceBindingHash")),WorldPatchJson.text(v.get("sourceHash")),WorldPatchJson.text(v.get("currentNativeEvidenceHash")),
                WorldPatchJson.text(v.get("assetHash")),WorldPatchJson.text(v.get("cellsHash")),WorldPatchJson.text(v.get("candidateHash")),WorldPatchJson.text(v.get("patchSetHash")),WorldPatchJson.point(v.get("origin")),parts,previews,(int)WorldPatchJson.integer(v.get("totalWrites"),1,SelectionLimits.editCells()));
    }
    private static WorldSelection selection(JsonObject v){
        WorldPatchJson.keys(v,"format","version","world","revision","context","edit","protected");if(!WorldPatchJson.text(v.get("format")).equals("WorldSelection"))fail("Whole archived selection format changed");WorldPatchJson.integer(v.get("version"),1,1);
        var w=v.getAsJsonObject("world");WorldPatchJson.keys(w,"worldId","dimension","minY","maxY");
        var world=new WorldSelection.WorldIdentity(WorldPatchJson.text(w.get("worldId")),WorldPatchJson.text(w.get("dimension")),(int)WorldPatchJson.integer(w.get("minY"),-2048,2048),(int)WorldPatchJson.integer(w.get("maxY"),-2048,2048));
        var protectedRegions=new ArrayList<SelectionRegion>();for(var r:v.getAsJsonArray("protected"))protectedRegions.add(region(r.getAsJsonObject()));
        return new WorldSelection(world,WorldPatchJson.integer(v.get("revision"),0,9007199254740991L),region(v.getAsJsonObject("context")),region(v.getAsJsonObject("edit")),protectedRegions);
    }
    private static SelectionRegion region(JsonObject v){WorldPatchJson.keys(v,"min","max");return new SelectionRegion(WorldPatchJson.point(v.get("min")),WorldPatchJson.point(v.get("max")));}
}
