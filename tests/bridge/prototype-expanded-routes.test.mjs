import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../../src/generation/compiler.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {expandedPrototypeRoutesEnabled,prototypeValidationPolicy,PROTOTYPE_SEED_SCOPE_INSPECTION} from '../../contracts/assembly-prototype-validation.mjs';
import {representativeEvidenceEnabled} from '../../contracts/assembly-evidence-policy.mjs';
import {stagedDesignAllocationEnabled} from '../../contracts/scene-design-allocation.mjs';
import {inspectCheckpoint} from '../../bridge/scene-checkpoints.mjs';
import {checkPackageGeometry,checkPackageCellScope,readAssemblyBaseline} from '../../src/design/assembly-scope.mjs';
import {assessSceneCheckpoint} from '../../src/design/checkpoint.mjs';
import {applyPrototypeExpansion} from '../../contracts/scene-prototype-expansion.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {decompositionRoleCorrectionBudget} from '../../bridge/assembly-decomposed-stages.mjs';
import {stagedRequest,setupStaged} from './decomposed-assembly-fixtures.mjs';
import {basicScene,mass,shape,at,once} from '../design/fixtures.mjs';

const request={...stagedRequest,assemblyPrototypeValidation:'expanded-routes-v1'};
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
// Authored regression, not a model answer or architectural-quality sample.
function portalScene(){
 const scene=basicScene('seed-route-regression');scene.bounds={width:16,height:24,length:16};
 scene.components=[mass('main',[1,0,1],[14,24,14],[5,10,15,20]),
  shape('barrier',[8,1,2],[1,23,12],'wall',{stage:'structure',allowOverwrite:['main']}),
  {id:'portals',kind:'void',at:at([8,1,7]),size:[1,3,2],repeat:{count:5,step:[0,5,0]},allowOverwrite:['barrier']},
  {id:'flights',kind:'stairs',at:at([2,0,3]),size:[6,8,5],host:'main',style:'switchback',rotation:0,width:2,rise:5,material:'floor',repeat:{count:4,step:[0,5,0]},allowOverwrite:[]}];
 scene.constraints.passages=[{origin:[3,1,10],size:[1,2,1]},{origin:[11,21,7],size:[1,2,1]}];
 return scene;
}
const task={id:'study',editableComponents:['portals'],regions:[{origin:[8,1,7],size:[1,23,2]}],interfaces:[0,1]};
function seedOf(scene){const seed=structuredClone(scene);seed.components.find(c=>c.id==='portals').repeat=structuredClone(once);return seed;}
const program=(scene,count=5)=>({format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(scene),recipes:[{component:'portals',mode:'repeat',count,step:[0,5,0]}]});

test('new explicit policy has the same budget, tail, allocation and camera gates; omitted v5 stays unchanged',()=>{
 const old=generationPreflight(stagedRequest),next=generationPreflight(request);
 assert.equal(old.assembly.prototypes.version,5);assert.equal(expandedPrototypeRoutesEnabled(old.assembly),false);
 assert.equal(next.assembly.prototypes.version,6);assert.equal(expandedPrototypeRoutesEnabled(next.assembly),true);
 assert.deepEqual(next.assembly.prototypes.validation,prototypeValidationPolicy());
 assert.equal(next.maximumCalls,26);assert.equal(next.maxOutputTokens,null);assert.equal(next.assembly.maxPackages,5);
 assert.equal(stagedDesignAllocationEnabled(next.assembly),true);
 assert.equal(representativeEvidenceEnabled(generationPreflight({...request,assemblyEvidence:'representative-v1'}).assembly),true);
 for(const used of [5,9,15,20])for(const roleIndex of [0,1,2,3])assert.deepEqual(
  decompositionRoleCorrectionBudget(old.assembly,Array(used).fill(null),{roleIndex,packageCount:5,correction:3}),
  decompositionRoleCorrectionBudget(next.assembly,Array(used).fill(null),{roleIndex,packageCount:5,correction:3}));
 for(const delta of [{assemblyPrototypeValidation:'anything'},{assemblyPrototypes:'verified'},{sceneWorkflow:'checkpoints'},
  {assemblyPrototypes:undefined},{qualityTier:'pro'}])assert.throws(()=>generationPreflight({...request,...delta}));
 for(const change of [p=>p.version=5,p=>delete p.validation,p=>p.validation.expanded='none',p=>p.mode='verified']){
  const bad=structuredClone(next.assembly);change(bad.prototypes);assert.throws(()=>expandedPrototypeRoutesEnabled(bad));
 }
});

test('real seed contraction reproduces legacy false rejection; the fully restored expansion retains actual routes',()=>{
 const before=portalScene(),seed=seedOf(before),a=assessSceneCheckpoint(before),b=assessSceneCheckpoint(seed);
 assert.equal(a.report.geometryPassed,true,a.report.error);assert.equal(b.report.geometryPassed,true,b.report.error);
 assert.equal(a.report.navigationFeedback.passages[1].entryRelation,'reachable');
 assert.equal(b.report.navigationFeedback.passages[1].entryRelation,'disconnected');
 assert.throws(()=>checkPackageGeometry(a.compiled,b.compiled,task,a.report,b.report),/regressed a previously checked passage/);
 const scope=checkPackageCellScope(a.compiled,b.compiled,task);
 assert.equal(scope.scopeVerified,true);assert.equal(scope.previouslyCheckedRoutesPreserved,false);
 const expanded=applyPrototypeExpansion(seed,program(seed));assert.deepEqual(expanded,before);
 const full=assessSceneCheckpoint(expanded);assert.equal(full.report.navigationFeedback.passages[1].entryRelation,'reachable');
 // An identity-only expansion is not a meaningful refinement and cannot pass
 // full package checking: add a separately owned actual detail for the role.
 assert.throws(()=>checkPackageGeometry(a.compiled,full.compiled,task,a.report,full.report),/no actual block\/material change/);
 expanded.components.push(shape('study__detail',[8,3,7],[1,1,1],'lamp',{allowOverwrite:['portals']}));
 const refined=assessSceneCheckpoint(expanded);assert.equal(refined.report.geometryPassed,true,refined.report.error);
 assert.equal(checkPackageGeometry(a.compiled,refined.compiled,task,a.report,refined.report).previouslyCheckedRoutesPreserved,true);
 assert.equal(hash(before),hash(portalScene()));
});

test('bounded worker defers only seed route comparison and never adopts short expansion, protected cells or out-of-region changes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prototype-route-check-')),policy=generationPreflight(request),signal=new AbortController().signal;
 const before=portalScene(),seed=seedOf(before);
 const baseline=await inspectCheckpoint(before,policy,path.join(dir,'base'),signal,{});
 assert.equal(baseline.geometryPassed,true,baseline.error);
 const assembly={baselineDirectory:path.join(dir,'base'),baseAssetHash:baseline.diagnosticAssetHash,task,previousFeedback:baseline,inspection:PROTOTYPE_SEED_SCOPE_INSPECTION};
 const scoped=await inspectCheckpoint(seed,policy,path.join(dir,'seed'),signal,assembly);
 assert.equal(scoped.geometryPassed,true,scoped.error);assert.equal(scoped.packageCheck.previouslyCheckedRoutesPreserved,false);
 assert.equal(scoped.canAuthorizePlacement,false);
 const short=applyPrototypeExpansion(seed,program(seed,4));
 const {inspection,...fullAssembly}=assembly;
 const rejected=await inspectCheckpoint(short,policy,path.join(dir,'short'),signal,fullAssembly);
 assert.equal(rejected.geometryPassed,false);assert.match(rejected.error,/regressed a previously checked passage/);
 assert.equal(rejected.packageNavigationFeedback.index,1);
 const old=generationPreflight(stagedRequest);
 await assert.rejects(inspectCheckpoint(seed,old,path.join(dir,'legacy-marker'),signal,assembly),/Unauthorized/);
 const legacy=await inspectCheckpoint(seed,old,path.join(dir,'legacy-normal'),signal,fullAssembly);
 assert.equal(legacy.geometryPassed,false);assert.match(legacy.error,/regressed a previously checked passage/);
 await assert.rejects(inspectCheckpoint(seed,policy,path.join(dir,'unknown-marker'),signal,{...assembly,inspection:'anything'}),/Unauthorized/);
 const base=await readAssemblyBaseline(path.join(dir,'base'),baseline.diagnosticAssetHash);
 const own=await readAssemblyBaseline(path.join(dir,'seed'),scoped.diagnosticAssetHash);
 assert.throws(()=>checkPackageCellScope(base,own,{...task,editableComponents:[]}),/protected component portals/);
 assert.throws(()=>checkPackageCellScope(base,own,{...task,regions:[{origin:[8,1,7],size:[1,3,2]}]}),/outside approved regions/);
 assert.equal(hash(before),hash(portalScene()));
});

function towerPortalAnswer({answer,input,options}){
 if(options.stageName==='assembly-blueprint'){
  answer.sceneEdit.components.put.push(shape('barrier',[11,1,3],[1,223,26],'wall',{stage:'structure',allowOverwrite:['main']}),
   {id:'task0__portals',kind:'void',at:at([11,1,14]),size:[1,3,2],repeat:{count:44,step:[0,5,0]},allowOverwrite:['barrier']});
  answer.packages[0].regions=[{origin:[11,0,3],size:[3,224,26]}];answer.packages[0].editableComponents.push('task0__portals');
 }
 if(['prototype-role','correct-prototype-role'].includes(options.stageName)&&input.role==='typical-floor-core'){
  for(const c of answer.edit.components.put)c.at.offset[0]=12;
  const portal=structuredClone(input.previousDraft.components.find(c=>c.id==='task0__portals'));portal.repeat=structuredClone(once);
  answer.edit.components.put.push(portal);answer.recipes.push({component:portal.id,mode:'repeat',count:44,step:[0,5,0]});
 }
 return answer;
}

test('new full synthetic task contracts openings, expands all floors, completes in 16 calls and durable replay dispatches none twice',async()=>{
 const h=await setupStaged(towerPortalAnswer,request),options={...h.options,requestHash:hash(request),runtimeHash:'synthetic-v6-route-test'};
 let originalBranch;
 options.onRecovery=async value=>{if(value.state==='complete')originalBranch=value.branch;};
 const result=await runDurableAssembly(options);assert.match(originalBranch,/^assembly-run-[A-Za-z0-9]+$/);
 const root=path.join(h.directory,originalBranch,'assembly');
 assert.equal(h.calls.length,16);assert.equal(result.summary.completedPackages.length,5);
 assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);
 const role=await json(path.join(root,'6','result.json'));
 assert.equal(role.accepted,true);assert.equal(role.feedback.packageCheck.previouslyCheckedRoutesPreserved,false);
 assert.equal(role.prototype.feedback.packageCheck.previouslyCheckedRoutesPreserved,true);
 const seed=await json(path.join(root,'6','scene.json')),expanded=await json(path.join(root,'6','prototype','scene.json'));
 assert.equal(seed.components.find(c=>c.id==='task0__portals').repeat.count,1);
 assert.equal(expanded.components.find(c=>c.id==='task0__portals').repeat.count,44);
 assert.match(h.calls.find(c=>c.index===6).instructions,/PROTOTYPE VALIDATION V6/);
 await runDurableAssembly(options);assert.equal(h.calls.length,16);
});

test('legacy full task still rejects the same temporary contraction rather than silently acquiring v6 semantics',async()=>{
 const h=await setupStaged(towerPortalAnswer);
 await assert.rejects(runSceneAssembly(h.options),/repeated the same rejected delta/);
 assert.equal(h.calls.length,7);assert.ok(h.calls.every(c=>!['concept-review','component','review'].includes(c.phase)));
 const original=await json(path.join(h.directory,'assembly','6','result.json'));
 assert.equal(original.accepted,false);assert.match(original.error,/regressed a previously checked passage/);
});

test('new role without any recipes retains full navigation regression checking',async()=>{
 const h=await setupStaged(({answer,input,options})=>{
  towerPortalAnswer({answer,input,options});
  if(options.stageName==='prototype-role'&&input.role==='typical-floor-core')answer.recipes=[];
  return answer;
 },request);
 const result=await runSceneAssembly(h.options);
 assert.equal(result.records[5].state,'rejected');
 const rejected=await json(path.join(h.directory,'assembly','6','result.json'));
 assert.equal(rejected.feedback.geometryPassed,false);assert.match(rejected.error,/regressed a previously checked passage/);
 assert.equal(h.calls.length,17);assert.equal(result.summary.finalTextReviewAccepted,true);
});
