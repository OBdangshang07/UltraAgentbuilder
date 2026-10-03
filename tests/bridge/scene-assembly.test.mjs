import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {startBridge} from '../../bridge/server.mjs';import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';import {qualityTiers} from '../../bridge/quality-tiers.mjs';
import {assemblyPlan,packageEdit,packageResponse,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {CompletedResponseFormatError,parseModelJson} from '../../bridge/model-json.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {storeyFacade} from '../design/storey-layout-fixtures.mjs';
import {floorAssemblyPlan} from '../design/floor-components-fixtures.mjs';
const request={agent:'deepseek',model:'offline',effort:'max',prompt:'16×10×16格边界的原创公共建筑，完整内饰和通路',generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyConfirmed:true,maxRepairs:0};
const parse=input=>JSON.parse(input.prompt.split('Assembly input (data):\n').at(-1));
function crowdedPlan(count=254){
 const p=assemblyPlan();
 const sample=packageEdit({previousDraft:p.scene,task:p.packages[0]}).components.put[0];
 for(let i=0;p.scene.components.length<count;i++)p.scene.components.push({...structuredClone(sample),id:'filler'+i,size:[1,1,1],at:{relativeTo:null,anchor:'min',offset:[3+i%10,5+Math.floor(i/100),3+Math.floor(i/10)%10]}});
 return p;
}
function response(input){const data=parse(input),kind=input.outputSchema.properties.format.enum[0];return kind==='SceneAssemblyPlan'?assemblyPlan():kind==='SceneAssemblyPlanEdit'?planEdit(data.priorPlan,assemblyPlan()):kind==='SceneAssemblyPlanRepair'?{format:'SceneAssemblyPlanRepair',version:1,planHash:data.planHash,proposal:assemblyPlan()}:kind==='SceneAssemblyReview'?acceptReview(data):packageEdit(data);}
async function harness(generate=async input=>({spec:response(input)})){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-assembly-')),received=[];
 const adapter={close(){},async generate(input){received.push(input);return generate(input,received.length);}};
 let bridge=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter});
 const call=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+bridge.connection.port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};};
 const finish=async id=>{for(let i=0;i<500;i++){const j=await call('/v1/jobs/'+id);if(['preview-ready','failed','cancelled','interrupted'].includes(j.state))return j;await delay(20);}throw new Error('Offline assembly timeout');};
 return {dataDir,received,call,finish,async close(){await bridge.close();},async restart(){await bridge.close();bridge=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter});}};
}
test('scope corrections stop at the original per-package allowance and preserve the accepted source',async()=>{
 const h=await harness(async(input,n)=>{
  const spec=response(input);if(n>1)spec.components.put[0].id='foreign__attempt'+n;
  return {spec};
 });
 try{
  const j=await h.finish((await h.call('/v1/jobs',{...request,key:'scope-budget'})).id);
  assert.equal(j.state,'failed');assert.equal(j.assemblyCallsReserved,3);assert.equal(j.manifest,undefined);
  assert.deepEqual(j.assemblyStages.map(s=>s.state),['accepted','rejected','rejected']);
  assert.equal(j.assemblyStages[1].sourceHash,j.assemblyStages[0].sourceHash);assert.equal(j.assemblyStages[2].sourceHash,j.assemblyStages[0].sourceHash);
  assert.match(j.error,/Required package exterior failed/);assert.equal(h.received.length,3);
 }finally{await h.close();}
});

test('provider failure durably stops recovery status without discarding reservations or retrying on restart',async()=>{
 const h=await harness(async(input,n)=>{
  const saved=JSON.parse(await fs.readFile(path.join(input.cwd,'job.json'),'utf8'));
  assert.equal(saved.recovery.reservedCalls,n);
  if(n===2)throw new Error('Offline provider usage limit fixture');
  return {spec:response(input)};
 });
 try{
  const j=await h.finish((await h.call('/v1/jobs',{...request,key:'terminal-recovery',assemblyRecovery:'safe'})).id);
  assert.equal(j.state,'failed');assert.match(j.error,/usage limit/);assert.equal(j.recovery.state,'failed');assert.equal(j.recovery.reservedCalls,2);
  assert.match(j.recovery.branch,/^assembly-run-/);assert.equal(j.assemblyCallsReserved,2);assert.equal(j.manifest,undefined);
  assert.equal(j.assemblyStages.at(-1).invocationOutcome,'unknown');assert.equal(j.generations.at(-1).usage,null);
  await h.restart();const again=await h.call('/v1/jobs/'+j.id);assert.equal(again.state,'failed');assert.equal(again.recovery.state,'failed');assert.equal(h.received.length,2);
 }finally{await h.close();}
});

test('tier preflight distinguishes call budgets from review rounds and omits token override',()=>{
 for(const [i,tier] of qualityTiers().entries()){const p=generationPreflight({...request,qualityTier:tier.id});assert.equal(p.maximumCalls,[8,14,20,26][i]);assert.equal(p.assembly.reviewRounds,i+1);assert.equal(p.maxOutputTokens,null);assert.equal(p.assembly.visualReview,false);}
 const p=generationPreflight({...request,qualityTier:'ultra',assemblyCalls:4});assert.equal(p.maximumCalls,4);assert.equal(p.assembly.maxPackages,2);
 for(const delta of [{qualityTier:'unknown'},{assemblyCalls:3},{assemblyCalls:99},{assemblyConfirmed:'yes'},{sample:false},{baseJobId:'x'},{checkpointCalls:2},{maxRepairs:1},{generationMode:'single'},{sceneWorkflow:'checkpoints'},{sceneWorkflow:undefined}])assert.throws(()=>generationPreflight({...request,...delta}));
});
test('complete assembly uses exact hashes and durable reservations; partial snapshots never import',async()=>{
 const h=await harness(async(input,n)=>{const saved=JSON.parse(await fs.readFile(path.join(input.cwd,'job.json'),'utf8'));assert.equal(saved.assemblyCallsReserved,n);assert.equal(saved.assemblyStages.at(-1).state,'reserved');return {spec:response(input),usage:{totalTokens:10}};});
 try{
  assert.equal((await h.call('/v1/quality-tiers')).tiers.length,4);assert.equal((await h.call('/v1/preflight',request)).maximumCalls,8);assert.equal(h.received.length,0);
  assert.equal((await h.call('/v1/jobs',{...request,key:'no-confirm',assemblyConfirmed:false})).status,400);
  const input={...request,key:'complete'},jobs=await Promise.all([h.call('/v1/jobs',input),h.call('/v1/jobs',input)]);assert.equal(jobs[0].id,jobs[1].id);
  const j=await h.finish(jobs[0].id);assert.equal(j.state,'preview-ready',j.error);assert.equal(j.assemblyCallsReserved,4);assert.equal(j.assemblySummary.reviewRounds,1);assert.equal(j.assemblySummary.visualReview,false);
  assert.deepEqual(j.assemblyStages.map(s=>s.phase),['plan','component','component','review']);assert.equal(j.generations.length,4);assert.equal(j.usage,undefined);assert.equal(j.assemblySummary.finalTextReviewCurrent,true);assert.equal(j.assemblySummary.finalTextReviewAccepted,true);assert.deepEqual(j.assemblySummary.unresolvedReviewIssues,[]);
  const dir=path.join(h.dataDir,'jobs',j.id);await assert.rejects(readNativeBundle(path.join(dir,'assembly/2/diagnostic')),/Diagnostic-only/);
  assert.equal((await h.call('/v1/jobs/'+j.id+'/bundle',{})).status,200);await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,4);
 }finally{await h.close();}
});
test('224 metre skeleton retains full height and functional routes through package assembly',async()=>{
 const h=await harness(async input=>({spec:input.outputSchema.properties.format.enum[0]==='SceneAssemblyPlan'?assemblyPlan(true):response(input)}));
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'tower',prompt:'32×224×32格边界，实际高度224米的办公塔楼'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(j.manifest.dimensions.height,224);assert.equal(j.manifest.quality.navigation,'verified');assert.equal(h.received.length,4);}
 finally{await h.close();}
});
test('224m storey layout correction completes the same assembly and native import without authority or budget changes',async()=>{
 const original=assemblyPlan(true);
 original.scene.components.push(storeyFacade('skin','main','south',{floors:{first:0,count:44},columns:{width:4,gap:2,count:5,align:'center'}}));
 const valid=structuredClone(original);valid.scene.components.at(-1).columns.count='fit';
 const h=await harness(async(input,n)=>{
  const data=parse(input),kind=input.outputSchema.properties.format.enum[0];
  assert.match(input.prompt,/storeyFacade/);
  if(n===1)return {spec:original};
  if(kind==='SceneAssemblyPlanEdit'){
   assert.equal(data.feedback.constructionFeedback.issues[0].layoutFeedback.rule,'columns');
   assert.equal(data.feedback.constructionFeedback.issues[0].occurrences,1);
   return {spec:planEdit(data.priorPlan,valid)};
  }
  return {spec:response(input)};
 });
 try{
  const input={...request,key:'storey-layout-correction',qualityTier:'ultra',assemblyCalls:26,assemblyRecovery:'safe',prompt:'32×224×32格边界，高224米，离线参数布置工程测试'};
  const j=await h.finish((await h.call('/v1/jobs',input)).id);
  assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyCallsReserved,5);assert.equal(j.recovery.state,'complete');
  assert.deepEqual(j.assemblyStages.map(s=>s.phase),['plan','correct-plan','component','component','review']);
  assert.equal(j.manifest.quality.navigation,'verified');assert.equal(j.manifest.dimensions.height,224);
  const bundle=await h.call('/v1/jobs/'+j.id+'/bundle',{}),native=await readNativeBundle(bundle.directory);
  assert.equal(native.scene.components.find(c=>c.id==='skin').kind,'storeyFacade');assert.equal(native.designSources.parametricLayouts[0].expandedPanelChecks,176);
  assert.equal(native.designSources.parametricLayouts[0].canAuthorizePlacement,false);
  assert.deepEqual(native.scene.bounds,original.scene.bounds);assert.deepEqual(native.scene.constraints,original.scene.constraints);
  const root=path.join(h.dataDir,'jobs',j.id,'assembly');
  // Durable branches preserve the failed raw answer, never rewrite it as a pass.
  const branch=j.recovery.branch?path.join(h.dataDir,'jobs',j.id,j.recovery.branch,'assembly'):root;
  assert.equal(JSON.parse(await fs.readFile(path.join(branch,'1/response.json'),'utf8')).scene.components.at(-1).columns.count,5);
  assert.equal(JSON.parse(await fs.readFile(path.join(branch,'2/plan.json'),'utf8')).scene.components.at(-1).columns.count,'fit');
  // The public ledger, dedup key and native source survive a service restart.
  await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,5);
 }finally{await h.close();}
});
test('a geometry correction consumes reserved budget, not a fresh hidden retry',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===2)r.components.put[0].at.offset=[14,0,14];return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'correct'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[1].state,'rejected');assert.equal(j.assemblyStages[2].phase,'correct-component');}
 finally{await h.close();}
});
test('floor-linked core error is corrected within the same package, budget and persisted job',async()=>{
 const p=floorAssemblyPlan();
 const h=await harness(async(input,n)=>{
  assert.match(input.prompt,/storeyRoom/);assert.match(input.prompt,/storeyOpening/);
  if(n===1)return {spec:p};
  const data=parse(input),r=response(input);
  if(data.task?.id==='exterior'){
   r.components.put=[{...data.previousDraft.components.find(c=>c.id==='corePortals'),width:5,height:n===2?8:3}];
   if(n===3){assert.equal(data.critique.feedback.constructionFeedback.issues[0].layoutFeedback.rule,'opening');assert.deepEqual(data.task,p.packages[0]);assert.equal(input.outputSchema.properties.format.enum[0],'ScenePackageRepair');}
  }
  return {spec:packageResponse(data,r)};
 });
 try{
  const input={...request,key:'floor-package',assemblyRecovery:'safe',prompt:'32×224×32格边界，高224米，离线核心筒楼层接口测试'};
  const j=await h.finish((await h.call('/v1/jobs',input)).id);
  assert.equal(j.state,'preview-ready',j.error);assert.equal(j.assemblyCallsReserved,5);assert.equal(j.recovery.state,'complete');
  assert.deepEqual(j.assemblyStages.map(s=>s.phase),['plan','component','correct-component','component','review']);
  assert.equal(j.manifest.quality.navigation,'verified');
  const native=await readNativeBundle((await h.call('/v1/jobs/'+j.id+'/bundle',{})).directory);
  assert.deepEqual(native.designSources.parametricLayouts.map(e=>e.expandedInstanceChecks),[44,44]);
  assert.deepEqual(native.scene.components.find(c=>c.id==='main'),p.scene.components.find(c=>c.id==='main'));
  assert.deepEqual(native.scene.constraints,p.scene.constraints);
  await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,5);
 }finally{await h.close();}
});
test('a package can construct a floor-aligned facade only on its approved host and world region',async()=>{
 const p=assemblyPlan(true);p.packages[0].editableComponents=['main'];p.packages[0].regions=[{origin:[2,0,29],size:[28,224,1]}];
 const h=await harness(async(input,n)=>{
  if(n===1)return {spec:p};
  const data=parse(input),r=response(input);
  if(data.task?.id==='exterior'){
   r.components.put=[storeyFacade('exterior__skin','main','south',{floors:{first:0,count:44},insets:n===2?[0,0]:[1,0]})];
   if(n===3){assert.equal(data.critique.feedback.constructionFeedback.issues[0].layoutFeedback.rule,'insets');assert.deepEqual(data.task,p.packages[0]);}
  }
  return {spec:r};
 });
 try{
  const j=await h.finish((await h.call('/v1/jobs',{...request,key:'storey-package',prompt:'32×224×32格边界，高224米，离线组件布置测试'})).id);
  assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[2].phase,'correct-component');
  const native=await readNativeBundle((await h.call('/v1/jobs/'+j.id+'/bundle',{})).directory);
  assert.equal(native.designSources.parametricLayouts[0].component,'exterior__skin');assert.equal(native.designSources.parametricLayouts[0].rows.length,44);
 }finally{await h.close();}
});

test('deleting a shared dependency target is rejected then corrected from the accepted baseline',async()=>{
 const h=await harness(async(input,n)=>{
  if(n===1){const p=assemblyPlan(),part=packageEdit({previousDraft:p.scene,task:p.packages[0]}).components.put[0];p.scene.components[0].allowOverwrite.push(part.id);p.scene.components.push(part);p.scene.featureBindings.push({feature:'Original accent retained by its stable identity',components:[part.id]});p.packages[0].editableComponents=[part.id];return {spec:p};}
  const r=response(input);
  if(n===2){assert.match(input.prompt,/REFERENCE LIFETIME/);r.components={put:[],remove:['exterior__detail']};}
  if(n===3){const data=parse(input);assert.equal(data.previousDraft.components.some(c=>c.id==='exterior__detail'),true);assert.match(data.critique.feedback.error,/Unknown component reference: exterior__detail/);}
  return {spec:r};
 });
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'frozen-feature-removal'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[1].state,'rejected');assert.equal(j.assemblyStages[2].phase,'correct-component');assert.equal(j.assemblyStages[2].state,'accepted');}
 finally{await h.close();}
});
test('insufficient budget never publishes a skeleton or permits failed repair/local revalidation',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===2)r.components.put[0].at.offset=[14,0,14];return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'too-low',assemblyCalls:4})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,2);assert.equal(j.manifest,undefined);assert.equal((await h.call('/v1/jobs/'+j.id+'/repair-context')).status,400);
  const retry=await h.finish((await h.call('/v1/jobs',{key:'local',revalidateJobId:j.id})).id);assert.equal(retry.state,'failed');assert.match(retry.error,/Intermediate/);assert.equal(h.received.length,2);
 }finally{await h.close();}
});
test('provider error keeps unknown reservation, stops without another task and survives restart',async()=>{
 const h=await harness(async()=>{throw Object.assign(new Error('Safe provider failure'),{diagnostic:{reason:'error',providerFailure:{code:'QUOTA',status:402},usage:null}});});
 try{const input={...request,key:'provider'},j=await h.finish((await h.call('/v1/jobs',input)).id);assert.equal(j.state,'failed');assert.equal(j.assemblyCallsReserved,1);assert.equal(j.assemblyStages[0].invocationOutcome,'unknown');assert.equal(j.generationDiagnostic.providerFailure.status,402);await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,1);}
 finally{await h.close();}
});
test('rejected review candidate leaves the last accepted assembled building unchanged',async()=>{
 const h=await harness(async(input,n)=>{const data=parse(input),r=response(input);if(n===4)return {spec:{...r,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'facade',evidence:'exterior__detail lacks depth',change:'Adjust bounded accent'}]}};if(n===5)r.components.put[0].at.offset=[14,0,14];return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'keep-best'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblySummary.stopReason,'candidate-rejected-previous-preserved');
  const source=await h.call('/v1/jobs/'+j.id+'/scene');assert.ok(JSON.stringify(source).includes('exterior__detail'));assert.equal(j.assemblySummary.aestheticQualityVerified,false);
 }finally{await h.close();}
});
test('cancelled calls and startup interruptions cannot resume generation implicitly',async()=>{
 const h=await harness(async(input,n)=>{if(n===1)return {spec:response(input)};await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));});
 try{const input={...request,key:'cancel'},j=await h.call('/v1/jobs',input);for(let i=0;i<200&&h.received.length<2;i++)await delay(20);assert.equal(h.received.length,2);await h.call('/v1/jobs/'+j.id+'/cancel',{});const final=await h.finish(j.id);assert.equal(final.state,'cancelled');assert.equal(final.assemblyStages[1].invocationOutcome,'unknown');await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,2);
  const id='bbbbbbbb-2222-4222-8222-aaaaaaaaaaaa',dir=path.join(h.dataDir,'jobs',id);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'job.json'),JSON.stringify({id,key:'crash',state:'generating',events:[],assemblyCallsReserved:1,assemblyStages:[{index:1,phase:'plan',state:'reserved'}]}));await h.restart();const interrupted=await h.call('/v1/jobs/'+id);assert.equal(interrupted.state,'interrupted');assert.equal(interrupted.assemblyStages[0].state,'interrupted');assert.equal(interrupted.assemblyStages[0].invocationOutcome,'unknown');
 }finally{await h.close();}
});
test('max and ultra run distinct multi-round review/refinement bounded by the shared tier',async()=>{
 for(const tier of qualityTiers().slice(2)){
  const h=await harness(async input=>{const r=response(input);if(r.format==='SceneAssemblyReview')return {spec:{...r,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'exterior__detail contrast',change:'Adjust material within its bounded region'}]}};return {spec:r};});
  try{
   const j=await h.finish((await h.call('/v1/jobs',{...request,key:'multi-'+tier.id,qualityTier:tier.id})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,3+2*tier.reviewRounds);assert.equal(j.assemblySummary.reviewRounds,tier.reviewRounds);
   assert.equal(j.assemblyStages.filter(s=>s.phase==='refine-component').length,tier.reviewRounds);assert.equal(j.assemblySummary.finalTextReviewCurrent,false);assert.equal(j.assemblySummary.finalTextReviewAccepted,false);assert.equal(j.assemblySummary.unresolvedReviewIssues.length,1);
  }finally{await h.close();}
 }
});
test('total call ceiling stops actionable reviews without silently requesting refinements',async()=>{
 const h=await harness(async input=>{const r=response(input);if(r.format==='SceneAssemblyReview')return {spec:{...r,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'exterior__detail',change:'Adjust contrast'}]}};return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'ceiling',assemblyCalls:4})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,4);assert.equal(j.assemblySummary.stopReason,'revision-budget');assert.equal(j.assemblySummary.finalTextReviewCurrent,true);assert.equal(j.assemblySummary.finalTextReviewAccepted,false);}
 finally{await h.close();}
});

test('safe optional refinement ends an A-B-A geometry cycle with the current reviewed building and warnings intact',async()=>{
 const hashes=[];
 const h=await harness(async input=>{
  const r=response(input);
  if(r.format==='SceneAssemblyReview'){
   const data=parse(input);hashes.push(data.sourceHash);
   assert.equal(data.feedback.navigationFeedback.movementModel.unverifiedIsBlockedProof,false);
   assert.match(input.prompt,/Zero local routes on partial stair blocks does NOT prove a broken stair/);
   return {spec:{...r,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'Offline oscillating preference',change:'Toggle accent material'}]}};
  }
  return {spec:r};
 });
 try{
  const input={...request,key:'safe-cycle',qualityTier:'ultra',assemblyRecovery:'safe'};
  const j=await h.finish((await h.call('/v1/jobs',input)).id);
  assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,8);
  assert.equal(hashes.length,3);assert.equal(hashes[0],hashes[2]);assert.notEqual(hashes[0],hashes[1]);
  assert.equal(j.assemblyStages.filter(s=>s.phase==='refine-component').length,2);
  assert.equal(j.assemblySummary.stopReason,'refinement-cycle-previous-preserved');
  assert.equal(j.assemblySummary.finalTextReviewCurrent,true);assert.equal(j.assemblySummary.finalTextReviewAccepted,false);
  assert.equal(j.assemblySummary.unresolvedReviewIssues.length,1);
  assert.deepEqual(j.assemblySummary.completedPackages,['exterior','interior']);
  const cycle=j.assemblySummary.refinementCycle;assert.equal(cycle.firstReviewStage,4);assert.equal(cycle.repeatedReviewStage,8);assert.equal(cycle.canAuthorizePlacement,false);
  const root=path.join(h.dataDir,'jobs',j.id,j.recovery.branch,'assembly');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'8/refinement-cycle.json'),'utf8')),cycle);
  const native=await readNativeBundle((await h.call('/v1/jobs/'+j.id+'/bundle',{})).directory);
  assert.equal(native.manifest.scene.sourceHash,hashes[2]);assert.equal(hash(native.scene),hashes[2]);
  await assert.rejects(readNativeBundle(path.join(root,'7/diagnostic')),/Diagnostic-only/);
  await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,8);
 }finally{await h.close();}
});

test('safe optional no-op preserves the current reviewed asset; fresh acceptance on a repeated geometry still wins',async()=>{
 for(const accept of [false,true]){
  let reviews=0;
  const h=await harness(async input=>{
   const r=response(input),data=parse(input);
   if(r.format==='SceneAssemblyReview'){
    reviews++;
    return {spec:accept&&reviews===3?r:{...r,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'Offline preference only',change:'Optional contrast edit'}]}};
   }
   if(data.refinement&&!accept)r.components.put=[];
   return {spec:r};
  });
  try{
   const j=await h.finish((await h.call('/v1/jobs',{...request,key:'safe-noop-'+accept,qualityTier:'ultra',assemblyRecovery:'safe'})).id);
   assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,accept?8:5);assert.equal(reviews,accept?3:1);
   assert.equal(j.assemblySummary.stopReason,accept?'text-review-accepted':'candidate-no-progress-previous-preserved');
   assert.equal(j.assemblySummary.finalTextReviewCurrent,true);assert.equal(j.assemblySummary.finalTextReviewAccepted,accept);
   assert.equal(j.assemblySummary.unresolvedReviewIssues.length,accept?0:1);
   if(!accept){assert.equal(j.assemblyStages.at(-1).state,'rejected');assert.equal(j.assemblyStages.at(-1).error,'Package made no actual block/material change');}
  }finally{await h.close();}
 }
});
test('one reserved plan geometry correction can proceed without lowering size or interfaces',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===1)r.scene.components[0].size=[12,11,12];return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'plan-correction'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[0].state,'rejected');assert.equal(j.assemblyStages[1].phase,'correct-plan');}
 finally{await h.close();}
});
test('stale component edits and invalid review responses halt without corrective provider retry',async()=>{
 for(const stopAt of [2,4]){
  const h=await harness(async(input,n)=>{const r=response(input);if(n===stopAt)r.sourceHash='0'.repeat(64);return {spec:r};});
  try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'stale-'+stopAt})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,stopAt);assert.equal(j.manifest,undefined);assert.equal(j.assemblyStages.at(-1).state,'failed');}
  finally{await h.close();}
 }
});

test('corrected plan re-proposes interfaces before freezing, persists edit/merged plan and reserves once',async()=>{
 const h=await harness(async(input,n)=>{
  const r=response(input);if(n===1)r.scene.components[0].size[1]=11;
  if(n===2){const d=parse(input),target=assemblyPlan();target.scene.constraints.passages.push({origin:[5,1,4],size:[1,2,1]});target.packages[1].interfaces=[1];assert.equal(d.planHash,r.planHash);return {spec:planEdit(d.priorPlan,target)};}
  return {spec:r};
 });
 try{
  const j=await h.finish((await h.call('/v1/jobs',{...request,key:'replan-interfaces'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);
  const root=path.join(h.dataDir,'jobs',j.id,'assembly'),read=async f=>JSON.parse(await fs.readFile(path.join(root,f),'utf8'));
  assert.equal((await read('2/response.json')).format,'SceneAssemblyPlanEdit');assert.equal((await read('2/plan.json')).format,'SceneAssemblyPlan');
  assert.equal((await read('2/changes.json')).constraints.after.passages.length,2);assert.equal((await read('interfaces.json')).interfacesFrozen,true);
  assert.equal(j.assemblyStages[1].basePlanHash,(await read('2/input.json')).planHash);assert.equal((await read('1/response.json')).scene.components[0].size[1],11);
 }finally{await h.close();}
});

test('plan corrections cannot undercut actual height, replay stale proposals, or consume unreserved work',async()=>{
 for(const variant of ['stale','short','no-budget']){
  const h=await harness(async(input,n)=>{const r=response(input);if(n===1)r.scene.components[0].size[1]=11;if(n===2){if(variant==='stale')r.planHash='0'.repeat(64);if(variant==='short')r.sceneEdit.components.put[0].size[1]=9;}return {spec:r};});
  try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:variant,prompt:'16×10×16格边界，实际高度10米，完整内饰和通行',assemblyCalls:variant==='no-budget'?4:8})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,variant==='no-budget'?1:2);assert.equal(j.manifest,undefined);if(variant==='short')assert.match(j.error,/height/);}
  finally{await h.close();}
 }
});

test('completed JSON failure receives one budgeted correction, preserves failed usage and original scope',async()=>{
 for(const failAt of [1,2,4]){
  const h=await harness(async(input,n)=>{if(n===failAt)throw await completedFormatError(input.cwd,CompletedResponseFormatError,parseModelJson);return {spec:response(input),usage:{totalTokens:10}};});
  try{const input={...request,key:'format-'+failAt},j=await h.finish((await h.call('/v1/jobs',input)).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyCallsReserved,5);assert.equal(j.generations.length,5);assert.equal(j.generations[failAt-1].usage.totalTokens,17);assert.equal(j.generations[failAt-1].outcome,'failed');assert.equal(j.usage,undefined);
   assert.equal(j.assemblyStages[failAt-1].invocationOutcome,'completed-invalid-json');assert.equal(j.assemblyStages[failAt].formatCorrectionOf,failAt);assert.equal(j.assemblySummary.formatCorrections,1);
   const {formatCorrection,...corrected}=parse(h.received[failAt]);assert.deepEqual(corrected,parse(h.received[failAt-1]));assert.ok(formatCorrection.originalText.includes('离线格式错误'));assert.ok(!JSON.stringify(j).includes('离线格式错误'));
   await h.restart();assert.equal((await h.call('/v1/jobs',input)).id,j.id);assert.equal(h.received.length,5);
  }finally{await h.close();}
 }
});
test('format correction never bypasses budgets, uncertain outcomes, cancellation, evidence or edit identity',async()=>{
 for(const variant of ['twice','no-budget','provider','truncated','storage','tampered','cancelled','stale']){
  const h=await harness(async(input,n)=>{
   if(n===1||variant==='twice'){
    const e=await completedFormatError(input.cwd,CompletedResponseFormatError,parseModelJson);
    if(variant==='provider')e.diagnostic.reason='error';if(variant==='truncated')e.diagnostic.reason='max-tokens';if(variant==='storage')e.diagnostic.failureKind='evidence-storage';if(variant==='tampered')e.diagnostic.receivedTextSha256='0'.repeat(64);
    if(variant==='cancelled')await new Promise((resolve,reject)=>input.signal.addEventListener('abort',()=>reject(e),{once:true}));throw e;
   }
   const r=response(input);if(variant==='stale'&&n===3)r.sourceHash='0'.repeat(64);return {spec:r};
  });
  try{const j0=await h.call('/v1/jobs',{...request,key:variant,assemblyCalls:variant==='no-budget'?4:8});
   if(variant==='cancelled'){for(let i=0;i<100&&!h.received.length;i++)await delay(20);await delay(20);await h.call('/v1/jobs/'+j0.id+'/cancel',{});}
   const j=await h.finish(j0.id);assert.equal(j.state,variant==='cancelled'?'cancelled':'failed');assert.equal(j.manifest,undefined);assert.equal(h.received.length,variant==='twice'?2:variant==='stale'?3:1,variant);
  }finally{await h.close();}
 }
});

test('contract-invalid plan is repaired then assembled in the same budget with durable rejected evidence',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===1){r.scene.components[0].wrong=true;r.scene.components[0].extra=1;}return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'contract-plan'})).id);assert.equal(j.state,'preview-ready',j.error);assert.deepEqual(j.assemblyStages.map(s=>s.phase),['plan','repair-plan','component','component','review']);assert.equal(j.assemblyStages[0].state,'rejected');
  const d=parse(h.received[1]);assert.equal(d.feedback.contract.issues.length,2);assert.equal(d.planHash,hash(d.priorPlan));assert.equal(h.received.length,5);
  const root=path.join(h.dataDir,'jobs',j.id,'assembly');assert.equal(JSON.parse(await fs.readFile(path.join(root,'1/response.json'),'utf8')).scene.components[0].wrong,true);assert.equal(JSON.parse(await fs.readFile(path.join(root,'2/changes.json'),'utf8')).unapprovedContractRepair,true);
 }finally{await h.close();}
});
test('component and review contract failures receive bounded corrections without changing the baseline',async()=>{
 for(const failAt of [2,4]){const h=await harness(async(input,n)=>{const r=response(input);if(n===failAt)r.extra=true;return {spec:r};});
  try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'contract-'+failAt})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[failAt].phase,failAt===2?'correct-component':'correct-review');assert.equal(parse(h.received[failAt]).sourceHash,parse(h.received[failAt-1]).sourceHash);}
  finally{await h.close();}}
});
test('ultra can correct successive total-plan errors while preserving required component/review budget',async()=>{
 const h=await harness(async(input,n)=>{const data=parse(input);let p=assemblyPlan();if(n===1){p.scene.components[0].extra=true;return {spec:p};}if(n===2){p.scene.components[0].size[1]=11;return {spec:{format:'SceneAssemblyPlanRepair',version:1,planHash:data.planHash,proposal:p}};}return {spec:response(input)};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'successive',qualityTier:'ultra'})).id);assert.equal(j.state,'preview-ready',j.error);assert.deepEqual(j.assemblyStages.slice(0,4).map(s=>s.phase),['plan','repair-plan','correct-plan','component']);assert.equal(h.received.length,6);assert.equal(j.preflight.assembly.maximumPlanCorrections,4);}
 finally{await h.close();}
});
test('invalid plans stop on insufficient budget, repeated no-progress or identity-changing replacement',async()=>{
 for(const variant of ['budget','repeat','identity']){
  const h=await harness(async(input,n)=>{const p=assemblyPlan();p.scene.components[0].extra=true;if(n===1)return {spec:p};const d=parse(input),r=response(input);if(variant==='repeat')r.proposal=p;if(variant==='identity')r.proposal.scene.seed++;return {spec:r};});
  try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:variant,qualityTier:'ultra',assemblyCalls:variant==='budget'?4:26})).id);assert.equal(j.state,'failed');assert.equal(h.received.length,variant==='budget'?1:variant==='identity'?2:3);assert.equal(j.manifest,undefined);if(variant==='repeat')assert.match(j.error,/no progress/);}
  finally{await h.close();}
 }
});

test('completed repair that paraphrases frozen intent is rejected then corrected in the original budget',async()=>{
 for(const field of ['designIntent','design']){
  const baseline=assemblyPlan();baseline.packages[0].editableComponents=['not_in_source'];
  const h=await harness(async(input,n)=>{
   const data=parse(input);
   if(n===1)return {spec:baseline};
   if(n===2){assert.equal(data.feedback.contract.issues[0].code,'unknown-component-owner');const r=response(input);if(field==='designIntent')r.proposal.designIntent+=' paraphrased';else r.proposal.scene.design.features[0]+=' paraphrased';return {spec:r};}
   if(n===3){assert.equal(hash(data.priorPlan),hash(baseline));assert.equal(data.feedback.contract.issues[0].code,'frozen-plan-intent');assert.ok(data.rejectedResponse);assert.equal(data.planHash,hash(baseline));}
   return {spec:response(input)};
  });
  try{
   const j=await h.finish((await h.call('/v1/jobs',{...request,key:'intent-repair-'+field,qualityTier:'ultra',assemblyRecovery:'safe'})).id);
   assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,6);assert.equal(j.assemblyCallsReserved,6);
   assert.deepEqual(j.assemblyStages.slice(0,3).map(s=>s.state),['rejected','rejected','accepted']);
   assert.equal(j.assemblyStages[1].invocationOutcome,'response-received');
   const root=path.join(h.dataDir,'jobs',j.id,j.recovery.branch,'assembly');
   const original=JSON.parse(await fs.readFile(path.join(root,'2/response.json'),'utf8'));
   assert.ok(JSON.stringify(original).includes('paraphrased'));
   const accepted=JSON.parse(await fs.readFile(path.join(root,'3/plan.json'),'utf8'));
   assert.deepEqual(accepted.scene.design,baseline.scene.design);assert.equal(accepted.designIntent,baseline.designIntent);
   await h.restart();assert.equal((await h.call('/v1/jobs/'+j.id)).state,'preview-ready');assert.equal(h.received.length,6);
  }finally{await h.close();}
 }
});

test('repeated frozen-intent rewrites stop without adopting the changed design or retrying after restart',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===1)r.packages[0].editableComponents=['not_in_source'];else r.proposal.scene.design.concept+=' forbidden';return {spec:r};});
 try{
  const j=await h.finish((await h.call('/v1/jobs',{...request,key:'repeat-frozen-intent',qualityTier:'ultra'})).id);
  assert.equal(j.state,'failed');assert.equal(h.received.length,3);assert.match(j.error,/no progress/);assert.equal(j.manifest,undefined);
  assert.deepEqual(parse(h.received[2]).priorPlan.scene.design,assemblyPlan().scene.design);
  await h.restart();assert.equal((await h.call('/v1/jobs/'+j.id)).state,'failed');assert.equal(h.received.length,3);
 }finally{await h.close();}
});

test('a relationally invalid geometry delta can be repaired without freezing invalid interfaces',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===1)r.scene.components[0].size[1]=11;if(n===2)r.packages.put=[{...assemblyPlan().packages[1],interfaces:[255]}];return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'delta-relations',qualityTier:'ultra'})).id);assert.equal(j.state,'preview-ready',j.error);assert.deepEqual(j.assemblyStages.slice(0,4).map(s=>s.phase),['plan','correct-plan','repair-plan','component']);}
 finally{await h.close();}
});

test('merged plan capacity enters proposal repair without silently truncating or dropping package changes',async()=>{
 const target=assemblyPlan();while(target.scene.palette.length<64)target.scene.palette.push({role:'unused'+target.scene.palette.length,material:'white'});
 target.packages[1].interfaces=[0];
 const h=await harness(async(input,n)=>{
  const d=parse(input);
  if(n===1){const p=structuredClone(target);p.scene.components[0].size[1]=11;return {spec:p};}
  if(n===2){const p=structuredClone(target);p.scene.palette.push({role:'overflow',material:'white'});p.packages[0].purpose='Changed package purpose retained as rejected evidence';return {spec:planEdit(d.priorPlan,p)};}
  if(n===3){assert.equal(input.outputSchema.properties.format.enum[0],'SceneAssemblyPlanRepair');assert.equal(d.priorPlan.scene.palette.length,65);assert.equal(d.priorPlan.packages[0].purpose,'Changed package purpose retained as rejected evidence');assert.ok(d.feedback.contract.issues.some(i=>i.path==='$.scene.palette'));return {spec:{format:'SceneAssemblyPlanRepair',version:1,planHash:d.planHash,proposal:target}};}
  return {spec:response(input)};
 });
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'merged-plan-capacity',qualityTier:'ultra'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,6);assert.deepEqual(j.assemblyStages.slice(0,3).map(s=>s.phase),['plan','correct-plan','repair-plan']);assert.equal(j.assemblySummary.finalTextReviewAccepted,true);
  const root=path.join(h.dataDir,'jobs',j.id,'assembly');assert.equal(JSON.parse(await fs.readFile(path.join(root,'2/plan.json'))).scene.palette.length,65);assert.equal(JSON.parse(await fs.readFile(path.join(root,'3/plan.json'))).scene.palette.length,64);
 }finally{await h.close();}
});

test('merged palette capacity feeds one bounded component correction, retaining the original baseline',async()=>{
 const h=await harness(async(input,n)=>{
  const r=response(input),d=parse(input);
  if(n===1)for(let i=r.scene.palette.length;i<64;i++)r.scene.palette.push({role:'unused'+i,material:'white'});
  if(n===2)r.palette.put=[{role:'exterior__excess',material:'white'}];
  if(n===3){assert.equal(d.capacity.collections.palette.remaining,0);assert.ok(d.critique.feedback.contract.issues.some(i=>i.path==='$.palette'));assert.equal(d.previousDraft.palette.length,64);}
  return {spec:r};
 });
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'merged-capacity'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[1].state,'rejected');assert.equal(j.assemblyStages[2].phase,'correct-component');}
 finally{await h.close();}
});

test('unowned partial-block stairs remain previewable with advisory evidence through textual review',async()=>{
 const h=await harness(async(input,n)=>{
  const r=response(input),d=parse(input);
  if(n===1){const p=assemblyPlan(true);p.scene.components.filter(c=>c.kind==='stairs').forEach(c=>c.material='oak_stairs');return {spec:p};}
  assert.equal(d.assemblyAdvisory.navigationGate,false);assert.ok(d.assemblyAdvisory.unownedUnverifiedStairs.length);
  return {spec:r};
 });
 try{
  const j=await h.finish((await h.call('/v1/jobs',{...request,key:'advisory-preview',prompt:'32×224×32格边界，实际高度224米的办公塔楼'})).id);
  assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,4);
  assert.equal(j.manifest.quality.navigation,'unverified');assert.equal(j.manifest.quality.requiresAcknowledgement,true);
  assert.equal(j.assemblySummary.finalTextReviewAccepted,true);assert.ok(j.assemblySummary.assemblyAdvisory.unownedUnverifiedStairs.length);
  const f=JSON.parse(await fs.readFile(path.join(h.dataDir,'jobs',j.id,'assembly/freeze-advisory.json'),'utf8'));
  const {evidenceHash,...body}=f;assert.equal(evidenceHash,hash(body));assert.equal(f.advisory.navigationGate,false);assert.equal(f.canAuthorizePlacement,false);
 }finally{await h.close();}
});

test('pending package component reserve rejects starvation but zero-slot review replacements remain valid',async()=>{
 const h=await harness(async(input,n)=>{
  const d=parse(input),r=response(input);
  if(n===1)return {spec:crowdedPlan()};
  if(n===2){assert.equal(d.capacity.assembly.maximumNewComponentsAtTurn,1);r.components.put.push({...structuredClone(r.components.put[0]),id:'exterior__extra',at:{relativeTo:null,anchor:'min',offset:[1,0,0]}});}
  if(n===3){assert.equal(d.previousDraft.components.length,254);assert.equal(d.critique.feedback.reserveCheck.accepted,false);}
  if(n===5)return {spec:{...r,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'exterior__detail contrast',change:'Replace its material'}]}};
  if(n===6){assert.equal(d.capacity.collections.components.remaining,0);assert.equal(d.capacity.assembly.reservedForPendingConstruction,0);}
  return {spec:r};
 });
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'reserve-slots'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,6);assert.equal(j.assemblyStages[1].state,'rejected');assert.equal(j.assemblyStages[2].phase,'correct-component');assert.equal(j.assemblyStages[5].state,'accepted');}
 finally{await h.close();}
});

test('provably insufficient plan slots enter the existing correction budget before ownership freezes',async()=>{
 const h=await harness(async(input,n)=>{
  if(n===1)return {spec:crowdedPlan(256)};
  if(n===2){const d=parse(input);assert.equal(d.feedback.capacity.assembly.feasible,false);await assert.rejects(fs.access(path.join(input.cwd,'assembly/interfaces.json')));return {spec:planEdit(d.priorPlan,crowdedPlan())};}
  return {spec:response(input)};
 });
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'plan-headroom'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[1].phase,'correct-plan');}
 finally{await h.close();}
});

test('Codex completed format failure is corrected inside the same budget with its private raw evidence retained',async()=>{
 const h=await harness(async(input,n)=>{if(n===2)throw await completedFormatError(input.cwd,CompletedResponseFormatError,parseModelJson,undefined,'codex');return {spec:response(input)};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,agent:'codex',key:'codex-format'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(j.assemblyCallsReserved,5);assert.equal(j.assemblySummary.formatCorrections,1);assert.equal(j.generations[1].diagnostic.provider,'codex');assert.ok(!JSON.stringify(j).includes('离线格式错误'));}
 finally{await h.close();}
});

test('same-source model scope mistakes are rejected then corrected without broadening package authority',async()=>{
 for(const variant of ['component','palette','global']){
  const h=await harness(async(input,n)=>{
   const d=parse(input),r=response(input);
   if(n===2){if(variant==='component')r.components.put[0].id='wrong__detail';if(variant==='palette')r.palette.put=[{role:'wrong__role',material:'white'}];if(variant==='global')r.featureBindings=d.previousDraft.featureBindings;}
   if(n===3){assert.equal(d.critique.feedback.contract.issues[0].code,'package-scope');assert.equal(hash(d.previousDraft),hash(assemblyPlan().scene));assert.deepEqual(d.task,assemblyPlan().packages[0]);}
   return {spec:r};
  });
  try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'scope-correct-'+variant})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[1].state,'rejected');assert.equal(j.assemblyStages[2].phase,'correct-component');}
  finally{await h.close();}
 }
});

test('same-source inconsistent review decision receives a bounded correction instead of discarding a complete building',async()=>{
 const h=await harness(async(input,n)=>{const r=response(input);if(n===4)r.task='exterior';if(n===5)assert.equal(parse(input).contractFeedback.contract.issues[0].code,'review-relations');return {spec:r};});
 try{const j=await h.finish((await h.call('/v1/jobs',{...request,key:'review-relations'})).id);assert.equal(j.state,'preview-ready',j.error);assert.equal(h.received.length,5);assert.equal(j.assemblyStages[4].phase,'correct-review');}
 finally{await h.close();}
});
