package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import dev.voxelstudio.selection.*;
import java.util.*;

/** Client display match only. Never refreshes a snapshot, looks up an archive
 * to recreate server authority or turns matching hashes into a write lease. */
final class AssemblyPatchContextMatch {
    private static boolean same(WorldSelection current,String capture,JsonObject saved,WorldSelection original,String originalCapture,long revision,String snapshot,String selection,String recordHash){
        try{
            if(current==null||capture==null||saved==null||!current.equals(original)||!capture.equals(originalCapture))return false;
            var record=saved.getAsJsonObject("record");var identity=record.getAsJsonObject("identity");
            return identity.get("contextRevision").getAsLong()==revision&&record.get("snapshotHash").getAsString().equals(snapshot)
                &&record.get("selectionHash").getAsString().equals(selection)&&record.get("recordHash").getAsString().equals(recordHash);
        }catch(RuntimeException incomplete){return false;}
    }
    static boolean matches(WorldSelection current,String capture,JsonObject saved,AssemblyPatchBinding binding){
        Objects.requireNonNull(binding);return same(current,capture,saved,binding.selection(),binding.captureId(),binding.contextRevision(),binding.snapshotHash(),binding.selectionHash(),binding.contextRecordHash());
    }
    static boolean reference(WorldSelection current,String capture,JsonObject saved,JsonObject original){
        try{var p=original.getAsJsonObject("prepared");return same(current,capture,saved,WorldPatchJobReceipt.selection(original.getAsJsonObject("selection")),p.get("contextId").getAsString(),original.get("contextRevision").getAsLong(),p.get("snapshotHash").getAsString(),p.get("selectionHash").getAsString(),p.get("recordHash").getAsString());}
        catch(RuntimeException incomplete){return false;}
    }
    private AssemblyPatchContextMatch(){}
}
