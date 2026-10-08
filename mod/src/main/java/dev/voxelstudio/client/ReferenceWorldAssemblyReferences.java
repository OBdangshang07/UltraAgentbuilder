package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

/** Full v2 originals have their own disk lane, never one-call joint consent. */
final class ReferenceWorldAssemblyReferences {
    private final PatchReferenceStore store;
    ReferenceWorldAssemblyReferences(Path data){store=new PatchReferenceStore(data,PatchReferenceStore.Lane.ASSEMBLY);}
    boolean claim(JsonObject input)throws IOException{return store.claim(input);}
    JsonObject read(String preparationHash)throws IOException{return store.read(preparationHash);}
    List<JsonObject> list()throws IOException{return store.list();}
}
