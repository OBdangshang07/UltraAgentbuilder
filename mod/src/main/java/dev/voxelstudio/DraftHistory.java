package dev.voxelstudio;

import java.util.ArrayDeque;

/** Small client-draft history, deliberately unrelated to world-edit journals. */
public final class DraftHistory {
    public record Transform(int x,int y,int z,int rotation,boolean mirror) {}
    private final ArrayDeque<Transform> undo=new ArrayDeque<>(),redo=new ArrayDeque<>();
    public void remember(Transform before,Transform after){if(before.equals(after))return;if(undo.size()==32)undo.removeFirst();undo.addLast(before);redo.clear();}
    public boolean canUndo(){return !undo.isEmpty();}
    public boolean canRedo(){return !redo.isEmpty();}
    public Transform undo(Transform current){if(undo.isEmpty())return current;redo.addLast(current);return undo.removeLast();}
    public Transform redo(Transform current){if(redo.isEmpty())return current;undo.addLast(current);return redo.removeLast();}
    public void clear(){undo.clear();redo.clear();}
}
