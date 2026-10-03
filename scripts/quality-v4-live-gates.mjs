import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';

export const QUALITY_V4_MODEL='gpt-6.1-sol';
export const QUALITY_V4_EFFORT='max';
export const QUALITY_V4_AUTHORIZATION='2026-09-30 / active goal: GPT 6.1 Sol calls authorized within the full quality/context/multimodal plan';

export function validateQualityV4Model(models){
 const selected=models.find(m=>m.id===QUALITY_V4_MODEL);
 assert.ok(selected,'Exact authorized GPT-6.1 Sol unavailable; no generation submitted');
 assert.ok(selected.efforts?.some(e=>(e.reasoningEffort??e)===QUALITY_V4_EFFORT),'Max effort unavailable; no substitution');
 assert.equal(selected.supportsImages,true,'Image capability must be explicitly advertised');
 return selected;
}

export function qualityV4Input({key,prompt}){
 assert.ok(typeof key==='string'&&key.length>0);assert.ok(typeof prompt==='string'&&prompt.length>0);
 return {key,agent:'codex',model:QUALITY_V4_MODEL,effort:QUALITY_V4_EFFORT,prompt,generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyCalls:26,assemblyQuality:'v4',assemblyPrototypes:'verified',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
}

export function validateQualityV4Preflight(policy){
 assert.equal(policy.maximumCalls,26);assert.equal(policy.minimumHeight,224);assert.equal(policy.maxOutputTokens,null);
 assert.equal(policy.assembly.quality.version,4);assert.equal(policy.assembly.recovery.unknownOutcomeRetries,0);
 assert.equal(policy.assembly.prototypes.mode,'verified');assert.equal(policy.assembly.prototypes.expansionCalls,0);
 assert.equal(policy.assembly.prototypes.expandedVisualGate,true);
 assert.equal(policy.assembly.intermediateAssetsPlaceable,false);
}

function prototypeSummary(value){
 assert.equal(value?.visualReviewSubject,'expanded');assert.equal(value.seedVisualAccepted,false);assert.equal(value.expandedVisualAccepted,true);assert.equal(value.additionalModelCalls,0);
 assert.equal(value.canAuthorizePlacement,false);assert.equal(value.finalVisualReviewCurrent,true);
 assert.equal(value.qualityGuaranteed,false);
 for(const key of ['programHash','seedSourceHash','expandedSourceHash','finalSourceHash','transitionHash'])assert.match(value[key],/^[a-f0-9]{64}$/);
}

export function validateQualityV4PlayerGate(report,{version,runtimeHash,iris}){
 assert.equal(report.result,'passed');assert.equal(report.type,'offline-player-flow');
 assert.equal(report.realModelCalls,0);assert.equal(report.fixtureProviderCalls,8);
 assert.equal(report.qualityVersion,4);assert.equal(report.prototypes,true);assert.equal(report.v4Regression,false);
 assert.equal(report.runtimeVersion,version);assert.equal(report.runtime.runtimeHash,runtimeHash);
 assert.equal(report.iris,iris);if(iris)assert.equal(report.irisShaderPackActive,true);
 for(const key of ['oneGenerationSubmission','identityDurableBeforeSubmit','interruptedIdentityQueried','oneBudgetConfirmation','automaticCorrection','closedPanelTracking','automaticFinalPreview','lostSubmitReceiptRecovered','lostPreviewDownloadRecovered','durableInvocationJournal','exactAssetPlacedAndUndone','nativeClientExitVerified','nativeEvidence','lostNativeDownloadRecovered','lostNativeUploadRecovered','visibleTestWindow'])assert.equal(report[key],true,key);
 assert.equal(report.formalWorldTouched,false);assert.ok(report.realProjectionMeshDraws>0);
 assert.equal(report.visualEvidenceBinding.finalAssetHash,report.assetHash);
 prototypeSummary(report.prototypeExpansion);
 assert.equal(report.savedWorldAudits.length,2);assert.notEqual(report.savedWorldAudits[0].journalId,report.savedWorldAudits[1].journalId);
 for(const audit of report.savedWorldAudits){
  assert.deepEqual(audit.unmatchedIntents,[]);assert.equal(audit.counts.matchesAfter,0);
  for(const count of Object.values(audit.counts))assert.ok(Number.isSafeInteger(count)&&count>=0);
  assert.equal(audit.counts.entries,audit.counts.matchesBefore+audit.counts.other);
 }
}

export function validateQualityV4NativeGate(report,{runtimeHash,transportExit,version}){
 assert.equal(report.result,'passed');assert.equal(report.realModelCalls,0);assert.equal(report.fixtureCalls,7);
 assert.equal(report.qualityVersion,4);assert.equal(report.prototypes,true);assert.equal(report.regression,false);
 assert.equal(report.runtimeHash,runtimeHash);assert.equal(report.supervised,true);assert.equal(report.transportExit,transportExit);
 assert.equal(report.worldLoaded,false);assert.equal(report.assetOnly,true);assert.equal(report.conceptSelection.eligible.length,3);
 assert.equal(report.renderer.mode,'on-demand-native');assert.equal(report.renderer.result,transportExit?'recovered':'passed');
 assert.equal(report.renderer.failures.length,transportExit?1:0);assert.ok(report.renderer.starts>=2);
 assert.equal(report.renderer.launcherExited,true);assert.equal(report.renderer.nativeClientExitVerified,true);
 assert.equal(report.renderer.sessions.length,report.renderer.starts);
 for(const session of report.renderer.sessions){
  assert.equal(session.launcherExited,true);assert.equal(session.nativeClientExitVerified,true);
  assert.equal(session.worldLoaded,false);assert.equal(session.assetOnly,true);
  if(version)assert.equal(session.version,version);
 }
 assert.equal(report.visualEvidenceBinding.finalAssetHash,report.assetHash);
 prototypeSummary(report.prototypeExpansion);
}

// Reads only durable free-test evidence. No Agent, renderer or submission API
// is imported: invalid/old/non-prototype reports cannot consume model quota.
export async function collectQualityV4LiveGates(project,files,{version,runtimeHash}){
 const receipts=[],read=async file=>{
  file=path.resolve(file);const rel=path.relative(path.join(project,'build'),file);
  assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Gate must be project-local build evidence');
  const bytes=await fs.readFile(file);receipts.push({file,sha256:hash(bytes)});return JSON.parse(bytes);
 };
 const pair=[];
 for(const [name,iris] of [['player',false],['irisPlayer',true]]){
  const report=await read(files[name]);validateQualityV4PlayerGate(report,{version,runtimeHash,iris});pair.push(report);
  const dir=path.dirname(path.resolve(files[name]));
  const assessment=await read(path.join(dir,'assessment.json'));
  assert.equal(assessment.state,'preview-ready');assert.equal(assessment.additionalModelCalls,0);
  assert.equal(assessment.runtimeHash,runtimeHash);assert.equal(assessment.final.assetHash,report.assetHash);
  const world=await read(path.join(dir,'world-result.json'));
  assert.equal(world.result,'passed');assert.equal(world.version,version);assert.equal(world.assetHash,report.assetHash);
  for(let i=0;i<2;i++){
   const saved=await read(path.join(dir,'saved-'+i+'.json'));
   assert.equal(saved.type,'isolated-saved-world-journal-audit');assert.equal(saved.metadata.assetHash,report.assetHash);
   assert.equal(saved.metadata.revision,report.jobId);assert.equal(saved.additionalModelCalls,0);
   assert.equal(saved.undoneMarkerPresent,true);assert.deepEqual(saved.unmatchedIntents,[]);
   assert.equal(saved.persistedRandomTickSpeed,String(world.originalRandomTickSpeed));
   const summary=report.savedWorldAudits.find(a=>a.journalId===saved.journalId);assert.ok(summary);
   assert.deepEqual(saved.counts,summary.counts);
  }
 }
 assert.notEqual(pair[0].jobId,pair[1].jobId);assert.equal(pair[0].assetHash,pair[1].assetHash);
 const nativePair=[];
 for(const [name,transportExit] of [['native',false],['transport',true]]){
  const report=await read(files[name]);validateQualityV4NativeGate(report,{runtimeHash,transportExit,version});nativePair.push(report);
  const assessment=await read(path.join(path.dirname(path.resolve(files[name])),'assessment.json'));
  assert.equal(assessment.state,'preview-ready');assert.equal(assessment.additionalModelCalls,0);
  assert.equal(assessment.runtimeHash,runtimeHash);assert.equal(assessment.final.assetHash,report.assetHash);
 }
 assert.notEqual(nativePair[0].jobId,nativePair[1].jobId);assert.equal(nativePair[0].assetHash,nativePair[1].assetHash);
 const builtin=await read(files.builtin);assert.equal(builtin.result,'passed');assert.equal(builtin.version,version);
 assert.equal(builtin.additionalLiveModelCalls,0);assert.equal(builtin.packagedWorkerHashMatches,true);assert.equal(builtin.skillIncluded,true);
 const java=await read(files.java);assert.equal(java.result,'passed');assert.equal(java.version,version);
 assert.equal(java.additionalModelCalls,0);assert.ok(java.javaTests>=119);assert.equal(java.testsOnly,false);
 assert.equal(java.jar,path.join(project,'mod/build/libs','voxel-studio-'+version+'.jar'));
 assert.equal(hash(await fs.readFile(java.jar)),java.jarSha256.toLowerCase());receipts.push({file:java.jar,sha256:java.jarSha256.toLowerCase()});
 const studio=await read(files.studio);assert.equal(studio.exitCode,0);assert.equal(studio.systemTempUsed,false);
 return receipts;
}
