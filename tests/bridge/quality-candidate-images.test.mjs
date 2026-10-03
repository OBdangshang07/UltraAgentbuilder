import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan} from '../design/assembly-fixtures.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {nativeViewsForScene} from '../../src/design/quality-prototypes.mjs';
import {requestNativeEvidence, acceptNativeEvidence} from '../../bridge/native-evidence.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {inspectQualityCandidateImages} from '../../scripts/quality-stage-images.mjs';

test('independent candidate inspection binds source/cells/original pixels before selection; synthetic evidence only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxel-candidate-inspection-'));
  const project = fileURLToPath(new URL('../../', import.meta.url)), frozen = await freezeSceneRuntime(project, path.join(root, 'runtimes'));
  const directory = path.join(root, 'data', 'jobs', 'offline-concept'), stageDir = path.join(directory, 'assembly', '1');
  const candidateDir = path.join(stageDir, 'concept-1'), diagnostic = path.join(candidateDir, 'diagnostic');
  await fs.mkdir(candidateDir, {recursive: true}); const scene = assemblyPlan().scene;
  const signal = new AbortController().signal, feedback = await inspectCheckpoint(scene, {navigationPolicy: 'review'}, diagnostic, signal);
  assert.equal(feedback.geometryPassed, true, feedback.error);
  const capture = await requestNativeEvidence({jobDirectory: directory, bundleDirectory: diagnostic,
    sourceHash: hash(scene), assetHash: feedback.diagnosticAssetHash, views: nativeViewsForScene(scene, 'ultra'), signal,
    onWaiting: async status => { if (status.state === 'waiting') await acceptNativeEvidence(directory, status.id, fixtureUpload(status.request)); }});
  const input = {candidateId: 'concept-1', decompositionStageId: 'concept-1'};
  const response = {format: 'SceneConceptSet', version: 1, candidates: [{id: 'concept-1', scene}]};
  const result = {accepted: true, candidateSetHash: hash(response), candidates: [{id: 'concept-1', eligible: true,
    sourceHash: hash(scene), assetHash: feedback.diagnosticAssetHash, diagnostic}]};
  const job = {id: 'offline-concept', state: 'generating', assemblyCallsReserved: 2,
    assemblyStages: [{index: 1, phase: 'concept-candidate', state: 'accepted'}, {index: 2, phase: 'concept-candidate', state: 'reserved'}]};
  const protocol = {type: 'synthetic-independent-candidate-inspection', realModelCalls: 0};
  const ledger = {...frozen, protocol, protocolHash: hash(protocol), maximumCalls: 26, results: [{jobId: job.id, assetDirectory: directory}]};
  const ledgerFile = path.join(root, 'ledger.json');
  for (const [file, value] of [[ledgerFile, ledger], [path.join(directory, 'job.json'), job], [path.join(stageDir, 'input.json'), input],
    [path.join(stageDir, 'response.json'), response], [path.join(stageDir, 'result.json'), result], [path.join(candidateDir, 'scene.json'), scene]])
    await fs.writeFile(file, JSON.stringify(value), {flag: 'wx'});
  const report = await inspectQualityCandidateImages(ledgerFile, 1);
  assert.equal(report.candidateId, 'concept-1'); assert.deepEqual(report.images.map(i => i.file), capture.images);
  assert.equal(report.nativeEvidenceHash, capture.evidence.evidenceHash); assert.equal(report.additionalModelCalls, 0);
  assert.equal(report.additionalRenders, 0); assert.equal(report.terminalTaskAssessment, false); assert.equal(report.liveObservation, false);
  assert.equal(report.canAuthorizePlacement, false); assert.equal(report.aestheticQualityVerified, false);
  await assert.rejects(inspectQualityCandidateImages(ledgerFile, 2), /not an accepted/);
  await assert.rejects(inspectQualityCandidateImages(ledgerFile, 26), /not reserved/);
  async function tamper(file, mutate) {
    const original = await fs.readFile(file), value = JSON.parse(original); mutate(value);
    try { await fs.writeFile(file, JSON.stringify(value)); await assert.rejects(inspectQualityCandidateImages(ledgerFile, 1)); }
    finally { await fs.writeFile(file, original); }
  }
  await tamper(path.join(stageDir, 'response.json'), v => v.candidates[0].scene.title = 'not-original');
  await tamper(path.join(stageDir, 'result.json'), v => v.candidates[0].sourceHash = '0'.repeat(64));
  await tamper(path.join(stageDir, 'result.json'), v => v.accepted = false);
  await tamper(path.join(stageDir, 'result.json'), v => v.candidates[0].diagnostic = path.dirname(root));
  await tamper(path.join(diagnostic, 'manifest.json'), v => v.diagnosticOnly = false);
  const cellFile = path.join(diagnostic, 'cells.bin'), cells = await fs.readFile(cellFile), altered = Buffer.from(cells); altered[0] ^= 1;
  try { await fs.writeFile(cellFile, altered); await assert.rejects(inspectQualityCandidateImages(ledgerFile, 1)); }
  finally { await fs.writeFile(cellFile, cells); }
  const image = capture.images[0], png = await fs.readFile(image);
  try { await fs.writeFile(image, Buffer.from('not-original-PNG')); await assert.rejects(inspectQualityCandidateImages(ledgerFile, 1), /hash mismatch/); }
  finally { await fs.writeFile(image, png); }
  assert.equal((await inspectQualityCandidateImages(ledgerFile, 1)).imagesVerified, true);
});
