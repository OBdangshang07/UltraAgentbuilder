import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityV4Input,validateQualityV4Model,validateQualityV4Preflight,validateQualityV4PlayerGate,validateQualityV4NativeGate} from '../../scripts/quality-v4-live-gates.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';

const digest='a'.repeat(64),version='test-alpha';
const expansion=()=>({visualReviewSubject:'expanded',seedVisualAccepted:false,expandedVisualAccepted:true,additionalModelCalls:0,canAuthorizePlacement:false,finalVisualReviewCurrent:true,qualityGuaranteed:false,...Object.fromEntries(['programHash','seedSourceHash','expandedSourceHash','finalSourceHash','transitionHash'].map(k=>[k,digest]))});
function player(iris=false){return {result:'passed',type:'offline-player-flow',realModelCalls:0,fixtureProviderCalls:8,qualityVersion:4,prototypes:true,v4Regression:false,runtimeVersion:version,runtime:{runtimeHash:digest},iris,irisShaderPackActive:iris,
 ...Object.fromEntries(['oneGenerationSubmission','identityDurableBeforeSubmit','interruptedIdentityQueried','oneBudgetConfirmation','automaticCorrection','closedPanelTracking','automaticFinalPreview','lostSubmitReceiptRecovered','lostPreviewDownloadRecovered','durableInvocationJournal','exactAssetPlacedAndUndone','nativeClientExitVerified','nativeEvidence','lostNativeDownloadRecovered','lostNativeUploadRecovered','visibleTestWindow'].map(k=>[k,true])),
 formalWorldTouched:false,realProjectionMeshDraws:1,assetHash:digest,visualEvidenceBinding:{finalAssetHash:digest},prototypeExpansion:expansion(),savedWorldAudits:[{journalId:'full',unmatchedIntents:[],counts:{entries:2,matchesBefore:1,matchesAfter:0,other:1}},{journalId:'cancel',unmatchedIntents:[],counts:{entries:1,matchesBefore:1,matchesAfter:0,other:0}}]};}
function native(transportExit=false){return {result:'passed',realModelCalls:0,fixtureCalls:7,qualityVersion:4,prototypes:true,regression:false,runtimeHash:digest,supervised:true,transportExit,worldLoaded:false,assetOnly:true,conceptSelection:{eligible:['a','b','c']},renderer:{mode:'on-demand-native',result:transportExit?'recovered':'passed',failures:transportExit?[{}]:[],starts:2,launcherExited:true,nativeClientExitVerified:true,sessions:Array.from({length:2},()=>({launcherExited:true,nativeClientExitVerified:true,worldLoaded:false,assetOnly:true}))},assetHash:digest,visualEvidenceBinding:{finalAssetHash:digest},prototypeExpansion:expansion()};}

test('new workload uses only the exact authorized model, Max, v4 native verified prototypes and 26 total calls',()=>{
 const request=qualityV4Input({key:'new-key',prompt:'224 metre CBD'});
 assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.effort,'max');assert.equal(request.assemblyCalls,26);
 assert.equal(request.assemblyQuality,'v4');assert.equal(request.assemblyPrototypes,'verified');assert.equal(request.assemblyRecovery,'safe');
 assert.equal(request.maxOutputTokens,undefined);assert.equal(request.maxRepairs,0);
 const model={id:'gpt-6.1-sol',efforts:[{reasoningEffort:'max'}],supportsImages:true};
 assert.equal(validateQualityV4Model([model]),model);
 assert.throws(()=>validateQualityV4Model([{...model,id:'gpt-6-sol'}]),/Exact authorized/);
 assert.throws(()=>validateQualityV4Model([{...model,efforts:['high']}]),/Max/);
 assert.throws(()=>validateQualityV4Model([{...model,supportsImages:false}]));
});
test('ordinary and active-Iris prototype player evidence pass without certifying aesthetics',()=>{
 for(const iris of [false,true])validateQualityV4PlayerGate(player(iris),{version,runtimeHash:digest,iris});
});
test('real production preflight inherits output tokens and binds v4 prototype permission without dispatch',()=>{
 const policy=generationPreflight(qualityV4Input({key:'preflight-fixture',prompt:'设计一座实际高度224米、64×64格范围的CBD写字楼'}));
 validateQualityV4Preflight(policy);
 for(const change of [p=>p.maximumCalls=27,p=>p.minimumHeight=200,p=>p.maxOutputTokens=32768,p=>p.assembly.prototypes.mode='unchecked',p=>p.assembly.recovery.unknownOutcomeRetries=1]){
  const candidate=structuredClone(policy);change(candidate);assert.throws(()=>validateQualityV4Preflight(candidate));
 }
});
test('old version, old runtime, incomplete player chain, stale image and unverified exit are rejected',()=>{
 for(const change of [{qualityVersion:3},{prototypes:false},{runtimeVersion:'old'},{runtime:{runtimeHash:'b'.repeat(64)}},{oneGenerationSubmission:false},{formalWorldTouched:true},{nativeClientExitVerified:false},{realModelCalls:1},{visualEvidenceBinding:{finalAssetHash:'b'.repeat(64)}}]){
  assert.throws(()=>validateQualityV4PlayerGate({...player(),...change},{version,runtimeHash:digest,iris:false}));
 }
 assert.throws(()=>validateQualityV4PlayerGate({...player(true),irisShaderPackActive:false},{version,runtimeHash:digest,iris:true}));
});
test('seed approval, zero expansion calls and current final review are separate mandatory invariants',()=>{
 for(const change of [{seedVisualAccepted:true},{expandedVisualAccepted:false},{visualReviewSubject:'seed'},{additionalModelCalls:1},{canAuthorizePlacement:true},{finalVisualReviewCurrent:false},{qualityGuaranteed:true}]){
  const report=player();Object.assign(report.prototypeExpansion,change);
  assert.throws(()=>validateQualityV4PlayerGate(report,{version,runtimeHash:digest,iris:false}));
 }
});
test('saved-world audit cannot leave ambiguous, duplicated or after-state entries',()=>{
 for(const change of [r=>r.savedWorldAudits[0].unmatchedIntents.push('unknown'),r=>r.savedWorldAudits[0].counts.matchesAfter=1,r=>r.savedWorldAudits[0].counts.entries=10,r=>r.savedWorldAudits[1].journalId='full']){
  const report=player();change(report);assert.throws(()=>validateQualityV4PlayerGate(report,{version,runtimeHash:digest,iris:false}));
 }
});
test('normal on-demand and exactly-one recovered transport require all exact client exits',()=>{
 for(const transportExit of [false,true])validateQualityV4NativeGate(native(transportExit),{runtimeHash:digest,transportExit});
 for(const change of [r=>r.supervised=false,r=>r.prototypes=false,r=>r.renderer.sessions[1].nativeClientExitVerified=false,r=>r.renderer.sessions[0].worldLoaded=true,r=>r.renderer.failures.push({}),r=>r.renderer.starts=3,r=>r.visualEvidenceBinding.finalAssetHash='b'.repeat(64)]){
  const report=native();change(report);assert.throws(()=>validateQualityV4NativeGate(report,{runtimeHash:digest,transportExit:false}));
 }
});
