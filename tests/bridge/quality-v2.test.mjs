import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {startBridge} from '../../bridge/server.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,acceptReview} from '../design/assembly-fixtures.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles,NATIVE_RENDERER} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
const request={agent:'codex',model:'offline',prompt:'16×10×16格边界内设计建筑，保留内饰和通路',generationMode:'scene',sceneWorkflow:'components',qualityTier:'pro',assemblyQuality:'v2',assemblyDesignReview:'text',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
function response(input,options){
 const kind=options.outputSchema.properties.format.enum[0];
 if(kind==='SceneAssemblyPlan')return assemblyPlan();
 if(kind==='SceneConceptReview')return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline quality protocol fixture, not an aesthetic result',issues:[]};
 if(kind==='SceneAssemblyReview')return acceptReview(input);
 return packageEdit(input);
}
test('quality v2 is explicitly versioned/new-building-only and does not raise token or call budgets',()=>{
 const p=generationPreflight(request);assert.equal(p.maximumCalls,14);assert.equal(p.maxOutputTokens,null);assert.equal(p.assembly.quality.version,2);assert.equal(p.assembly.quality.strategy.nativeViews,6);
 for(const delta of [{assemblyQuality:'v4'},{baseJobId:'old'},{assemblyRecovery:undefined},{assemblyDesignReview:undefined},{assemblyQuality:undefined,assemblyDesignReview:'native'},{agent:'claude',assemblyDesignReview:'native'}])assert.throws(()=>generationPreflight({...request,...delta}));
 assert.equal(generationPreflight({...request,assemblyQuality:undefined}).assembly.quality,undefined);
});
test('quality v2 coordinates implicated packages under actual saved cell/owner bounds and reviews final source',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-quality-v2-')),calls=[];let reviews=0;
 const result=await runSceneAssembly({directory,prompt:request.prompt,rules,policy:generationPreflight(request),signal:new AbortController().signal,onStage:async()=>{},invoke:async(prompt,index,options)=>{
  const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));calls.push(options.stageName);assert.match(prompt,/QUALITY V2/);
  if(options.stageName==='concept-review'){assert.equal(input.designEvidence.prototypeEvidence.sourceHash,input.sourceHash);assert.match(prompt,/REPRESENTATIVE PROTOTYPE REVIEW/);}
  const answer=response(input,options);
  if(options.stageName==='review'&&++reviews===1)return {...answer,verdict:'revise',task:'exterior',issues:['exterior','interior'].map(task=>({task,criterion:'materials',evidence:task+'__detail source colour',change:'Coordinate accent materials'}))};
  if(options.stageName==='refine-coordinated'){
   assert.deepEqual(input.coordinatedScope.packages,['exterior','interior']);
   return {...answer,format:'SceneCoordinatedEdit',scopeHash:input.coordinatedScope.scopeHash,components:{put:input.previousDraft.components.filter(c=>c.id.endsWith('__detail')).map(c=>({...c,material:'wall'})),remove:[]}};
  }
  return answer;
 }});
 assert.equal(result.summary.reservedCalls,7);assert.equal(result.summary.finalTextReviewCurrent,true);assert.equal(result.summary.finalTextReviewAccepted,true);assert.equal(result.summary.qualityVersion,2);
 assert.deepEqual(calls,['plan','concept-review','component','component','review','refine-coordinated','review']);
 const check=JSON.parse(await fs.readFile(path.join(directory,'assembly/6/feedback.json'),'utf8'));assert.equal(check.packageCheck.scopeVerified,true);assert.ok(check.packageCheck.changedCells>0);
});
test('native evidence bytes survive durable replay without recapture, duplicate model calls or changing the final image identity',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-native-replay-')),payload={...request,assemblyDesignReview:'native'},policy=generationPreflight(payload),calls=[];let uploads=0;
 const base={directory,prompt:request.prompt,rules,policy,requestHash:hash(payload),runtimeHash:'frozen-quality-fixture',
  nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:directory,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting'){uploads++;await acceptNativeEvidence(directory,s.id,fixtureUpload(s.request));}}}),
  invoke:async(prompt,index,options)=>{assert.ok(!calls.includes(index),'Duplicate provider invocation');calls.push(index);const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));await validateModelImageFiles(options.images,directory);if(options.images.length){assert.equal(options.images.length,6);assert.equal(input.designEvidence.kind,'native-asset');}return response(input,options);}};
 const abort=new AbortController();await assert.rejects(runDurableAssembly({...base,signal:abort.signal,onStage:async records=>{if(records.at(-1).phase==='concept-review'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
 assert.deepEqual(calls,[1,2]);assert.equal(uploads,1);
 const result=await runDurableAssembly({...base,signal:new AbortController().signal,onStage:async()=>{}});
 assert.deepEqual(calls,[1,2,3,4,5]);assert.equal(uploads,2);assert.equal(result.summary.visualReviewCurrent,true);assert.equal(result.summary.designQuality.nativeMaterialReview,true);assert.equal(result.summary.designQuality.interiorVisualReview,true);assert.equal(result.summary.aestheticQualityVerified,false);
});
test('coordinated no-op preserves completed geometry and unresolved review with the accurate stop reason',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-coordinated-noop-'));let calls=0;
 const result=await runSceneAssembly({directory,prompt:request.prompt,rules,policy:generationPreflight(request),signal:new AbortController().signal,onStage:async()=>{},invoke:async(prompt,index,options)=>{
  calls++;const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1)),answer=response(input,options);
  if(options.stageName==='review')return {...answer,verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'facade',evidence:'Unresolved fixture preference',change:'Improve exterior detail'}]};
  if(options.stageName==='refine-coordinated')return {...answer,format:'SceneCoordinatedEdit',scopeHash:input.coordinatedScope.scopeHash,components:{put:[],remove:[]}};
  return answer;
 }});
 assert.equal(calls,6);assert.equal(result.summary.stopReason,'candidate-no-progress-previous-preserved');assert.equal(result.summary.finalTextReviewCurrent,true);assert.equal(result.summary.finalTextReviewAccepted,false);assert.equal(result.summary.unresolvedReviewIssues.length,1);
});
test('Bridge requires native readiness and capability, serves only diagnostic assets, and binds final evidence to published cells',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-native-bridge-'));let calls=0;
 const adapter={close(){},async models(){return [{id:'offline',supportsImages:true}];},async generate(options){calls++;const input=JSON.parse(options.prompt.split('Assembly input (data):\n').at(-1));await validateModelImageFiles(options.images,options.cwd);return {spec:response(input,options)};}};
 const b=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter}),base='http://127.0.0.1:'+b.connection.port,headers={Authorization:'Bearer '+b.connection.token,'Content-Type':'application/json'};
 const http=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  const payload={...request,assemblyDesignReview:'native',key:'native-full'};
  assert.equal((await http('/v1/jobs',payload)).status,400);assert.equal(calls,0);
  assert.equal((await http('/v1/renderers/heartbeat',{renderer:NATIVE_RENDERER,assetOnly:true})).status,200);
  const submitted=await http('/v1/jobs',payload);assert.equal(submitted.status,202);const id=submitted.data.id;let job;
  const uploaded=new Set();
  for(let i=0;i<400;i++){
   job=(await http('/v1/jobs/'+id)).data;
   if(job.nativeEvidence?.state==='waiting'&&!uploaded.has(job.nativeEvidence.id)){
    const e=job.nativeEvidence,route=`/v1/jobs/${id}/native-evidence/${e.id}/`;
    assert.equal((await http(route+'manifest')).data.diagnosticOnly,true);
    assert.equal((await http(route+'upload',{...fixtureUpload(e.request),requestHash:'0'.repeat(64)})).status,400);
    assert.equal((await http(route+'upload',fixtureUpload(e.request))).status,200);uploaded.add(e.id);
   }
   if(['preview-ready','failed'].includes(job.state))break;await delay(20);
  }
  assert.equal(job.state,'preview-ready',job.error);assert.equal(calls,5);assert.equal(uploaded.size,2);assert.equal(job.visualEvidenceBinding.finalAssetHash,job.assetHash);assert.equal(job.visualEvidenceBinding.cellsHash,job.manifest.cellsHash);assert.equal(job.visualEvidenceBinding.canAuthorizePlacement,false);
  assert.equal((await http('/v1/jobs',payload)).data.id,id);assert.equal(calls,5);
 }finally{await b.close();}
});
