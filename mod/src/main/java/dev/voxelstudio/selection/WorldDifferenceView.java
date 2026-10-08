package dev.voxelstudio.selection;

import java.util.List;

/** Sparse read-only geometry shared by legacy and whole renderers. No
 * candidate binding, SEND, server report, final confirmation or writer is
 * exposed through this interface. A whole set never becomes a v1 candidate. */
public interface WorldDifferenceView {
    WorldSelection selection();
    List<WorldPatchPreview.Section> sections();
    List<String> palette();
    WorldPatchPreview.Row at(SelectionRegion.Point point);
    WorldPatchPreview.Filter checked(WorldPatchPreview.Filter filter);
}
