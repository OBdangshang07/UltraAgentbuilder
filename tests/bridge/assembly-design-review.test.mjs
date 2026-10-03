import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {architectureEvidence} from '../../src/design/architecture-evidence.mjs';
import {reviewPngs,validateReviewImageFiles} from '../../bridge/visual-review.mjs';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {renderOccupancyViews} from '../../src/design/occupancy-preview.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const request={agent:'codex',model:'offline',prompt:'16×10×16格边界内设计建筑，保留内饰和通路',generationMode:'scene',sceneWorkflow:'components',qualityTier:'lite',assemblyDesignReview:'images',assemblyConfirmed:true,maxRepairs:0};
const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
const concept=input=>({format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline fixture decision, not design-quality proof',issues:[]});
const issue={criterion:'facade',evidence:'main is an unarticulated solid shell in this fixture',change:'Coordinate the main shell material before ownership freezes'};
async function harness(change,delta={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-first-')),calls=[],policy=generationPreflight({...request,...delta}),controller=new AbortController();let records=[];
 return {directory,calls,policy,controller,get records(){return records;},async run(){return runSceneAssembly({directory,prompt:request.prompt,rules,policy,signal:controller.signal,
  onStage:async r=>{records=r;},invoke:async(prompt,index,options)=>{
   const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));assert.equal(records.at(-1).state,'reserved');assert.equal(records.length,index);
   calls.push({input,index,options,prompt});const kind=options.outputSchema.properties.format.enum[0];
   const response=kind==='SceneAssemblyPlan'?assemblyPlan():kind==='SceneConceptReview'?concept(input):kind==='SceneAssemblyReview'?acceptReview(input):kind==='SceneAssemblyPlanEdit'?planEdit(input.priorPlan,input.priorPlan):packageEdit(input);
   return change?change({input,index,options,response,prompt,directory,controller}):response;
  }});}};
}
test('design-first policy explicitly reserves concept review without raising tier budget or tokens',()=>{
 for(const mode of ['text','images']){const p=generationPreflight({...request,assemblyCalls:5,assemblyDesignReview:mode});assert.equal(p.maximumCalls,5);assert.equal(p.assembly.maxPackages,2);assert.equal(p.maxOutputTokens,null);assert.equal(p.assembly.visualReview,mode==='images');}
 for(const delta of [{assemblyCalls:4},{assemblyDesignReview:true},{assemblyDesignReview:'automatic'},{agent:'deepseek'},{sceneWorkflow:undefined}])assert.throws(()=>generationPreflight({...request,...delta}));
 const legacy=generationPreflight({...request,assemblyDesignReview:undefined,assemblyCalls:4});assert.equal(legacy.assembly.designReview,undefined);
});
test('image reviews receive exact compiled views, freeze afterwards, and do not leak images to component calls',async()=>{
 const h=await harness(async({input,options,response,directory,index})=>{
  const isReview=['concept-review','review'].includes(options.stageName);
  assert.equal(options.images.length,isReview?4:0);
  if(isReview){
   const encoded=[];
   for(const [i,file] of options.images.entries()){const bytes=await fs.readFile(file);assert.equal(hash(bytes),input.designEvidence.views[i].sha256);encoded.push(bytes.toString('base64'));}
   assert.equal(reviewPngs(encoded).length,4);assert.equal(input.designEvidence.canAuthorizePlacement,false);
   await validateReviewImageFiles(options.images,directory);
   if(index===2)await assert.rejects(fs.stat(path.join(directory,'assembly/interfaces.json')),/ENOENT/);
  }
  return response;
 });
 const result=await h.run();assert.deepEqual(h.calls.map(c=>c.options.stageName),['plan','concept-review','component','component','review']);
 assert.equal(result.summary.visualReview,true);assert.equal(result.summary.visualReviewCurrent,true);assert.equal(result.summary.visualReviewAccepted,true);assert.equal(result.summary.aestheticQualityVerified,false);
 assert.equal(result.summary.conceptReview.verdict,'accept');assert.notEqual(result.summary.conceptReview.sourceHash,result.summary.sourceHash);
 assert.equal(result.summary.designQuality.interiorVisualReview,false);
 assert.match(h.calls[0].prompt,/Do not postpone ALL glazing/);assert.doesNotMatch(h.calls[0].prompt,/Defer repeated glazing arrays/);
 assert.match(h.calls[1].prompt,/Review architectural DATA, not implementation syntax/);assert.doesNotMatch(h.calls[1].prompt,/Module construction details/);
 await assert.rejects(readNativeBundle(path.join(h.directory,'assembly/1/diagnostic')),/Diagnostic-only/);
});
test('whole-plan material revision is allowed only before freeze and is reviewed again under the same budget',async()=>{
 const h=await harness(({input,index,options,response})=>{
  if(index===2)return {...response,verdict:'revise',issues:[issue]};
  if(options.stageName==='revise-design'){
   const next=structuredClone(input.priorPlan);next.scene.palette[0].material='quartz';next.scene.design.concept='Coordinated lighter material with unchanged requested functions';
   return planEdit(input.priorPlan,next);
  }
  return response;
 },{assemblyDesignReview:'text'});
 const result=await h.run();assert.deepEqual(h.calls.map(c=>c.options.stageName),['plan','concept-review','revise-design','concept-review','component','component','review']);
 assert.equal(result.summary.reservedCalls,7);assert.equal(result.summary.visualReview,false);assert.equal(result.summary.conceptReview.round,2);
 assert.equal(result.scene.palette[0].material,'quartz');assert.equal(result.scene.constraints.walkable,true);
 assert.ok(h.calls.every(c=>c.options.images.length===0));
});
test('unaccepted, stale and no-progress concepts do not freeze packages or start more calls',async()=>{
 for(const kind of ['budget','stale','no-progress']){
  const h=await harness(({index,response})=>index===2?(kind==='stale'?{...response,evidenceHash:'0'.repeat(64)}:{...response,verdict:'revise',issues:[issue]}):response,{assemblyDesignReview:'text',assemblyCalls:kind==='budget'?5:8});
  await assert.rejects(h.run(),kind==='budget'?/concept not accepted/:kind==='stale'?/Stale\/invalid concept/:/no visible progress/);
  assert.equal(h.calls.length,kind==='no-progress'?3:2);await assert.rejects(fs.stat(path.join(h.directory,'assembly/interfaces.json')),/ENOENT/);
 }
});
test('post-review refinement invalidates final visual approval and unknown concept failure is not retried',async()=>{
 const h=await harness(({options,response})=>options.stageName==='review'?{...response,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'exterior__detail contrast',change:'Change bounded material'}]}:response);
 const result=await h.run();assert.equal(result.summary.visualReview,true);assert.equal(result.summary.visualReviewCurrent,false);assert.equal(result.summary.visualReviewAccepted,false);assert.equal(result.summary.designQuality.status,'visual-review-unresolved');
 const stopped=await harness(({index,response})=>{if(index===2)throw new Error('offline unknown provider outcome');return response;},{assemblyDesignReview:'text'});
 await assert.rejects(stopped.run(),/unknown provider/);assert.equal(stopped.calls.length,2);assert.equal(stopped.records[1].invocationOutcome,'unknown');
});
test('occupancy renderer is deterministic and rejects changed cells or wrong source identity',async()=>{
 const h=await harness(undefined,{assemblyDesignReview:'text'});await h.run();
 const dir=path.join(h.directory,'assembly/1/diagnostic'),m=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'))),expected={assetHash:m.assetHash,sourceHash:m.scene.sourceHash};
 const a=await renderOccupancyViews(dir,expected,path.join(h.directory,'view-a')),b=await renderOccupancyViews(dir,expected,path.join(h.directory,'view-b'));
 assert.deepEqual(a,b);assert.equal(a.views.length,4);assert.equal(a.worldCaptured,false);assert.ok(a.views.every(v=>v.visiblePixels>100));
 await assert.rejects(renderOccupancyViews(dir,{...expected,sourceHash:'0'.repeat(64)},path.join(h.directory,'bad')),/source mismatch/);
 const cells=await fs.readFile(path.join(dir,'cells.bin'));cells[0]^=1;await fs.writeFile(path.join(dir,'cells.bin'),cells);
 await assert.rejects(renderOccupancyViews(dir,expected,path.join(h.directory,'tampered')),/cells mismatch/);
});
test('facade evidence exposes actual nominal openings without imposing an aesthetic pass threshold',()=>{
 const scene=assemblyPlan().scene;
 scene.components.push({kind:'panelFacade',id:'heavy',host:'main',face:'north',size:[8,3],borders:[1,1,0,1],step:[9,4],count:[4,11],glazing:'gray_glass',frame:'stone',lattice:false,projection:1,recess:1,shade:1});
 const evidence=architectureEvidence(scene);assert.deepEqual(evidence.facadeUnits[0].opening,[6,2]);assert.equal(evidence.facadeUnits[0].openingShareOfRepeatedUnit,1/3);assert.equal(evidence.aestheticQualityVerified,false);assert.equal(evidence.canAuthorizePlacement,false);
});

test('Bridge checks image capability before any call and sends actual files only at the confirmed reviews',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-bridge-'));let calls=0,imageCalls=0;
 const adapter={close(){},async models(){return [{id:'offline',supportsImages:true},{id:'text-only',supportsImages:false}];},async generate(args){
  calls++;const input=JSON.parse(args.prompt.split('Assembly input (data):\n').at(-1)),kind=args.outputSchema.properties.format.enum[0];
  const reviewing=['SceneConceptReview','SceneAssemblyReview'].includes(kind);assert.equal(args.images.length,reviewing?4:0);
  if(reviewing){imageCalls++;for(const [i,file] of args.images.entries())assert.equal(hash(await fs.readFile(file)),input.designEvidence.views[i].sha256);}
  await validateReviewImageFiles(args.images,args.cwd);
  return {spec:kind==='SceneAssemblyPlan'?assemblyPlan():kind==='SceneConceptReview'?concept(input):kind==='SceneAssemblyReview'?acceptReview(input):packageEdit(input)};
 }};
 const bridge=await startBridge({dataDir,adapter}),url='http://127.0.0.1:'+bridge.connection.port;
 const call=async(route,body)=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+bridge.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {httpStatus:r.status,...await r.json()};};
 const finish=async id=>{for(let i=0;i<500;i++){const job=await call('/v1/jobs/'+id);if(['preview-ready','failed'].includes(job.state))return job;await delay(20);}throw new Error('Offline Bridge timeout');};
 try{
  assert.equal((await call('/v1/jobs',{...request,key:'unconfirmed',assemblyConfirmed:false})).httpStatus,400);assert.equal(calls,0);
  const blocked=await finish((await call('/v1/jobs',{...request,key:'text-model',model:'text-only'})).id);assert.equal(blocked.state,'failed');assert.equal(calls,0);assert.match(blocked.error,/图像能力/);
  const payload={...request,key:'image-complete'},job=await finish((await call('/v1/jobs',payload)).id);assert.equal(job.state,'preview-ready',job.error);assert.equal(calls,5);assert.equal(imageCalls,2);assert.equal(job.assemblySummary.visualReviewAccepted,true);
  assert.equal((await call('/v1/jobs',payload)).id,job.id);assert.equal(calls,5);
 }finally{await bridge.close();}
});
test('cancellation after receiving concept response never freezes or starts a package',async()=>{
 const h=await harness(({index,response,controller})=>{if(index===2)controller.abort();return response;},{assemblyDesignReview:'text'});
 await assert.rejects(h.run(),/abort/i);assert.equal(h.calls.length,2);assert.equal(h.records[1].state,'cancelled');assert.equal(h.records[1].invocationOutcome,'response-received');
 await assert.rejects(fs.stat(path.join(h.directory,'assembly/interfaces.json')),/ENOENT/);
});

test('complete concept decision mistakes are corrected automatically within the original budget',async()=>{
 const h=await harness(({index,response})=>index===2?{...response,verdict:'revise',issues:[]}:response,{assemblyDesignReview:'text'});
 const result=await h.run();assert.equal(result.summary.reservedCalls,6);
 assert.deepEqual(h.calls.map(c=>c.options.stageName),['plan','concept-review','correct-concept-review','component','component','review']);
 assert.doesNotMatch(h.calls[2].prompt,/Module construction details/);
 const tight=await harness(({index,response})=>index===2?{...response,verdict:'revise',issues:[]}:response,{assemblyDesignReview:'text',assemblyCalls:5});
 await assert.rejects(tight.run(),/contract remains invalid/);assert.equal(tight.calls.length,2);
});

test('a rejected global edit is corrected against the unchanged baseline, never adopted before checking',async()=>{
 const h=await harness(({input,index,options,response})=>{
  if(index===2)return {...response,verdict:'revise',issues:[issue]};
  if(options.stageName==='revise-design')return {...response,extraInvalidField:true};
  if(options.stageName==='correct-design'){
   assert.ok(input.contractFeedback);assert.equal(input.sourceHash,hash(input.priorPlan.scene));
   const next=structuredClone(input.priorPlan);next.scene.palette[0].material='quartz';return planEdit(input.priorPlan,next);
  }
  return response;
 },{assemblyDesignReview:'text'});
 const result=await h.run();assert.equal(result.summary.reservedCalls,8);assert.equal(result.scene.palette[0].material,'quartz');
 assert.deepEqual(h.calls.map(c=>c.options.stageName),['plan','concept-review','revise-design','correct-design','concept-review','component','component','review']);
});

test('over-decomposed unapproved work is regrouped under enforced reserve without deleting source or work regions',async()=>{
 const original=assemblyPlan();
 original.packages=Array.from({length:16},(_,i)=>({id:'part'+i,name:'Detail '+i,purpose:'Preserve bounded detail work '+i,dependsOn:[],regions:[{origin:[0,0,i],size:[2,2,1]}],editableComponents:[],interfaces:[]}));
 const h=await harness(({input,index,options,response})=>{
  if(index===1){assert.equal(options.outputSchema.properties.packages.maxItems,7);return original;}
  if(options.stageName==='correct-plan'){
   assert.equal(input.feedback.contract.issues[0].code,'remaining-call-budget');
   const next=structuredClone(input.priorPlan);
   next.packages=Array.from({length:7},(_,i)=>({id:'work'+i,name:'Grouped work '+i,purpose:'All detail tasks '+original.packages.filter((_,j)=>j%7===i).map(p=>p.id).join(', '),dependsOn:[],regions:original.packages.filter((_,j)=>j%7===i).flatMap(p=>p.regions),editableComponents:[],interfaces:[]}));
   assert.deepEqual(next.scene,original.scene);
   assert.deepEqual(next.packages.flatMap(p=>p.regions).sort((a,b)=>a.origin[2]-b.origin[2]),original.packages.flatMap(p=>p.regions));
   return planEdit(input.priorPlan,next);
  }
  return response;
 },{assemblyDesignReview:'text',qualityTier:'ultra',assemblyCalls:23});
 const result=await h.run();assert.equal(result.summary.completedPackages.length,7);assert.equal(result.summary.reservedCalls,11);
 assert.equal(result.summary.finalTextReviewAccepted,true);
 const root=path.join(h.directory,'assembly');
 const raw=JSON.parse(await fs.readFile(path.join(root,'1/response.json'),'utf8'));assert.deepEqual(raw,original);
 const frozen=JSON.parse(await fs.readFile(path.join(root,'interfaces.json'),'utf8'));assert.equal(frozen.packages.length,7);
 assert.deepEqual(result.scene.bounds,original.scene.bounds);assert.deepEqual(result.scene.constraints,original.scene.constraints);
});

test('safe confirmed concept extensions finish after the old two-revision limit without skipping packages or final review',async()=>{
 let reviews=0,revisions=0;
 const h=await harness(({input,options,response})=>{
  if(options.stageName==='concept-review'){
   assert.equal(input.previousConceptReview===null,reviews===0);reviews++;
   if(reviews<=3)return {...response,verdict:'revise',issues:[issue]};
  }
  if(options.stageName==='revise-design'){
   revisions++;assert.equal(input.callBudget.extension,revisions>2);
   const next=structuredClone(input.priorPlan);next.scene.palette[0].material=['quartz','polished_andesite','stone'][revisions-1];
   return planEdit(input.priorPlan,next);
  }
  return response;
 },{qualityTier:'ultra',assemblyRecovery:'safe',assemblyDesignReview:'text'});
 const result=await h.run();assert.equal(revisions,3);assert.equal(reviews,4);assert.equal(result.summary.reservedCalls,11);
 assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.completedPackages.length,2);
 assert.equal(result.summary.conceptReview.round,4);assert.equal(h.policy.maximumCalls,26);
 assert.match(h.calls[1].prompt,/STAGE BOUNDARY/);assert.match(h.calls[1].prompt,/Missing rooms\/circulation/);
 assert.deepEqual(h.calls.slice(-3).map(c=>c.options.stageName),['component','component','review']);
});

test('persistent concept rejection stops before spending package and correction reserves and never publishes an intermediate',async()=>{
 let revisions=0;
 const h=await harness(({input,options,response})=>{
  if(options.stageName==='concept-review')return {...response,verdict:'revise',issues:[issue]};
  if(options.stageName==='revise-design'){
   revisions++;const next=structuredClone(input.priorPlan);
   next.scene.components[0].size[0]-=1;
   return planEdit(input.priorPlan,next);
  }
  return response;
 },{qualityTier:'ultra',assemblyCalls:12,assemblyRecovery:'safe',assemblyDesignReview:'text'});
 await assert.rejects(h.run(),/concept not accepted: concept-recovery-reserve/);
 assert.equal(revisions,2);assert.equal(h.calls.length,6);
 assert.ok(h.calls.every(c=>!['component','review'].includes(c.options.stageName)));
 await assert.rejects(fs.stat(path.join(h.directory,'assembly/interfaces.json')),/ENOENT/);
});
