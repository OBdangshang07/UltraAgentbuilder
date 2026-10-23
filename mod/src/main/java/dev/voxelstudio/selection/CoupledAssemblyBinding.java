package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;

/** Explicit NEW complete transport identity. Never legacy AssemblyPatchBinding,
 * model SEND, a server baseline attestation or world-write consent. */
public record CoupledAssemblyBinding(String captureId,WorldSelection selection,String jobId,String worldContextHash,
        String preparationHash,String requestHash,String runtimeHash,String referenceSetHash,String contextRecordHash,
        String referenceBindingHash,String sourceHash,String currentNativeEvidenceHash,String candidateHash,
        long contextRevision,String snapshotHash,String selectionHash,String assetHash,String cellsHash,String patchSetHash,
        SelectionRegion.Point origin,List<String> partHashes,List<String> previewHashes,int totalWrites,
        String couplingPlanHash,String couplingPolicyHash,String analysisHash,String scheduleHash) {
    public CoupledAssemblyBinding {
        uuid(captureId);uuid(jobId);Objects.requireNonNull(selection);Objects.requireNonNull(origin);
        if(contextRevision<0||contextRevision>9007199254740991L)fail("Coupled context revision required");
        for(String value:List.of(worldContextHash,preparationHash,requestHash,runtimeHash,referenceSetHash,contextRecordHash,referenceBindingHash,sourceHash,
                currentNativeEvidenceHash,candidateHash,snapshotHash,selectionHash,assetHash,cellsHash,patchSetHash,couplingPlanHash,couplingPolicyHash,analysisHash,scheduleHash))digest(value);
        if(!SelectionBaseline.hash(selection.json()).equals(selectionHash)||!selection.edit().min().equals(origin))fail("Coupled selection/origin changed");
        partHashes=hashes(partHashes);previewHashes=hashes(previewHashes);
        if(totalWrites<1||totalWrites>SelectionLimits.editCells()||partHashes.size()!=(totalWrites+8191)/8192||previewHashes.size()!=partHashes.size())fail("Complete coupled parts/count required");
        if(!SelectionBaseline.hash(set(snapshotHash,selectionHash,assetHash,cellsHash,couplingPlanHash,partHashes,totalWrites)).equals(patchSetHash))fail("Complete coupled patch-set hash mismatch");
    }
    private static List<String> hashes(List<String> values){
        Objects.requireNonNull(values);if(values.isEmpty()||values.size()>SelectionLimits.assemblyParts())fail("Coupled hash-list quota");
        for(String value:values)digest(value);if(new HashSet<>(values).size()!=values.size())fail("Coupled hash list repeats");return List.copyOf(values);
    }
    private static void digest(String value){if(value==null||!value.matches("[a-f0-9]{64}"))fail("Coupled SHA256 required");}
    private static void uuid(String value){if(value==null||!value.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))fail("Coupled task/capture UUID required");}
    private static void fail(String message){throw new IllegalArgumentException(message);}
    public boolean canAuthorizePlacement(){return false;}public boolean canAuthorizeModelSend(){return false;}public boolean movable(){return false;}
    public WorldPatchPreview.Binding previewBinding(int index){
        if(index<0||index>=partHashes.size())throw new IllegalArgumentException("Exact coupled part index required");
        return new WorldPatchPreview.Binding(selection,contextRevision,snapshotHash,selectionHash,partHashes.get(index),previewHashes.get(index),couplingPlanHash,couplingPolicyHash);
    }
    private static JsonObject set(String snapshot,String selection,String asset,String cells,String plan,List<String> hashes,int count){
        var v=new JsonObject();v.addProperty("format","AssemblyCoupledPatchSet");v.addProperty("version",1);v.addProperty("policy",AssemblyCoupledPolicy.POLICY);v.addProperty("planHash",plan);
        v.addProperty("snapshotHash",snapshot);v.addProperty("selectionHash",selection);v.addProperty("assetHash",asset);v.addProperty("cellsHash",cells);v.addProperty("operationCount",count);v.addProperty("partCount",hashes.size());var a=new JsonArray();hashes.forEach(a::add);v.add("partHashes",a);
        v.addProperty("fullAssetProcessed",true);v.addProperty("partialPublicationAllowed",false);v.addProperty("canAuthorizePlacement",false);v.addProperty("serverBaselineVerified",false);v.addProperty("physicsVerified",false);v.addProperty("worldWrites",0);return v;
    }
    JsonObject patchSet(){var v=set(snapshotHash,selectionHash,assetHash,cellsHash,couplingPlanHash,partHashes,totalWrites);v.addProperty("patchSetHash",patchSetHash);return v;}
    public JsonObject json(){
        var v=new JsonObject();v.addProperty("format","CoupledAssemblyBinding");v.addProperty("version",1);v.addProperty("policy",AssemblyCoupledPolicy.POLICY);
        var names=List.of("captureId","jobId","worldContextHash","preparationHash","requestHash","runtimeHash","referenceSetHash","contextRecordHash","referenceBindingHash","sourceHash","currentNativeEvidenceHash","candidateHash","snapshotHash","selectionHash","assetHash","cellsHash","patchSetHash","couplingPlanHash","couplingPolicyHash","analysisHash","scheduleHash");
        var values=List.of(captureId,jobId,worldContextHash,preparationHash,requestHash,runtimeHash,referenceSetHash,contextRecordHash,referenceBindingHash,sourceHash,currentNativeEvidenceHash,candidateHash,snapshotHash,selectionHash,assetHash,cellsHash,patchSetHash,couplingPlanHash,couplingPolicyHash,analysisHash,scheduleHash);
        for(int i=0;i<names.size();i++)v.addProperty(names.get(i),values.get(i));v.add("selection",selection.json());v.addProperty("contextRevision",contextRevision);v.add("origin",origin.json());var ps=new JsonArray();partHashes.forEach(ps::add);v.add("partHashes",ps);var previews=new JsonArray();previewHashes.forEach(previews::add);v.add("previewHashes",previews);v.addProperty("totalWrites",totalWrites);
        v.addProperty("sourceAuthority","client-submitted-facts-not-server-attestation");for(String name:List.of("movable","canAuthorizePlacement","canAuthorizeModelSend","serverBaselineVerified","physicsVerified"))v.addProperty(name,false);v.addProperty("worldWrites",0);return v;
    }
    public static CoupledAssemblyBinding parse(byte[] bytes,java.util.function.BooleanSupplier cancelled){if(bytes.length>AssemblyLimits.metadataBytes())fail("Coupled binding byte quota");return parse(WorldPatchJson.parse(bytes,cancelled));}
    static CoupledAssemblyBinding parse(JsonObject v){
        WorldPatchJson.keys(v,"format","version","policy","captureId","selection","jobId","worldContextHash","preparationHash","requestHash","runtimeHash","referenceSetHash","contextRecordHash","referenceBindingHash","sourceHash","currentNativeEvidenceHash","candidateHash","contextRevision","snapshotHash","selectionHash","assetHash","cellsHash","patchSetHash","origin","partHashes","previewHashes","totalWrites","couplingPlanHash","couplingPolicyHash","analysisHash","scheduleHash","sourceAuthority","movable","canAuthorizePlacement","canAuthorizeModelSend","serverBaselineVerified","physicsVerified","worldWrites");
        eq(v,"format","CoupledAssemblyBinding");WorldPatchJson.integer(v.get("version"),1,1);eq(v,"policy",AssemblyCoupledPolicy.POLICY);eq(v,"sourceAuthority","client-submitted-facts-not-server-attestation");
        for(String key:List.of("movable","canAuthorizePlacement","canAuthorizeModelSend","serverBaselineVerified","physicsVerified")){var f=v.get(key);if(!f.isJsonPrimitive()||!f.getAsJsonPrimitive().isBoolean()||f.getAsBoolean())fail("Coupled data cannot authorize/attest");}WorldPatchJson.integer(v.get("worldWrites"),0,0);
        var s=selection(v.getAsJsonObject("selection"));var ps=new ArrayList<String>();for(var p:v.getAsJsonArray("partHashes"))ps.add(WorldPatchJson.text(p));var previews=new ArrayList<String>();for(var p:v.getAsJsonArray("previewHashes"))previews.add(WorldPatchJson.text(p));
        return new CoupledAssemblyBinding(text(v,"captureId"),s,text(v,"jobId"),text(v,"worldContextHash"),text(v,"preparationHash"),text(v,"requestHash"),text(v,"runtimeHash"),text(v,"referenceSetHash"),text(v,"contextRecordHash"),text(v,"referenceBindingHash"),text(v,"sourceHash"),text(v,"currentNativeEvidenceHash"),text(v,"candidateHash"),WorldPatchJson.integer(v.get("contextRevision"),0,9007199254740991L),text(v,"snapshotHash"),text(v,"selectionHash"),text(v,"assetHash"),text(v,"cellsHash"),text(v,"patchSetHash"),WorldPatchJson.point(v.get("origin")),ps,previews,(int)WorldPatchJson.integer(v.get("totalWrites"),1,SelectionLimits.editCells()),text(v,"couplingPlanHash"),text(v,"couplingPolicyHash"),text(v,"analysisHash"),text(v,"scheduleHash"));
    }
    private static String text(JsonObject v,String key){return WorldPatchJson.text(v.get(key));}
    private static void eq(JsonObject v,String key,String value){if(!text(v,key).equals(value))fail("Coupled binding fixed field mismatch");}
    private static SelectionRegion region(JsonObject v){WorldPatchJson.keys(v,"min","max");return new SelectionRegion(WorldPatchJson.point(v.get("min")),WorldPatchJson.point(v.get("max")));}
    private static WorldSelection selection(JsonObject v){
        WorldPatchJson.keys(v,"format","version","world","revision","context","edit","protected");eq(v,"format","WorldSelection");WorldPatchJson.integer(v.get("version"),1,1);var w=v.getAsJsonObject("world");WorldPatchJson.keys(w,"worldId","dimension","minY","maxY");
        var world=new WorldSelection.WorldIdentity(text(w,"worldId"),text(w,"dimension"),(int)WorldPatchJson.integer(w.get("minY"),-2048,2048),(int)WorldPatchJson.integer(w.get("maxY"),-2048,2048));var ps=new ArrayList<SelectionRegion>();for(var p:v.getAsJsonArray("protected"))ps.add(region(p.getAsJsonObject()));
        return new WorldSelection(world,WorldPatchJson.integer(v.get("revision"),0,9007199254740991L),region(v.getAsJsonObject("context")),region(v.getAsJsonObject("edit")),ps);
    }
}
