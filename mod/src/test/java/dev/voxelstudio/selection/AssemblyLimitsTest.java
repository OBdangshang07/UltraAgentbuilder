package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class AssemblyLimitsTest {
    private static JsonObject original()throws IOException{try(var in=AssemblyLimits.class.getResourceAsStream("/voxelstudio-bundle/contracts/world-assembly-limits.json")){
        assertNotNull(in);return JsonParser.parseReader(new InputStreamReader(in,StandardCharsets.UTF_8)).getAsJsonObject();}}
    @Test void exactSharedQuotasRetainIndependentSmallWorkingAndMemberBounds(){
        long mib=1024L*1024;assertEquals(192*mib,AssemblyLimits.patchBytes());assertEquals(224*mib,AssemblyLimits.candidateBytes());assertEquals(256*mib,AssemblyLimits.downloadBytes());
        assertEquals(64*mib,AssemblyLimits.proposalBytes());assertEquals(64*mib,AssemblyLimits.previewBytes());assertEquals(16*mib,AssemblyLimits.partBytes());
        assertEquals(40*mib,AssemblyLimits.partEnvelopeBytes());assertEquals(2*mib,AssemblyLimits.metadataBytes());assertEquals(2*mib,AssemblyLimits.recordsBytes());
        assertEquals(8192,AssemblyLimits.operationsPerPart());assertEquals(128,SelectionLimits.assemblyParts());assertEquals(AssemblyLimits.patchBytes(),AssemblyPatchInput.PATCH_BYTES);
    }
    @Test void noExtraAuthorityMissingFieldOrDifferentVersionCanBecomePolicy()throws Exception{
        for(String key:List.of("canAuthorizePlacement","maxTokens","unlimited","model")){var v=original();v.addProperty(key,true);assertThrows(RuntimeException.class,()->AssemblyLimits.validate(v));}
        for(String key:original().keySet()){var v=original();v.remove(key);assertThrows(RuntimeException.class,()->AssemblyLimits.validate(v));}
        var changed=original();changed.addProperty("version",2);assertThrows(RuntimeException.class,()->AssemblyLimits.validate(changed));
    }
    @Test void invalidIntegerAndUnboundedResourceInputsFailClosed()throws Exception{
        for(String key:original().keySet()){
            for(JsonElement value:List.of(new JsonPrimitive(0),new JsonPrimitive(-1),new JsonPrimitive(0.5),new JsonPrimitive("1"),JsonNull.INSTANCE)){
                var v=original();v.add(key,value);assertThrows(RuntimeException.class,()->AssemblyLimits.validate(v));}
        }
        long mib=1024L*1024;Map<String,Long> oversized=Map.of("patchBytes",257*mib,"candidateBytes",321*mib,"downloadBytes",385*mib,"proposalBytes",65*mib,
                "previewBytes",65*mib,"partBytes",17*mib,"partEnvelopeBytes",41*mib,"metadataBytes",3*mib,"recordsBytes",3*mib,"operationsPerPart",8193L);
        for(var entry:oversized.entrySet()){var v=original();v.addProperty(entry.getKey(),entry.getValue());assertThrows(RuntimeException.class,()->AssemblyLimits.validate(v));}
    }
    @Test void incoherentBudgetOrderAndMutableReturnCannotBroadenLimits()throws Exception{
        long mib=1024L*1024;for(var entry:Map.of("candidateBytes",191*mib,"downloadBytes",223*mib,"partEnvelopeBytes",15*mib).entrySet()){
            var v=original();v.addProperty(entry.getKey(),entry.getValue());assertThrows(RuntimeException.class,()->AssemblyLimits.validate(v));}
        var data=AssemblyLimits.validate(original());assertThrows(UnsupportedOperationException.class,()->data.put("patchBytes",Long.MAX_VALUE));
    }
}
