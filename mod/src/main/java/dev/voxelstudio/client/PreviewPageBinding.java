package dev.voxelstudio.client;

import java.util.function.Consumer;

/** A displayed object is not replaceable by a later controller value. This
 * fence is checked at click time as well as layout; it grants no world consent. */
final class PreviewPageBinding<T> {
    private final T shown;
    private boolean live=true;
    PreviewPageBinding(T shown){this.shown=shown;}
    boolean current(T actual,boolean snapshotCurrent){return live&&shown!=null&&actual==shown&&snapshotCurrent;}
    boolean dispatch(T actual,boolean snapshotCurrent,Consumer<T> action){
        if(!current(actual,snapshotCurrent))return false;
        action.accept(shown);return true;
    }
    void leave(){live=false;}
}
