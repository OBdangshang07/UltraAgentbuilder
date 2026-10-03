/** Fixture status alone cannot override an unhandled Minecraft client task.
 * Keep original failed receipts; rerun only with a new isolated world. */
export function assertHealthySelectionClientLog(text) {
  if (typeof text !== 'string' || /Error executing task on Client|VOXEL_(?:STUDIO_)?SELECTION_TEST FAILED/.test(text)) {
    throw new Error('Client callback failure invalidates an otherwise passed fixture receipt');
  }
}
