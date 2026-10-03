import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';

const digest = /^[a-f0-9]{64}$/;
function taskBinding(task) {
  exactKeys(task, ['agent', 'model', 'requestHash'], 'context task binding');
  if (!['codex', 'claude', 'deepseek'].includes(task.agent) || typeof task.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(task.model) || !digest.test(task.requestHash)) throw new Error('Invalid exact context recipient/request binding');
  return {...task};
}
export function contextDisclosure({record, summary}, task) {
  if (record.modelSent !== false || record.canAuthorizePlacement !== false || summary.canAuthorizePlacement !== false
      || summary.snapshotHash !== record.snapshotHash || summary.summaryHash !== record.summaryHash || summary.selectionHash !== record.selectionHash) throw new Error('Context disclosure identity mismatch');
  const content = {format: 'WorldContextDisclosure', version: 1, contextId: record.id, payloadSha256: record.payloadSha256,
    snapshotHash: record.snapshotHash, summaryHash: record.summaryHash, selectionHash: record.selectionHash,
    identity: record.identity, recordExpiresAt: record.expiresAt, recipient: taskBinding(task), summary,
    disclosedData: ['absolute-context-edit-protection-coordinates', 'block-state-material-counts', 'known-unknown-coverage', 'bounded-observed-height-LOD', 'opaque-session-identity-and-revisions'],
    excludedData: ['NBT', 'container-items', 'sign-book-text', 'entities', 'save-paths', 'precise-per-cell-baseline', 'screenshots'],
    sourceAuthority: 'client-submitted-block-facts-not-a-server-signature', modelSent: false, canAuthorizePlacement: false};
  return {...content, disclosureHash: contextHash(content)};
}

/** Ephemeral explicit approval for ONE exact request, not world authority.
 * P3 creates/inspects consent only. No adapter, job or send API is called. */
export class WorldContextConsents {
  constructor() { this.receipts = new Map(); }
  prune() { for (const [id, receipt] of this.receipts) if (receipt.expiresAt <= Date.now()) this.receipts.delete(id); }
  confirm(disclosure, input) {
    exactKeys(input, ['confirmed', 'disclosureHash', 'task'], 'context disclosure confirmation');
    if (input.confirmed !== true || input.disclosureHash !== disclosure.disclosureHash || contextHash(taskBinding(input.task)) !== contextHash(disclosure.recipient)) throw new Error('Explicit confirmation no longer matches snapshot, recipient or request');
    this.prune(); if (this.receipts.size >= 32) throw new Error('Context confirmation quota reached');
    const now = Date.now();
    const receipt = {format: 'WorldContextConsent', version: 1, id: randomUUID(), contextId: disclosure.contextId,
      disclosureHash: disclosure.disclosureHash, snapshotHash: disclosure.snapshotHash, summaryHash: disclosure.summaryHash,
      selectionHash: disclosure.selectionHash, recipient: disclosure.recipient, createdAt: now,
      expiresAt: Math.min(now + 300000, disclosure.recordExpiresAt),
      state: 'confirmed-not-sent', modelSent: false, canAuthorizePlacement: false};
    if (!Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now()) throw new Error('Context record expired; confirmation not saved');
    this.receipts.set(receipt.id, structuredClone(receipt)); return receipt;
  }
  consume(id, disclosure) {
    this.prune(); const receipt = this.receipts.get(id);
    if (!receipt || receipt.disclosureHash !== disclosure.disclosureHash || receipt.contextId !== disclosure.contextId
        || contextHash(receipt.recipient) !== contextHash(disclosure.recipient)) throw new Error('Context confirmation missing, expired, consumed or changed');
    this.receipts.delete(id); return structuredClone(receipt);
  }
  revoke(contextId) { for (const [id, receipt] of this.receipts) if (receipt.contextId === contextId) this.receipts.delete(id); }
  close() { this.receipts.clear(); }
}
