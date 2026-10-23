package dev.voxelstudio.selection;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Authored synthetic native transport only; not paid model, game or consent. */
final class CoupledAssemblyTestFixtures {
    private static JsonObject fixtures;
    static JsonObject fixture(String name)throws Exception{
        if(fixtures==null)fixtures=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/assembly-coupled-transport.json"))).getAsJsonObject();
        for(var e:fixtures.getAsJsonArray("cases"))if(e.getAsJsonObject().get("name").getAsString().equals(name))return e.getAsJsonObject().deepCopy();throw new AssertionError(name);
    }
    static byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    static CoupledAssemblyInput input(JsonObject f){
        var b=CoupledAssemblyBinding.parse(f.getAsJsonObject("binding"));var parts=new ArrayList<CoupledAssemblyInput.Part>();
        for(int i=0;i<f.getAsJsonArray("parts").size();i++)parts.add(new CoupledAssemblyInput.Part(b,i,bytes(f.getAsJsonArray("parts").get(i)),bytes(f.getAsJsonArray("previews").get(i))));
        return new CoupledAssemblyInput(b,bytes(f.get("manifest")),Base64.getDecoder().decode(f.get("cellsBase64").getAsString()),bytes(f.get("plan")),parts);
    }
    static SelectionReadService.Capture capture(JsonObject f,CoupledAssemblyInput input){
        var payload=new JsonObject();payload.add("selection",f.get("selection"));payload.add("capture",f.get("capture"));var b=input.binding();
        return new SelectionReadService.Capture(b.captureId(),b.selection(),b.contextRevision(),payload.toString(),null,false);
    }
    static CoupledAssemblyJournal.Plan plan(String name)throws Exception{var f=fixture(name);var input=input(f);return CoupledAssemblyJournal.prepare(capture(f,input),input,UUID.randomUUID(),()->false);}
    private CoupledAssemblyTestFixtures(){}
}
