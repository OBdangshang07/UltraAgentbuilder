package dev.voxelstudio.selection;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Fixed bundled resource quotas shared with Bridge, never model overrides,
 * token budgets, per-part placement authority or an unlimited scene policy. */
public final class AssemblyLimits {
    private static final Set<String> FIELDS=Set.of("version","operationsPerPart","patchBytes","proposalBytes","previewBytes",
            "candidateBytes","downloadBytes","partBytes","partEnvelopeBytes","metadataBytes","recordsBytes");
    private static final Map<String,Long> DATA=load();
    static Map<String,Long> validate(JsonObject value){
        if(value==null||!value.keySet().equals(FIELDS))throw new IllegalArgumentException("Invalid assembly quota keys");
        var result=new HashMap<String,Long>();
        for(String key:FIELDS){var v=value.get(key);if(!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("Integer assembly quotas required");
            long number=v.getAsBigDecimal().longValueExact();if(number<1)throw new IllegalArgumentException("Positive assembly quotas required");result.put(key,number);}
        long mib=1024L*1024;
        if(result.get("version")!=1||result.get("operationsPerPart")!=8192
                ||result.get("patchBytes")>256*mib||result.get("candidateBytes")>320*mib||result.get("downloadBytes")>384*mib
                ||result.get("proposalBytes")>64*mib||result.get("previewBytes")>64*mib||result.get("partBytes")>16*mib
                ||result.get("partEnvelopeBytes")>40*mib||result.get("metadataBytes")>2*mib||result.get("recordsBytes")>2*mib
                ||result.get("patchBytes")<result.get("partBytes")||result.get("candidateBytes")<result.get("patchBytes")
                ||result.get("downloadBytes")<result.get("candidateBytes")||result.get("partEnvelopeBytes")<result.get("partBytes")
                ||result.get("proposalBytes")<result.get("partBytes")||result.get("previewBytes")<result.get("partBytes"))throw new IllegalArgumentException("Invalid bounded assembly quotas");
        return Map.copyOf(result);
    }
    private static Map<String,Long> load(){try(var in=AssemblyLimits.class.getResourceAsStream("/voxelstudio-bundle/contracts/world-assembly-limits.json")){
        if(in==null)throw new IOException("Missing shared assembly contract");return validate(JsonParser.parseReader(new InputStreamReader(in,StandardCharsets.UTF_8)).getAsJsonObject());
    }catch(Exception error){throw new IllegalStateException("Cannot load assembly contract; no full candidate authorized",error);}}
    public static int operationsPerPart(){return Math.toIntExact(DATA.get("operationsPerPart"));}
    public static long patchBytes(){return DATA.get("patchBytes");}public static long proposalBytes(){return DATA.get("proposalBytes");}
    public static long previewBytes(){return DATA.get("previewBytes");}public static long candidateBytes(){return DATA.get("candidateBytes");}
    public static long downloadBytes(){return DATA.get("downloadBytes");}public static int partBytes(){return Math.toIntExact(DATA.get("partBytes"));}
    public static int partEnvelopeBytes(){return Math.toIntExact(DATA.get("partEnvelopeBytes"));}public static int metadataBytes(){return Math.toIntExact(DATA.get("metadataBytes"));}
    public static int recordsBytes(){return Math.toIntExact(DATA.get("recordsBytes"));}
    private AssemblyLimits(){}
}
