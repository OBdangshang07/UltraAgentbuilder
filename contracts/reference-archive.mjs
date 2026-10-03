import assert from 'node:assert/strict';
import {REFERENCE_OWNER} from './reference-attachments.mjs';

export const REFERENCE_ARCHIVE_LIMITS=Object.freeze({inputBytes:4096,actions:256,filesPerDraft:36,bytesPerDraft:134217728,receiptBytes:131072,maintenancePerArchive:1});
export const REFERENCE_ARCHIVE_OPERATIONS=Object.freeze(['archive-list','archive-snapshot','archive-confirm','archive-get','archive-record']);
export const REFERENCE_ARCHIVE_MAINTENANCE_OPERATIONS=Object.freeze(['archive-restore-snapshot','archive-restore-confirm','archive-purge-snapshot','archive-purge-confirm','archive-maintenance-get']);
export function referenceArchiveCapabilities(){
  return {format:'ReferenceDraftArchiveCapabilities',version:3,implemented:true,
    originalRecordVersion:1,originalRecordReadOnly:true,
    explicitExactConfirmation:true,stableActionRecovery:true,storage:'same-volume-preserving-move',
    freesActiveDraftQuota:true,permanentDeletionImplemented:true,restoreImplemented:true,
    maintenanceVersion:1,permanentDeletionScope:'exact-archived-draft-files-only',jobOriginalsAndAuditRetained:true,
    restoreTransfersGenerationAuthority:false,
    submittedOwnersRequireOriginalTerminalReceipts:true,unknownOutcomesProtected:true,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false,limits:{...REFERENCE_ARCHIVE_LIMITS}};
}
export function referenceArchiveConfirmation(value,ownerId){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Explicit archive confirmation required');
  assert.deepEqual(Object.keys(value).sort(),['format','version','action','actionId','ownerId','snapshotHash','accepted'].sort());
  assert.equal(value.format,'ReferenceDraftArchiveConfirmation');assert.equal(value.version,1);
  assert.equal(value.action,'archive-reference-draft');assert.match(value.actionId,REFERENCE_OWNER);
  assert.match(ownerId,REFERENCE_OWNER);assert.equal(value.ownerId,ownerId);
  assert.match(value.snapshotHash,/^[a-f0-9]{64}$/);assert.equal(value.accepted,true);
  return value;
}
export function referenceArchiveMaintenanceConfirmation(value,ownerId,archiveActionId,purpose){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Independent archive maintenance confirmation required');
  assert.ok(['restore','purge'].includes(purpose));
  assert.deepEqual(Object.keys(value).sort(),['format','version','action','actionId','archiveActionId','ownerId','snapshotHash','accepted',
    ...(purpose==='purge'?['permanentDeletionAccepted','retainedCopiesAcknowledged']:[])].sort());
  assert.equal(value.format,'ReferenceArchiveMaintenanceConfirmation');assert.equal(value.version,1);
  assert.equal(value.action,purpose==='purge'?'permanently-purge-archived-reference':'restore-archived-reference');
  for(const id of [value.actionId,ownerId,archiveActionId])assert.match(id,REFERENCE_OWNER);
  assert.equal(value.ownerId,ownerId);assert.equal(value.archiveActionId,archiveActionId);assert.notEqual(value.actionId,archiveActionId);
  assert.match(value.snapshotHash,/^[a-f0-9]{64}$/);assert.equal(value.accepted,true);
  if(purpose==='purge'){assert.equal(value.permanentDeletionAccepted,true);assert.equal(value.retainedCopiesAcknowledged,true);}
  return value;
}
