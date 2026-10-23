package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;

/** Fixed new whole-plan policy, NOT a relaxation of legacy WorldPatch v1.
 * Supported targets do not acquire application, consent or replay authority. */
final class AssemblyCoupledPolicy {
    static final String POLICY="whole-native-new-special-blocks-v1";
    private static final JsonObject DATA=load();
    static final String HASH=SelectionBaseline.hash(DATA);
    private static final Set<String> FULL=fullIds();
    record State(String id,Map<String,String> properties){State{properties=Map.copyOf(properties);}}
    private static JsonObject load(){
        try(var stream=AssemblyCoupledPolicy.class.getResourceAsStream("/voxelstudio/assembly-coupling-policy.json")){
            if(stream==null)throw new IllegalStateException("Missing fixed whole coupled policy");
            var v=WorldPatchJson.parse(stream.readAllBytes(),()->false);
            WorldPatchJson.keys(v,"format","version","policy","beforePolicy","doorTargets","excludedTargetKinds","fullUpperFaceIds","partialUpperFaces","trapdoorSupport","coordinateTransform","canAuthorizePlacement");
            eq(v,"format","AssemblyCouplingPolicy");WorldPatchJson.integer(v.get("version"),1,1);eq(v,"policy",POLICY);
            eq(v,"beforePolicy","legacy-static-protection-v1");eq(v,"doorTargets","explicit-new-matching-pairs-only");
            eq(v,"trapdoorSupport","no-attachment-requirement-vanilla-1.20.1");eq(v,"coordinateTransform","translate-only-original-W-min");
            if(!v.get("excludedTargetKinds").equals(JsonParser.parseString("[\"leaves\",\"light\"]")))throw new IllegalStateException("Fixed coupled exclusions changed");
            var partial=v.getAsJsonObject("partialUpperFaces");WorldPatchJson.keys(partial,"stairs","slab");
            if(!partial.get("stairs").equals(JsonParser.parseString("[\"top\"]"))||!partial.get("slab").equals(JsonParser.parseString("[\"top\",\"double\"]")))throw new IllegalStateException("Fixed UP-face partial policy changed");
            var flag=v.get("canAuthorizePlacement");if(flag==null||!flag.isJsonPrimitive()||!flag.getAsJsonPrimitive().isBoolean()||flag.getAsBoolean())throw new IllegalStateException("Policy cannot authorize placement");
            return v;
        }catch(java.io.IOException error){throw new IllegalStateException("Cannot read fixed whole coupled policy",error);}
    }
    private static Set<String> fullIds(){
        var values=DATA.getAsJsonArray("fullUpperFaceIds");if(values==null||values.isEmpty()||values.size()>4096)throw new IllegalStateException("Fixed UP-face ID quota");
        var ids=new LinkedHashSet<String>();String previous=null;
        for(var value:values){String id=WorldPatchJson.text(value);
            if(!id.matches("minecraft:[a-z0-9_]+")||id.matches(".*_(?:door|trapdoor|leaves|slab|stairs)$")||id.equals("minecraft:light")||previous!=null&&previous.compareTo(id)>=0||!ids.add(id))throw new IllegalStateException("Noncanonical fixed UP-face ID");
            previous=id;
        }return Set.copyOf(ids);
    }
    static State target(String text){
        if(text==null||!SelectionBaseline.canonicalState(text).equals(text)||!WorldPatchStatePolicy.supported(text))throw new IllegalArgumentException("Unsupported canonical coupled target");
        var state=state(text);
        if(state.id.endsWith("_leaves")||state.id.equals("minecraft:light"))throw new IllegalArgumentException("Whole coupling leaves/light state resolution unsupported");
        return state;
    }
    static State state(String text){
        int at=text.indexOf('[');var properties=new HashMap<String,String>();
        if(at>=0)for(var field:text.substring(at+1,text.length()-1).split(",")){var pair=field.split("=",-1);if(pair.length!=2||properties.put(pair[0],pair[1])!=null)throw new IllegalArgumentException("Invalid coupled state property");}
        return new State(at<0?text:text.substring(0,at),properties);
    }
    static boolean fullUpperFace(String text){
        if(!WorldPatchStatePolicy.supported(text))return false;var s=state(text);
        return FULL.contains(s.id)||s.id.endsWith("_slab")&&Set.of("top","double").contains(s.properties.get("type"))
                ||s.id.endsWith("_stairs")&&"top".equals(s.properties.get("half"));
    }
    private static void eq(JsonObject o,String key,String text){if(!WorldPatchJson.text(o.get(key)).equals(text))throw new IllegalStateException("Fixed coupled policy mismatch");}
    private AssemblyCoupledPolicy(){}
}
