package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

/** Independent durable joint SEND references, not legacy history/consent.
 * Once saved, later attempts only query that exact original, including after
 * a lost HTTP reply or restart. A reference grants no world-write authority. */
final class ReferenceWorldPatchReferences {
    private final PatchReferenceStore store;
    ReferenceWorldPatchReferences(Path data){store=new PatchReferenceStore(data,PatchReferenceStore.Lane.REFERENCE);}
    JsonObject remember(JsonObject input)throws IOException{return store.remember(input);}
    boolean claim(JsonObject input)throws IOException{return store.claim(input);}
    JsonObject read(String id)throws IOException{return store.read(id);}
    List<JsonObject> list()throws IOException{return store.list();}
}
