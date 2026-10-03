package dev.voxelstudio.client;

import java.util.Set;

/** Exact dialog acknowledgement state. Resize never carries purge consent;
 * submission is one-shot even if a disabled widget's callback is invoked. */
final class ReferenceArchiveConfirmation {
    private final boolean purge;
    private boolean deletion,copies,submitted;
    ReferenceArchiveConfirmation(String purpose){if(!Set.of("archive","restore","purge").contains(purpose))throw new IllegalArgumentException("Unknown storage purpose");purge=purpose.equals("purge");}
    boolean purge(){return purge;}
    boolean deletion(){return deletion;}
    boolean copies(){return copies;}
    boolean submitted(){return submitted;}
    void resize(){deletion=copies=false;}
    void toggleDeletion(){if(!submitted)deletion=!deletion;}
    void toggleCopies(){if(!submitted)copies=!copies;}
    boolean ready(){return !submitted&&(!purge||deletion&&copies);}
    boolean submit(){if(!ready())return false;submitted=true;return true;}
}
