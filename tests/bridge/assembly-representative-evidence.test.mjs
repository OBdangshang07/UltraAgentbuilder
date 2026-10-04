import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {setupStaged,stagedRequest} from './decomposed-assembly-fixtures.mjs';
import {at,once} from '../design/fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {terminalFixture} from './assembly-terminal-fixture.mjs';

const request={...stagedRequest,assemblyEvidence:'representative-v1'};
// Synthetic compiler/transport regression, not an AI design or native capture.
const room=(id,y,purpose)=>({id,kind:'roomZone',host:'main',at:at([12,y,20]),
 size:[2,5,2],repeat:once,allowOverwrite:[],use:'room',purpose,
 floorMaterial:'frame',boundaries:[]});
export async function representativeFixture(change=null){
 return setupStaged(context=>{
  const {answer,input}=context;
  if(answer.format==='SceneAssemblyBlueprint'){
   // Room finishes write the host's slab. Give this synthetic package explicit
   // host ownership and its real full region BEFORE freezing, never waive it.
   answer.packages[0].editableComponents=['main'];
   answer.packages[0].regions.push({origin:[2,0,2],size:[28,224,28]});
  }
  if(answer.format==='ScenePrototypeRoleEdit'&&input.role==='typical-floor-core'){
   answer.edit.components.put[0]=room('task0__a',15,'Public label on actual representative room');
   answer.edit.components.put.push(room('task0__decoy',110,'Office label on unrelated public-floor context'));
   answer.recipes[0].step=[0,100,0];
  }
  return change?.(context)??answer;
 },request);
}
test('new representative evidence is explicitly versioned without changing legacy policy or budget',()=>{
 const old=generationPreflight(stagedRequest),current=generationPreflight(request);
 assert.equal(current.assembly.cameraEvidence?.mode,'representative-v1');
 assert.equal(old.assembly.cameraEvidence,undefined);
 const {cameraEvidence,...unchanged}=current.assembly;
 assert.deepEqual(unchanged,old.assembly);
 assert.equal(current.maximumCalls,old.maximumCalls);
 for(const delta of [{assemblyEvidence:'v4'},{assemblyPrototypes:'verified'},
  {assemblyQuality:'v3'},{sceneWorkflow:undefined}])
  assert.throws(()=>generationPreflight({...request,...delta}));
});
test('expanded actual representative room selects 115m, not the unassociated office-labelled 110m band',async()=>{
 const h=await representativeFixture(),result=await runSceneAssembly(h.options);
 const review=h.calls.find(c=>c.phase==='concept-review');
 const view=review.input.designEvidence.views.find(v=>v.camera.purpose==='typical-floor');
 assert.equal(view.camera.min[1],115);
 assert.equal(view.camera.max[1],120);
 assert.equal(review.input.designEvidence.cameraBasis.selection.selected.component,'task0__a');
 assert.equal(review.input.designEvidence.cameraBasis.selection.selected.basis,'room-zone');
 assert.match(review.instructions,/selection is historical evidence/);
 assert.match(review.instructions,/CURRENT asset pixels/);
 assert.equal(result.summary.completedPackages.length,5);
 assert.equal(result.records.length,16);
 const final=h.calls.findLast(c=>c.phase==='review').input.designEvidence;
 assert.equal(final.cameraBasis.basisHash,review.input.designEvidence.cameraBasis.basisHash);
 assert.deepEqual(final.pairs.map(p=>p.purpose),['exterior','facade-detail','entry','typical-floor']);
 assert.equal(final.views.filter(v=>v.camera.purpose==='typical-floor').length,2);
 assert.equal(result.summary.cameraEvidence.selectedFloorY,115);
});
test('saved camera subject tampering is rejected before the next model dispatch, even after native capture',async()=>{
 const h=await representativeFixture();let tampered=false,lastRecords;
 await assert.rejects(runSceneAssembly({...h.options,onStage:async records=>{
  lastRecords=records;
  const current=records.at(-1);
  if(!tampered&&current.phase==='concept-review'&&current.state==='reserved'){
   const input=JSON.parse(await fs.readFile(path.join(h.directory,'assembly',String(current.index),'input.json')));
   const file=path.join(h.directory,input.designEvidence.cameraBasis.bundle,'cells.bin');
   const bytes=await fs.readFile(file);bytes[0]^=1;
   await fs.writeFile(file,bytes);tampered=true;
  }
 }}),/hash|identity|changed|mismatch/i);
 assert.equal(tampered,true);
 assert.equal(h.calls.length,9);
 assert.equal(lastRecords.at(-1).phase,'concept-review');
 assert.equal(lastRecords.at(-1).state,'failed');
 assert.equal(lastRecords.at(-1).invocationOutcome,'not-started');
});
test('a moved representative room retains the INITIAL floor camera for honest paired comparisons',async()=>{
 let reviewed=false;
 const h=await representativeFixture(({answer,input,options})=>{
  if(options.stageName==='concept-review'&&!reviewed){
   reviewed=true;answer.verdict='revise';answer.issues=[{id:'move-room',criterion:'core',
    evidence:'Synthetic room relocation fixture only',change:'Move the same room five blocks up without replacing the comparison camera'}];
  }
  if(options.stageName==='revise-design'){
   const next=structuredClone(input.priorPlan);
   next.scene.components.find(c=>c.id==='task0__a').at.offset[1]=20;
   answer.edit=planEdit(input.priorPlan,next);
  }
  return answer;
 });
 const result=await runSceneAssembly(h.options);
 const reviews=h.calls.filter(c=>c.phase==='concept-review');
 assert.equal(reviews.length,2);
 const original=reviews[0].input.designEvidence.cameraBasis;
 assert.equal(original.selection.selected.base,115);
 for(const review of reviews){
  assert.deepEqual(review.input.designEvidence.cameraBasis,original);
  for(const view of review.input.designEvidence.views.filter(v=>v.camera.purpose==='typical-floor'))assert.equal(view.camera.min[1],115);
 }
 assert.equal(reviews[1].input.designEvidence.kind,'native-revision');
 assert.notEqual(reviews[1].input.designEvidence.sourceHash,original.sourceHash);
 assert.equal(result.scene.components.find(c=>c.id==='task0__a').at.offset[1],20);
 const audit=await (await terminalFixture(h,result)).audit('fixed-camera-good');
 assert.equal(audit.code,0,audit.output);
});
test('durable replay reuses the identical initial geometry basis across NEW local branches without resending a call',async()=>{
 const h=await representativeFixture(),abort=new AbortController();
 const identity={requestHash:hash(request),runtimeHash:'synthetic-representative-camera-replay'};
 await assert.rejects(runDurableAssembly({...h.options,...identity,signal:abort.signal,
  onStage:async records=>{if(records.at(-1).phase==='concept-review'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
 assert.equal(h.calls.length,10);
 const basis=structuredClone(h.calls.at(-1).input.designEvidence.cameraBasis),captures=h.uploads.length;
 const result=await runDurableAssembly({...h.options,...identity});
 assert.equal(h.calls.length,16);
 assert.equal(new Set(h.calls.map(c=>c.index)).size,16);
 assert.equal(result.summary.reservedCalls,16);
 assert.equal(h.uploads.length,captures+1);
 assert.deepEqual(h.calls.findLast(c=>c.phase==='review').input.designEvidence.cameraBasis,basis);
 assert.equal((await fs.readdir(path.join(h.directory,'assembly-camera-bases'))).length,1);
 const done=await runDurableAssembly({...h.options,...identity});
 const {lastAcceptedDirectory:beforeDirectory,...beforeSummary}=result.summary;
 const {lastAcceptedDirectory:afterDirectory,...afterSummary}=done.summary;
 assert.deepEqual(afterSummary,beforeSummary);
 assert.notEqual(beforeDirectory,afterDirectory);
 for(const name of ['manifest.json','cells.bin','source-owners.bin','design-sources.json'])
  assert.equal(hash(await fs.readFile(path.join(beforeDirectory,name))),hash(await fs.readFile(path.join(afterDirectory,name))));
 assert.equal(h.calls.length,16);
 assert.equal(h.uploads.length,captures+1);
 const basisFile=path.join(h.directory,path.posix.dirname(basis.sceneFile),'basis.json');
 await fs.writeFile(basisFile,JSON.stringify({...basis,selection:{...basis.selection,status:'invented'}}));
 await assert.rejects(runDurableAssembly({...h.options,...identity}),/Immutable camera subject conflict/);
 assert.equal(h.calls.length,16);assert.equal(h.uploads.length,captures+1);
});
test('terminal audit independently reconstructs representative geometry and rejects forged basis or final claims',async()=>{
 const h=await representativeFixture(),result=await runSceneAssembly(h.options);
 const terminal=await terminalFixture(h,result),good=await terminal.audit('representative-good');
 assert.equal(good.code,0,good.output);
 assert.equal(good.report.additionalModelCalls,0);
 const basis=h.calls.find(c=>c.phase==='concept-review').input.designEvidence.cameraBasis;
 const file=path.join(h.directory,path.posix.dirname(basis.sceneFile),'basis.json'),bytes=await fs.readFile(file);
 const forged=JSON.parse(bytes);forged.selection.selected.base=110;
 const {basisHash,...content}=forged;forged.basisHash=hash(content);
 await fs.writeFile(file,JSON.stringify(forged));
 const bad=await terminal.audit('forged-basis');assert.notEqual(bad.code,0);assert.match(bad.output,/original saved geometry/);
 await fs.writeFile(file,bytes);
 const jobFile=path.join(h.directory,'job.json'),job=JSON.parse(await fs.readFile(jobFile));
 job.assemblySummary.cameraEvidence.functionVerified=true;
 await fs.writeFile(jobFile,JSON.stringify(job));
 const claim=await terminal.audit('forged-camera-claim');assert.notEqual(claim.code,0);assert.match(claim.output,/Final camera summary differs/);
});
