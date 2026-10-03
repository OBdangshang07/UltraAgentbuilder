import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContextTaskDisclosure, validateContextTaskIntent} from '../../bridge/world-context-task.mjs';
import {contextHash} from '../../src/world/context-snapshot.mjs';
import {WorldContextConsents} from '../../bridge/world-context-consent.mjs';
import {CONTEXT_ANALYSIS_PROTOCOL, CONTEXT_ANALYSIS_PROTOCOL_HASH} from '../../contracts/context-analysis-protocol.mjs';

const intent = () => ({format: 'WorldContextTaskIntent', version: 1, purpose: 'context-analysis',
  agent: 'codex', model: 'gpt-6.1-sol', effort: 'max', prompt: '分析道路与入口关系，明确哪些只是推断。', maximumCalls: 1});
const saved = () => {
  const summary = {snapshotHash: 'a'.repeat(64), selectionHash: 'b'.repeat(64), summaryHash: 'c'.repeat(64), canAuthorizePlacement: false};
  const record = {id: '1c316248-7002-42c7-b519-e3f0f0aaf1e3', ...summary, identity: {worldId: 'opaque-world', dimension: 'minecraft:overworld', selectionRevision: 7, contextRevision: 11},
    payloadSha256: 'd'.repeat(64), expiresAt: Date.now() + 86400000, modelSent: false};
  return {record, summary};
};
test('specific prompt/model/effort/purpose/budget and baseline are in the single exact request hash', () => {
  const data = saved(), value = intent(), before = JSON.stringify({data, value}), prepared = prepareContextTaskDisclosure(data, value);
  assert.equal(JSON.stringify({data, value}), before); assert.equal(prepared.requestHash, contextHash(prepared.request));
  assert.deepEqual(prepared.request.intent, value); assert.equal(prepared.sendingImplemented, false);
  assert.equal(prepared.modelSent, false); assert.equal(prepared.canAuthorizePlacement, false);
  assert.equal(prepared.disclosure.recipient.requestHash, prepared.requestHash);
  const registry = new WorldContextConsents(), receipt = registry.confirm(prepared.disclosure,
    {confirmed: true, disclosureHash: prepared.disclosure.disclosureHash, task: prepared.disclosure.recipient});
  assert.equal(receipt.state, 'confirmed-not-sent'); assert.equal(receipt.canAuthorizePlacement, false);
  for (const mutate of [v => v.prompt += ' ', v => v.model = 'another-model', v => v.effort = 'high', v => v.agent = 'claude']) {
    const changed = intent(); mutate(changed); const next = prepareContextTaskDisclosure(data, changed);
    assert.notEqual(next.requestHash, prepared.requestHash); assert.throws(() => registry.consume(receipt.id, next.disclosure), /changed/);
  }
  assert.deepEqual(registry.consume(receipt.id, prepared.disclosure), receipt);
});
for (const [name, mutate] of [
  ['write scope', v => v.edit = {min: [0, 0, 0], max: [100, 100, 100]}], ['command field', v => v.command = '/fill'],
  ['edit fallback', v => v.purpose = 'edit-proposal'], ['unbounded calls', v => v.maximumCalls = Infinity],
  ['extra calls', v => v.maximumCalls = 2], ['silent delegation', v => v.effort = 'ultra'],
  ['missing exact model', v => v.model = ''], ['empty prompt', v => v.prompt = '   '],
  ['oversized prompt', v => v.prompt = '字'.repeat(6001)], ['null injection', v => v.prompt += '\u0000'],
  ['bad agent', v => v.agent = 'auto'], ['wrong format', v => v.format = 'SceneSpec'],
]) test('task intent rejects ' + name + ' before any adapter is called', () => {
  const value = intent(); mutate(value); assert.throws(() => validateContextTaskIntent(value));
});
test('world/selection/environment changes bind a new disclosure, not a rebased old consent', () => {
  const base = saved(), prepared = prepareContextTaskDisclosure(base, intent());
  for (const mutate of [v => v.record.identity.worldId = 'another', v => v.record.identity.dimension = 'minecraft:the_nether',
    v => v.record.identity.selectionRevision++, v => v.record.identity.contextRevision++,
    v => { v.record.snapshotHash = 'e'.repeat(64); v.summary.snapshotHash = v.record.snapshotHash; }]) {
    const changed = structuredClone(base); mutate(changed); assert.notEqual(prepareContextTaskDisclosure(changed, intent()).requestHash, prepared.requestHash);
  }
});

test('v2 binds immutable full rules and output schema; legacy task and confirmation retain their old meaning', () => {
  const data = saved(), old = prepareContextTaskDisclosure(data, intent()), input = {...intent(), version: 2}, next = prepareContextTaskDisclosure(data, input);
  assert.equal(next.version, 2); assert.equal(next.request.version, 2); assert.notEqual(next.requestHash, old.requestHash);
  assert.equal(old.version, 1); assert.equal(Object.hasOwn(old.request, 'protocol'), false);
  assert.deepEqual(next.request.protocol, CONTEXT_ANALYSIS_PROTOCOL); assert.equal(next.request.protocolHash, CONTEXT_ANALYSIS_PROTOCOL_HASH);
  assert.equal(CONTEXT_ANALYSIS_PROTOCOL_HASH, 'e9ef250b0bbfe594fb597b8d7972821226c78f71aca9c9f26bdaef47ef8594c5');
  assert.equal(next.sendingImplemented, false); assert.equal(next.canAuthorizePlacement, false);
  assert.ok(Object.isFrozen(CONTEXT_ANALYSIS_PROTOCOL.schema.properties.observations.items));
  const registry = new WorldContextConsents(), consent = registry.confirm(old.disclosure,
    {confirmed: true, disclosureHash: old.disclosure.disclosureHash, task: old.disclosure.recipient});
  assert.throws(() => registry.consume(consent.id, next.disclosure), /changed/);
  assert.equal(registry.consume(consent.id, old.disclosure).recipient.requestHash, old.requestHash);
  const before = next.requestHash; next.request.protocol.rules += '\nChanged rule';
  assert.notEqual(contextHash(next.request), before); assert.equal(contextHash(CONTEXT_ANALYSIS_PROTOCOL), CONTEXT_ANALYSIS_PROTOCOL_HASH);
});
