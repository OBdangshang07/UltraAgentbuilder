/** Versioned production SEND capability. Bridge capabilities never authorize
 * Minecraft writes; the server's independent final confirmation does that. */
export function worldPatchSendingCapabilities({preparationEnabled, sendingEnabled, runtimeHash}) {
  if (typeof preparationEnabled !== 'boolean' || typeof sendingEnabled !== 'boolean'
    || runtimeHash !== null && !/^[a-f0-9]{64}$/.test(runtimeHash)
    || sendingEnabled && (!preparationEnabled || runtimeHash === null)) {
    throw new Error('Invalid process-owned patch SEND capability');
  }
  return {
    format: 'WorldPatchCapabilities', version: 2, purpose: 'world-patch-design',
    preparationImplemented: true, reviewPreparationImplemented: true, freezePreparationImplemented: true,
    frozenTaskAuditImplemented: true, preparationEnabled,
    sendingImplemented: true, sendingEnabled, placementImplemented: false,
    maximumCalls: 1, automaticRetries: 0, jobApiVersion: 2, sendRequestVersion: 1,
    jobStatusVersion: 2, previewDownloadVersion: 1, candidateDownloadVersion: 1, runtimeHash,
    exactDataRequiresIndependentConfirmation: true, summaryConsentTransferable: false,
    sendAuthorization: 'independent-player-confirmation',
    worldWriteAuthorization: 'independent-in-game-confirmation',
    sourceAuthority: 'client-submitted-block-facts-not-a-server-signature',
    serverBaselineVerified: false, canAuthorizePlacement: false,
  };
}
