import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {hash} from '../../src/generation/compiler.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {setupLegacyStaged,setupStaged,stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';

for(const profile of ['legacy-v3','review-funded-v4','allocation-v5','allocation-v5-role-correction','expanded-routes-v6'])test(profile+' read-only terminal audit reconstructs all independent responses, scoped seed/full owners and role receipts; tampering fails',async()=>{
 const expectedCalls=profile==='legacy-v3'?19:profile==='allocation-v5'?18:profile==='allocation-v5-role-correction'?17:16;
 let revised=false;
 const change=profile==='allocation-v5'?({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint')answer.packages[1].regions[0].size[1]=183;
  if(options.stageName==='concept-review'&&!revised){revised=true;answer.verdict='revise';answer.issues=[{id:'seed-proof',criterion:'facade',evidence:'Synthetic incomplete upper allocation',change:'Allocate upper work'}];}
  if(options.stageName==='revise-design'){
   const target=structuredClone(input.priorPlan);target.packages[1].regions[0].size[1]=224;target.packages[1].purpose+='; upper work';answer.edit=planEdit(input.priorPlan,target);
  }return answer;
 }:profile==='allocation-v5-role-correction'?({answer,input,options})=>{
  if(options.stageName==='assembly-blueprint'){
   answer.sceneEdit.components.put.push(shape('entryContext',[16,4,23],[2,1,2],'frame'));
   answer.packages[2].editableComponents.push('entryContext');
  }
  if(options.stageName==='prototype-role'&&input.role==='entry-podium')answer.representatives[1].components.push('entryContext');
  return answer;
 }:null;
 const h=await (profile==='legacy-v3'?setupLegacyStaged():setupStaged(change,profile==='expanded-routes-v6'?{...stagedRequest,assemblyPrototypeValidation:'expanded-routes-v1'}:undefined,{legacyV4:profile==='review-funded-v4'})),project=fileURLToPath(new URL('../../',import.meta.url));
 const snapshot=await freezeSceneRuntime(project,path.join(h.directory,'runtime')),mod=file=>import(pathToFileURL(path.join(snapshot.runtime,file)));
 const {runSceneAssembly}=await mod('bridge/scene-assembly.mjs'),{compileScene}=await mod('src/design/compiler.mjs');let records=[];
 h.options.onStage=async r=>{records=r;};const startedAt=new Date().toISOString(),result=await runSceneAssembly(h.options);
 const compiled=compileScene(result.scene,{navigationPolicy:'review'});
 for(const [name,value] of Object.entries({'manifest.json':compiled.manifest,'scene.json':compiled.scene,'spec.json':compiled.spec,'design-sources.json':compiled.designSources}))await fs.writeFile(path.join(h.directory,name),JSON.stringify(value),{flag:'wx'});
 const owners=Buffer.alloc(compiled.sourceOwners.length*2);compiled.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
 await fs.writeFile(path.join(h.directory,'source-owners.bin'),owners,{flag:'wx'});await fs.writeFile(path.join(h.directory,'cells.bin'),compiled.binary,{flag:'wx'});
 const visual=result.summary.finalVisualReview,job={id:'offline-staged-audit',state:'preview-ready',model:'offline',assemblyCallsReserved:records.length,
  assemblyStages:records,assemblySummary:result.summary,assetHash:compiled.manifest.assetHash,recoveryEnabled:false,
  generations:records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),
  visualEvidenceBinding:{sourceHash:visual.sourceHash,cellsHash:compiled.manifest.cellsHash,renderedDiagnosticAssetHash:visual.assetHash,
   finalAssetHash:compiled.manifest.assetHash,evidenceHash:visual.evidenceHash,canAuthorizePlacement:false}};
 const finishedAt=new Date().toISOString(),protocol={type:'offline-staged-audit',realModelCalls:0},ledger={protocol,protocolHash:hash(protocol),...snapshot,
  maximumCalls:26,reservedCalls:records.length,finishedAt,results:[{jobId:job.id,state:job.state,assemblyCallsReserved:records.length,
   assemblyStages:records,assetDirectory:h.directory,startedAt,finishedAt}]};
 await fs.writeFile(path.join(h.directory,'job.json'),JSON.stringify(job),{flag:'wx'});const ledgerFile=path.join(h.directory,'ledger.json');await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});
 const audit=async name=>{
  const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,path.join(h.directory,name+'.json')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,output};
 };
 const good=await audit('good');assert.equal(good.code,0,good.output);
 const report=JSON.parse(await fs.readFile(path.join(h.directory,'good.json')));assert.equal(report.final.sourceHash,hash(result.scene));
 assert.equal(report.reservedCalls,expectedCalls);assert.equal(report.additionalModelCalls,0);assert.equal(report.aestheticQualityConfirmed,false);
 const tamper=async(relative,name,change,expected)=>{
  const file=path.join(h.directory,relative),original=await fs.readFile(file,'utf8'),value=JSON.parse(original);change(value);await fs.writeFile(file,JSON.stringify(value));
  const bad=await audit(name);assert.notEqual(bad.code,0);assert.match(bad.output,expected);await fs.writeFile(file,original);
 };
 await tamper('assembly/decomposed-concepts.json','wrong-candidate-binding',v=>v.bindings[0].responseHash='0'.repeat(64),/candidate binding differs/);
 await tamper('assembly/5/response.json','altered-blueprint',v=>v.packages[0].purpose='Changed undeclared responsibility',/delta\/state\/source mismatch/);
 await tamper('assembly/6/response.json','foreign-role-proof',v=>v.representatives[0].components=['main'],/representative-foreign-source/);
 await tamper('assembly/6/input.json','false-correction-count',v=>v.prototypeCorrectionBudget.correction=1,/protected-tail budget mismatch/);
 await tamper('assembly/6/input.json','false-correction-remaining',v=>v.prototypeCorrectionBudget.remaining++,/protected-tail budget mismatch/);
 await tamper('assembly/7/representative-witness.json','fake-surviving-cells',v=>v.roles[0].representatives[0].components[0].solidCells++,/representative witness differs/);
 await tamper('assembly/8/prototype/feedback.json','false-expanded-scope',v=>v.packageCheck.scopeVerified=false,/expanded scope\/proposal mismatch/);
 if(profile==='expanded-routes-v6'){
  await tamper('assembly/6/feedback.json','fake-seed-route-pass',v=>v.packageCheck.previouslyCheckedRoutesPreserved=true,/seed scope differs/);
  await tamper('assembly/8/prototype/feedback.json','fake-expanded-route-pass',v=>v.packageCheck.previouslyCheckedRoutesPreserved=false,/expanded scope\/proposal mismatch/);
  await tamper('assembly/6/input.json','downgraded-original-policy',v=>{v.tier.prototypes.version=5;delete v.tier.prototypes.validation;},/Decomposed stage changed its original policy/);
 }
 await tamper('assembly/decomposed-prototypes.json','wrong-role-order',v=>v.roles.reverse(),/aggregate role\/prototype receipt mismatch/);
 await tamper('job.json','false-completeness',v=>v.assemblySummary.decomposition.architecturalCompletenessVerified=true,/Final decomposition summary differs/);
 if(profile==='allocation-v5'){
  await tamper('assembly/initial-design-allocation.json','false-initial-allocation',v=>v.seed.sources[0].cells++,/Initial design allocation differs/);
  await tamper('assembly/11/design-allocation.json','false-revised-allocation',v=>v.authority.deltas[0].after.regions[0].size[1]--,/Revised design allocation differs/);
  await tamper('assembly/12/input.json','false-input-allocation',v=>v.designAllocationReceipt.expanded.sources[0].cells++,/Model input design allocation differs/);
  await tamper('assembly/12/input.json','policy-downgrade',v=>{v.tier.prototypes.version=4;delete v.tier.prototypes.designAllocation;},/original staged policy/);
  await tamper('assembly/design-allocation-freeze.json','false-manufacturing-freeze',v=>v.packagesHash='0'.repeat(64),/Manufacturing allocation freeze differs/);
  await tamper('assembly/interfaces.json','changed-frozen-region',v=>v.packages[1].regions[0].size[1]--,/Manufacturing packages differ/);
  await tamper('assembly/interfaces.json','changed-frozen-probes',v=>v.constraints.passages[0].origin[0]++,/Manufacturing packages differ/);
 }
 if(profile.startsWith('allocation-v5')){
  await tamper('assembly/6/input.json','false-role-allocation-policy',v=>v.prototypeAllocationPolicy.automaticRegionExpansion=true,/role allocation policy mismatch/);
  await tamper('assembly/6/prototype-allocation.json','false-role-allocation',v=>v.expanded.sources[0].cells++,/Accepted prototype allocation differs/);
  await tamper('assembly/6/result.json','false-role-allocation-result',v=>v.prototypeAllocationReceipt.seed.sources[0].cells++,/Accepted prototype allocation differs/);
 }
 if(profile==='allocation-v5-role-correction'){
  await tamper('assembly/8/prototype-allocation.json','false-rejected-allocation',v=>v.feedback.outsideWorkspaceCells++,/Rejected prototype allocation differs/);
  await tamper('assembly/8/result.json','false-rejected-allocation-result',v=>v.feedback.designAllocation.uncoveredSources[0].uncoveredSamples[0][2]++,/Rejected prototype allocation differs/);
 }
 assert.equal(h.calls.length,expectedCalls);
});
