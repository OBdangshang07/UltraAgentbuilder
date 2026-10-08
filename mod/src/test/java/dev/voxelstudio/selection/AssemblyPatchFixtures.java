package dev.voxelstudio.selection;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic production artifacts only. Never a player Capture or consent. */
final class AssemblyPatchFixtures {
    static List<JsonObject> headers()throws Exception{
        try(var reader=Files.newBufferedReader(Path.of("build/test-fixtures/reference-world-assembly-candidate-headers.json"))){
            return JsonParser.parseReader(reader).getAsJsonArray().asList().stream().map(JsonElement::getAsJsonObject).toList();
        }
    }
    static JsonObject header(String tier)throws Exception{return headers().stream().filter(f->f.get("tier").getAsString().equals(tier)).findFirst().orElseThrow();}
    static byte[] bytes(JsonElement value){return value.toString().getBytes(StandardCharsets.UTF_8);}
    static SelectionRegion.Point point(JsonArray value){return new SelectionRegion.Point(value.get(0).getAsInt(),value.get(1).getAsInt(),value.get(2).getAsInt());}
    private static SelectionRegion region(JsonObject value){return new SelectionRegion(point(value.getAsJsonArray("min")),point(value.getAsJsonArray("max")));}
    static WorldSelection selection(JsonObject f){
        var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var protectedRegions=new ArrayList<SelectionRegion>();
        s.getAsJsonArray("protected").forEach(v->protectedRegions.add(region(v.getAsJsonObject())));
        return new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),
                s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),protectedRegions);
    }
    static SelectionBaseline baseline(JsonObject f){return SelectionBaseline.fromSealedCapture(selection(f),JsonParser.parseString(f.get("payload").getAsString()).getAsJsonObject().getAsJsonObject("capture"));}
    static JsonObject part(JsonObject f,int index)throws Exception{
        var pin=f.getAsJsonArray("partFiles").get(index).getAsJsonObject();String name="reference-world-assembly-candidate-"+f.get("tier").getAsString()+"-"+index+".json";
        assertEquals(name,pin.get("path").getAsString());byte[] bytes=Files.readAllBytes(Path.of("build/test-fixtures").resolve(name));
        assertEquals(pin.get("bytes").getAsLong(),bytes.length);assertEquals(pin.get("sha256").getAsString(),dev.voxelstudio.Asset.sha(bytes));
        return WorldPatchJson.parse(bytes,()->false);
    }
    static String text(JsonObject value,String key){return value.get(key).getAsString();}
    static AssemblyPatchBinding binding(JsonObject f){
        var c=f.getAsJsonObject("metadata").getAsJsonObject("candidate");var p=f.getAsJsonObject("prepared");var s=f.getAsJsonObject("metadata").getAsJsonObject("patchSet");
        var hashes=s.getAsJsonArray("partHashes").asList().stream().map(JsonElement::getAsString).toList();
        var previews=c.getAsJsonArray("previewHashes").asList().stream().map(JsonElement::getAsString).toList();
        return new AssemblyPatchBinding(text(f,"contextId"),selection(f),f.get("contextRevision").getAsLong(),text(c,"snapshotHash"),text(c,"selectionHash"),text(c,"worldContextHash"),text(c,"jobId"),
                text(c,"preparationHash"),text(f.getAsJsonObject("status"),"requestHash"),text(c,"runtimeHash"),text(c,"referenceSetHash"),text(p,"recordHash"),text(c,"referenceBindingHash"),text(c,"sourceHash"),text(c,"currentNativeEvidenceHash"),
                text(c,"assetHash"),text(c,"cellsHash"),text(c,"candidateHash"),text(c,"patchSetHash"),point(c.getAsJsonArray("origin")),hashes,previews,c.get("operationCount").getAsInt());
    }
    static AssemblyPatchInput.Part transport(JsonObject f,int index,JsonObject envelope){
        var original=binding(f);var patch=envelope.getAsJsonObject("patch");var preview=envelope.getAsJsonObject("preview");
        var pin=new WorldPatchPreview.Binding(original.selection(),original.contextRevision(),original.snapshotHash(),original.selectionHash(),text(patch,"patchHash"),text(preview,"previewHash"));
        return new AssemblyPatchInput.Part(index,bytes(patch.get("proposal")),bytes(patch),WorldPatchPreview.parse(bytes(preview),pin));
    }
    static AssemblyPatchInput input(JsonObject f)throws Exception{
        assertEquals(0,f.get("realModelCalls").getAsInt());assertEquals(0,f.get("worldWrites").getAsInt());
        var binding=binding(f);assertEquals(binding.partHashes().size(),f.getAsJsonArray("partFiles").size());
        var parts=new ArrayList<AssemblyPatchInput.Part>();for(int i=0;i<binding.partHashes().size();i++)parts.add(transport(f,i,part(f,i)));
        return new AssemblyPatchInput(binding,parts);
    }
    /** Attacker may recompute every transport digest. Independent server facts
     * and reconstruction must still reject the changed content. */
    static AssemblyPatchInput changedLite(JsonObject f,JsonObject envelope){
        var patch=envelope.getAsJsonObject("patch");patch.remove("patchHash");patch.addProperty("patchHash",SelectionBaseline.hash(patch));
        var preview=envelope.getAsJsonObject("preview");preview.addProperty("patchHash",text(patch,"patchHash"));preview.remove("previewHash");preview.addProperty("previewHash",SelectionBaseline.hash(preview));
        var changed=f.deepCopy();var c=changed.getAsJsonObject("metadata").getAsJsonObject("candidate");var set=changed.getAsJsonObject("metadata").getAsJsonObject("patchSet");
        set.getAsJsonArray("partHashes").set(0,patch.get("patchHash"));set.remove("patchSetHash");set.addProperty("patchSetHash",SelectionBaseline.hash(set));
        c.add("patchSetHash",set.get("patchSetHash"));c.getAsJsonArray("previewHashes").set(0,preview.get("previewHash"));c.remove("candidateHash");c.addProperty("candidateHash",SelectionBaseline.hash(c));
        return new AssemblyPatchInput(binding(changed),List.of(transport(changed,0,envelope)));
    }
    private AssemblyPatchFixtures(){}
}
