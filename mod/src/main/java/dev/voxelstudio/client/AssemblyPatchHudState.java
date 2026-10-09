package dev.voxelstudio.client;

import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

/** Read-only display of operations already accepted in this client lifetime.
 * No queries, disk recovery, confirmation, cancellation or writer capability. */
final class AssemblyPatchHudState {
    record Progress(String title,String counts,String reason){}
    record View(String operationId,Progress apply,Progress undo){
        boolean worldDurabilityVerified(){return false;}
        boolean canAuthorizePlacement(){return false;}
    }
    private Object owner;private UUID player;private String dimension,operationId;
    private long epoch;private boolean closed;
    private Supplier<Progress> apply,undo;
    void scope(Object next,UUID user,String dim){
        if(closed)return;
        if(next!=owner||!Objects.equals(user,player)||!Objects.equals(dim,dimension)){
            epoch++;owner=next;player=user;dimension=dim;operationId=null;apply=undo=null;
        }
    }
    long ticket(){return epoch;}
    private boolean current(long ticket){return !closed&&ticket==epoch&&owner!=null&&player!=null&&dimension!=null;}
    boolean showApply(long ticket,String id,Supplier<Progress> progress){
        if(!current(ticket))return false;
        Objects.requireNonNull(id);Objects.requireNonNull(progress);
        operationId=id;apply=progress;undo=null;return true;
    }
    boolean showUndo(long ticket,String parentId,Supplier<Progress> progress){
        if(!current(ticket)||apply==null||!Objects.equals(parentId,operationId))return false;
        undo=Objects.requireNonNull(progress);return true;
    }
    boolean hasProgress(){return !closed&&apply!=null;}
    View view(){return hasProgress()?new View(operationId,apply.get(),undo==null?null:undo.get()):null;}
    void close(){epoch++;closed=true;owner=null;player=null;dimension=null;operationId=null;apply=undo=null;}
}
