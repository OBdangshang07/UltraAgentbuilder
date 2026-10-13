// Developer inspection uses the SAME bounded native process implementation as
// the packaged Bridge. This wrapper is not an independent second verifier.
// Legacy v1 compatibility is tested against a separately authored CIM control.
export {
  validateWindowsOwnerObservation,
  validateWorldPatchOwnerReference,
  compareWorldPatchOwnerProcess,
  observeWindowsOwnerProcess,
  createWorldPatchOwnerReference,
  inspectWorldPatchOwnerProcess,
} from '../bridge/world-patch-owner-observation.mjs';
