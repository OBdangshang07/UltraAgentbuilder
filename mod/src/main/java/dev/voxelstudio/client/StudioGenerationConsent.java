package dev.voxelstudio.client;

import com.google.gson.JsonObject;

/** Exact current request, not a subset of settings or consent from another job. */
final class StudioGenerationConsent {
    static boolean matches(JsonObject confirmed,JsonObject current,String world,String currentWorld,boolean idle){
        if(!idle||world==null||!world.equals(currentWorld)||confirmed==null||current==null)return false;
        var original=confirmed.deepCopy();var now=current.deepCopy();
        // These flags are added only after the exact request's consent. No
        // model, effort, scope, image permission or budget field is ignored.
        for(var key:new String[]{"assemblyConfirmed","checkpointConfirmed"}){original.remove(key);now.remove(key);}
        return original.equals(now);
    }
    private StudioGenerationConsent(){}
}
