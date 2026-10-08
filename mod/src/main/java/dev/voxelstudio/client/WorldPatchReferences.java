package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

/** Immutable local references for future explicit sends and receipt queries.
 * No adapter, submit, retry, world or permission API. A reference is NOT a
 * reservation/consent. Never delete history or adopt incomplete pending files. */
final class WorldPatchReferences {
    private final PatchReferenceStore store;
    WorldPatchReferences(Path data){store=new PatchReferenceStore(data,PatchReferenceStore.Lane.TEXT);}
    JsonObject remember(JsonObject input)throws IOException{return store.remember(input);}
    /** A saved reference suppresses every later submit, including after a
     * restart or a local/HTTP failure. Absence of a server receipt is not
     * evidence that a model call can safely be repeated. */
    boolean claim(JsonObject input)throws IOException{return store.claim(input);}
    JsonObject read(String id)throws IOException{return store.read(id);}
    List<JsonObject> list()throws IOException{return store.list();}
}
