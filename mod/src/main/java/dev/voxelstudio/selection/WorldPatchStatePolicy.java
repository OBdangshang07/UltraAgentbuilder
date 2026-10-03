package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;

/** The bundled fixed policy, never a model/Bridge supplied allowlist. A static
 * match is not a physics simulation, fresh BEFORE check or write consent. */
final class WorldPatchStatePolicy {
    private static final Set<String> TERRAIN=Set.of("air","cave_air","void_air","dirt","coarse_dirt","rooted_dirt","bedrock","obsidian","crying_obsidian");
    private static final Map<String,Map<String,Set<String>>> BASE=load();
    private static Map<String,Map<String,Set<String>>> load(){
        try(var stream=WorldPatchStatePolicy.class.getResourceAsStream("/voxelstudio/world-patch-design-review-protocol.json")){
            if(stream==null)throw new IllegalStateException("Missing bundled patch policy");var v=WorldPatchJson.parse(stream.readAllBytes(),()->false);
            WorldPatchJson.keys(v,"version","rules","protocolHash","targetCatalog","baselineCatalog");WorldPatchJson.integer(v.get("version"),1,1);
            var policy=new JsonObject();policy.addProperty("version",1);policy.add("rules",v.get("rules"));if(!SelectionBaseline.hash(policy).equals(WorldPatchJson.text(v.get("protocolHash"))))throw new IllegalStateException("Bundled patch rules changed");
            var base=catalog(v.getAsJsonArray("baselineCatalog"));var targets=catalog(v.getAsJsonArray("targetCatalog"));
            var expected=new HashMap<String,Map<String,Set<String>>>();for(var item:base.entrySet())if(!restrictedId(item.getKey()))expected.put(item.getKey(),item.getValue());
            if(!expected.equals(targets))throw new IllegalStateException("Bundled patch target/base policy diverged");return base;
        }catch(java.io.IOException error){throw new IllegalStateException("Cannot read bundled patch policy",error);}
    }
    private static Map<String,Map<String,Set<String>>> catalog(JsonArray values){
        if(values==null||values.isEmpty()||values.size()>4096)throw new IllegalStateException("Invalid bundled patch catalog");var out=new HashMap<String,Map<String,Set<String>>>();
        for(var item:values){var v=item.getAsJsonObject();WorldPatchJson.keys(v,"id","properties");String id=WorldPatchJson.text(v.get("id"));if(!id.matches("minecraft:[a-z0-9_]+"))throw new IllegalStateException("Invalid catalog ID");
            var properties=new HashMap<String,Set<String>>();for(var e:v.getAsJsonObject("properties").entrySet()){var choices=new HashSet<String>();for(var choice:e.getValue().getAsJsonArray())if(!choices.add(WorldPatchJson.text(choice)))throw new IllegalStateException("Duplicate catalog value");if(choices.isEmpty())throw new IllegalStateException("Empty catalog values");properties.put(e.getKey(),Set.copyOf(choices));}
            if(out.put(id,Map.copyOf(properties))!=null)throw new IllegalStateException("Duplicate catalog ID");
        }return Map.copyOf(out);
    }
    private static String id(String state){int at=state.indexOf('[');return at<0?state:state.substring(0,at);}
    private static boolean restrictedId(String id){return id.endsWith("_door")||id.endsWith("_trapdoor")||id.endsWith("_leaves")||id.equals("minecraft:light");}
    static boolean supported(String state){
        var properties=new HashMap<String,String>();int at=state.indexOf('[');if(at>=0)for(var part:state.substring(at+1,state.length()-1).split(",")){var p=part.split("=",-1);if(p.length!=2||properties.put(p[0],p[1])!=null)return false;}
        var base=BASE.get(id(state));if(base==null||!base.keySet().equals(properties.keySet()))return false;
        for(var e:properties.entrySet())if(!base.get(e.getKey()).contains(e.getValue()))return false;return true;
    }
    static void requireStatic(String state){if(WorldPatchPreview.air(state))return;if(!supported(state)||restrictedId(id(state)))throw new IllegalArgumentException("Unsupported static patch state: "+state);}
    static String protection(SelectionScan.BlockFact fact){
        if(fact==null)return "unknown";String state=fact.state();if(fact.blockEntity())return "block-entity";
        if(!state.startsWith("minecraft:"))return "unclassified-mod-block";
        if(id(state).equals("minecraft:water")||id(state).equals("minecraft:lava")||state.matches(".*\\bwaterlogged=true\\b.*"))return "dynamic-state";
        if(id(state).endsWith("_door")||id(state).endsWith("_bed"))return "coupled-block";
        if(TERRAIN.contains(state.substring(10)))return null;return supported(state)?null:"unclassified-vanilla-state";
    }
    static void requireNeighbor(SelectionScan.BlockFact fact){
        String reason=protection(fact);if(reason!=null)throw new IllegalArgumentException("Unsafe patch neighbor: "+reason);requireStatic(fact.state());
        if(id(fact.state()).endsWith("_stairs"))throw new IllegalArgumentException("Adjacent stair shape updates are unverified");
    }
    private WorldPatchStatePolicy(){}
}
