package dev.voxelstudio.selection;

/** Additional read-only display filter after the original server/player
 * checks. It never supplies a writer, final consent or a replacement world. */
final class WorldOperationViewScope {
    static boolean currentDimension(String original,String current){
        return original!=null&&current!=null&&original.length()<=128
            &&original.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")&&original.equals(current);
    }
    private WorldOperationViewScope(){}
}
