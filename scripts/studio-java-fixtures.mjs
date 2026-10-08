import fs from 'node:fs/promises';
import {generationPreflight} from '../bridge/generation-policy.mjs';
import {referenceAssemblyPreflight} from '../bridge/reference-assembly-policy.mjs';
import { compileSpec } from '../src/generation/compiler.mjs';
import { sampleSpec } from '../src/generation/sample.mjs';
import {highriseParts} from '../tests/fixtures/highrise.mjs';
import {mergeInterior} from '../bridge/layered-generation.mjs';
import {designExamples} from '../src/generation/design-examples.mjs';
import {specialBlocksSpec} from '../tests/fixtures/special-blocks.mjs';
import {MATERIALS} from '../src/generation/materials.mjs';
import {resolveState,transformState} from '../src/generation/block-states.mjs';
import {staticOpenDoorCollision} from '../src/generation/static-open-doors.mjs';
import {compileScene} from '../src/design/compiler.mjs';
import {courtyard,teahouse,commercial,highrise,instanceStudy,worldHighrise,shape,panelCourtyard,panelTeahouse,panelHighrise,panelWorldHighrise,fourMetreWorldTower} from '../tests/design/fixtures.mjs';
import {profileTower,profileGallery,profileCourt,profileWorldTower} from '../tests/design/profile-fixtures.mjs';
import {spaceTower,spaceGallery,spaceCourt,spaceSetbackTower} from '../tests/design/space-fixtures.mjs';
import {storeyWorldTower} from '../tests/design/storey-layout-fixtures.mjs';
import {floorWorldTower,floorStudy,storeyOpening} from '../tests/design/floor-components-fixtures.mjs';
import {WorldContextStore} from '../bridge/world-context-store.mjs';
import {WorldContextConsents} from '../bridge/world-context-consent.mjs';
import {createContextAnalysisRunner} from '../bridge/world-context-analysis-runner.mjs';
import {createWorldPatchDesignRunner} from '../bridge/world-patch-design-runner.mjs';
import {worldPatchSendingCapabilities} from '../bridge/world-patch-capabilities.mjs';
import {selectionChunks,regionCells} from '../contracts/world-selection.mjs';
import {makeBeforeCheckFixtures} from './world-patch-before-fixtures.mjs';
import {makePatchSafetyFixtures} from './world-patch-safety-fixtures.mjs';
import {makeJournalFixture} from './world-patch-journal-fixtures.mjs';
import {makeReferencePlayerFixtures} from './reference-player-fixtures.mjs';
import {makeReferenceWorldPatchClientFixtures} from './reference-world-patch-client-fixtures.mjs';
import {makeReferenceWorldAssemblyClientFixtures} from './reference-world-assembly-client-fixtures.mjs';
import {makeReferenceWorldAssemblyCandidateFixtures} from './reference-world-assembly-candidate-fixtures.mjs';
const compiled=compileSpec(sampleSpec());
for(const fixture of [courtyard,teahouse,commercial,highrise,instanceStudy,panelCourtyard,panelTeahouse,panelHighrise]){const c=compileScene(fixture()),dir='mod/build/test-fixtures/'+c.manifest.id;await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/manifest.json',JSON.stringify(c.manifest));await fs.writeFile(dir+'/cells.bin',c.binary);await fs.writeFile(dir+'/scene.json',JSON.stringify(c.scene));await fs.writeFile(dir+'/design-sources.json',JSON.stringify(c.designSources));}
const floorDoors=()=>{const s=floorStudy();s.id='floor-doors';s.components=[s.components[0],storeyOpening('doors','main','east',{door:'oak_door'})];return s;};
for(const fixture of [profileTower,profileGallery,profileCourt,profileWorldTower,spaceTower,spaceGallery,spaceCourt,spaceSetbackTower,storeyWorldTower,floorWorldTower,floorDoors]){
 const c=compileScene(fixture(),{navigationPolicy:fixture===profileWorldTower?'strict':'review'}),dir='mod/build/test-fixtures/'+c.manifest.id;
 await fs.mkdir(dir,{recursive:true});
 for(const [name,value] of Object.entries({'manifest.json':c.manifest,'scene.json':c.scene,'spec.json':c.spec,'design-sources.json':c.designSources}))await fs.writeFile(dir+'/'+name,JSON.stringify(value));
 const owners=Buffer.alloc(c.sourceOwners.length*2);c.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
 await fs.writeFile(dir+'/cells.bin',c.binary);await fs.writeFile(dir+'/source-owners.bin',owners);
}
{const c=compileScene(worldHighrise(),{navigationPolicy:'strict'}),dir='mod/build/test-fixtures/'+c.manifest.id;await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/manifest.json',JSON.stringify(c.manifest));await fs.writeFile(dir+'/cells.bin',c.binary);}
{const c=compileScene(panelWorldHighrise(),{navigationPolicy:'strict'}),dir='mod/build/test-fixtures/'+c.manifest.id;await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/manifest.json',JSON.stringify(c.manifest));await fs.writeFile(dir+'/cells.bin',c.binary);}
{const c=compileScene(fourMetreWorldTower(),{navigationPolicy:'strict'}),dir='mod/build/test-fixtures/'+c.manifest.id;await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/manifest.json',JSON.stringify(c.manifest));await fs.writeFile(dir+'/cells.bin',c.binary);}
{const s=courtyard();s.components.push(shape('collision',[2,1,1],[1,2,1],'wall'));const c=compileScene(s,{diagnosticOnly:true}),dir='mod/build/test-fixtures/scene-diagnostic';await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/manifest.json',JSON.stringify(c.manifest));await fs.writeFile(dir+'/cells.bin',c.binary);}
for(const spec of [...designExamples(),specialBlocksSpec()]){const c=compileSpec(spec,{navigationPolicy:'review'}),dir='mod/build/test-fixtures/'+spec.id;await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/manifest.json',JSON.stringify(c.manifest));await fs.writeFile(dir+'/cells.bin',c.binary);await fs.writeFile(dir+'/spec.json',JSON.stringify(spec));}
await fs.mkdir('mod/build/test-fixtures',{recursive:true});
await makeReferencePlayerFixtures();
await makeReferenceWorldPatchClientFixtures();
await makeReferenceWorldAssemblyClientFixtures();
await makeReferenceWorldAssemblyCandidateFixtures();
await makeReferencePlayerFixtures({providerRecovery:true});
await fs.writeFile('mod/build/test-fixtures/world-patch-before.json',JSON.stringify(makeBeforeCheckFixtures()));
await fs.writeFile('mod/build/test-fixtures/world-patch-safety.json',JSON.stringify(makePatchSafetyFixtures()));
await fs.writeFile('mod/build/test-fixtures/world-patch-journal.json',JSON.stringify(makeJournalFixture()));
const doorCollisionStates=[];
for(const material of Object.keys(MATERIALS).filter(m=>m.endsWith('_door')))for(const facing of ['north','east','south','west'])for(const hinge of ['left','right'])for(const half of ['lower','upper']){
 const state=resolveState(material,{facing,hinge,half,open:true}),collision=staticOpenDoorCollision(state);
 doorCollisionStates.push({state,collision});
}
await fs.writeFile('mod/build/test-fixtures/static-open-door-collisions.json',JSON.stringify(doorCollisionStates));
await fs.writeFile('mod/build/test-fixtures/material-states.json',JSON.stringify(Object.values(MATERIALS)));
const transforms=[];
for(const facing of ['north','east','south','west'])for(const half of ['bottom','top'])for(const shape of ['straight','inner_left','inner_right','outer_left','outer_right'])for(let rotation=0;rotation<4;rotation++)for(const mirror of [false,true]){
  const source=resolveState('oak_stairs',{facing,half,shape});transforms.push({source,rotation,mirror,expected:transformState(source,rotation,mirror)});
}
await fs.writeFile('mod/build/test-fixtures/state-transforms.json',JSON.stringify(transforms));
await fs.writeFile('mod/build/test-fixtures/manifest.json',JSON.stringify(compiled.manifest));
await fs.writeFile('mod/build/test-fixtures/cells.bin',compiled.binary);
const parts=highriseParts(),tower=compileSpec(mergeInterior(parts.envelope,parts.interior));
await fs.mkdir('mod/build/test-fixtures/highrise',{recursive:true});
await fs.writeFile('mod/build/test-fixtures/highrise/manifest.json',JSON.stringify(tower.manifest));
await fs.writeFile('mod/build/test-fixtures/highrise/cells.bin',tower.binary);
const reviewSpec=mergeInterior(parts.envelope,parts.interior);reviewSpec.nodes.push({nodeId:'review-entry-unknown',op:'keep',origin:[15,0,1],size:[1,1,1]});
const review=compileSpec(reviewSpec,{navigationPolicy:'review'});
await fs.mkdir('mod/build/test-fixtures/highrise-review',{recursive:true});
await fs.writeFile('mod/build/test-fixtures/highrise-review/manifest.json',JSON.stringify(review.manifest));await fs.writeFile('mod/build/test-fixtures/highrise-review/cells.bin',review.binary);
const blocked=sampleSpec();blocked.nodes.push({nodeId:'blocked-entry',op:'box',origin:[8,2,2],size:[3,3,1],material:'wall'});const smallReview=compileSpec(blocked,{navigationPolicy:'review'});
await fs.mkdir('mod/build/test-fixtures/navigation-review',{recursive:true});await fs.writeFile('mod/build/test-fixtures/navigation-review/manifest.json',JSON.stringify(smallReview.manifest));await fs.writeFile('mod/build/test-fixtures/navigation-review/cells.bin',smallReview.binary);
// Actual Node preflight policies consumed by Java consent tests: no provider,
// model invocation or fabricated policy shape at this cross-language boundary.
const prototypePolicies=[];
for(const mode of ['verified','staged'])for(const calls of mode==='staged'?[22,23,24,25,26]:[26]){
 const request={agent:'codex',model:'offline-vision',prompt:'32×224×32格，224米办公塔楼；免费合同测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyCalls:calls,assemblyQuality:'v4',assemblyPrototypes:mode,assemblyDesignReview:'native',assemblyRecovery:'safe',maxRepairs:0};
 prototypePolicies.push({request,policy:generationPreflight(request)});
}
await fs.writeFile('mod/build/test-fixtures/prototype-preflight.json',JSON.stringify(prototypePolicies));
const completionPolicies=prototypePolicies.filter(f=>f.request.assemblyPrototypes==='staged').map(f=>{
 const request={...f.request,assemblyConfirmed:true,assemblyCompletionReserve:'design-correction-v1',assemblyEvidence:'representative-v1',assemblyProviderRecovery:'bounded',effort:'max'};
 return {request,policy:generationPreflight(request),referencePolicy:referenceAssemblyPreflight(request)};
});
await fs.writeFile('mod/build/test-fixtures/completion-reserve-preflight.json',JSON.stringify(completionPolicies));
const cameraPolicies=prototypePolicies.filter(f=>f.request.assemblyPrototypes==='staged').map(f=>{
 const request={...f.request,assemblyEvidence:'representative-v1'};return {request,policy:generationPreflight(request)};
});
await fs.writeFile('mod/build/test-fixtures/camera-evidence-preflight.json',JSON.stringify(cameraPolicies));
const recoveryPolicies=[];
for(const qualityTier of ['lite','pro','max','ultra'])for(const enabled of [false,true]){
 const request={agent:'codex',model:'offline-vision',effort:'max',prompt:'32×224×32格，224米办公塔楼；免费费用合同测试',generationMode:'scene',sceneWorkflow:'components',qualityTier,
   assemblyCalls:({lite:8,pro:14,max:20,ultra:26})[qualityTier],assemblyDesignReview:'text',assemblyRecovery:'safe',maxRepairs:0,...(enabled?{assemblyProviderRecovery:'bounded'}:{})};
 recoveryPolicies.push({request,policy:generationPreflight(request)});
}
for(const original of prototypePolicies){const request={...original.request,effort:'max',assemblyProviderRecovery:'bounded'};recoveryPolicies.push({request,policy:generationPreflight(request)});}
await fs.writeFile('mod/build/test-fixtures/provider-recovery-preflight.json',JSON.stringify(recoveryPolicies));

// Production worker/summary/task/consent outputs for the Java boundary. This is
// a small synthetic snapshot: no world, account, model adapter or screenshots.
{
 const selection={format:'WorldSelection',version:1,world:{worldId:'opaque_context_fixture',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:3,
   context:{min:[-2,-2,-2],max:[2,2,2]},edit:{min:[-1,-1,-1],max:[1,1,1]},protected:[]};
 const input={selection,capture:{fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',palette:[{state:'minecraft:stone',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))}};
 const payload=JSON.stringify(input),id='15e70256-4991-4b0d-8a26-ccf6b81bbb92';
 // The dev build may archive ONLY generated test outputs on its owned build
 // drive. Resolve that explicit local test path BEFORE calling the private
 // store; do not relax the production worker's no-link ancestor checks.
 // Every fixture run starts NEW local data. Durable original SEND deduplication
 // is production behavior, not a failed invocation to clear or regenerate.
 // Keep all prior fixture journals and failed receipts; never reuse that store
 // when asserting one fresh FREE adapter call in a new Java regression.
 const taskSource=await fs.realpath(await fs.mkdtemp('mod/build/test-fixtures/context-task-source-'));
 const store=new WorldContextStore({dataDir:taskSource});
 try{
   const saved=await store.operation('capture',id,Buffer.from(payload));
   const cases=[],casesV2=[];
   for(const version of [1,2])for(const prompt of ['  分析入口与周围环境。\n不推断未知区。  ','中文 🏢 <入口> & "引号" \\路径\t行\u2028段\u2029末','合法文本中保留孤立代理项：\ud800，末尾\udfff']){
     const intent={format:'WorldContextTaskIntent',version,purpose:'context-analysis',agent:'codex',model:'gpt-6.1-sol',effort:'max',prompt,maximumCalls:1};
     const prepared=await store.operation('task-disclosure',id,Buffer.from(JSON.stringify(intent))),registry=new WorldContextConsents();
     const consent=registry.confirm(prepared.disclosure,{confirmed:true,disclosureHash:prepared.disclosure.disclosureHash,task:prepared.disclosure.recipient});
     registry.close();(version===1?cases:casesV2).push({intent,prepared,consent});
   }
   await fs.writeFile('mod/build/test-fixtures/context-task.json',JSON.stringify({id,payload,contextRevision:9,selection,saved,cases,casesV2}));
   // Actual production-runner statuses, consumed by Java. All provider methods
   // are local fixtures; importing this script never discovers a real account.
   const analysisRoot=await fs.realpath(await fs.mkdtemp('mod/build/test-fixtures/context-analysis-source-'));
   const registry=new WorldContextConsents(),analysisCases=[];let activePrepared=null,label='',release=null,fixtureCalls=0;
   const adapter={async generate(args){
     fixtureCalls++;
     const answer={format:'WorldContextAnalysis',version:1,requestHash:activePrepared.requestHash,
       snapshotHash:activePrepared.request.snapshotHash,summaryHash:activePrepared.request.summaryHash,
       observations:['摘要记录 64 格已知石头；这不是入口或通行证明。'],inferences:['推断：功能未知。'],unknowns:['中文 🏢 与 <文本> 只作为数据；不能确认当前环境。'],recommendations:['建议仅供考虑，不执行任何命令。']};
     if(label==='running')await new Promise(resolve=>{release=resolve;});
     if(label==='unknown'){
       await args.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',requestHash:'e'.repeat(64),model:args.model,effort:args.effort,threadId:'free-fixture-thread',turnId:'free-fixture-turn'});
       throw new Error('local unknown fixture');
     }
     if(label==='failed'){const error=new Error('local failed fixture');error.diagnostic={provider:'codex',reason:'failed'};throw error;}
     return {spec:label==='completed-rejected'?{...answer,worldPatch:{}}:answer};
   }};
   const runner=await createContextAnalysisRunner({dataDir:analysisRoot,contexts:store,consents:registry,adapterFor:()=>adapter});
   try{
     for(label of ['completed','completed-rejected','failed','unknown','running']){
       const intent={...casesV2[0].intent,prompt:casesV2[0].intent.prompt+'\n免费回执夹具：'+label};
       const prepared=activePrepared=await store.operation('task-disclosure',id,Buffer.from(JSON.stringify(intent)));
       const consent=registry.confirm(prepared.disclosure,{confirmed:true,disclosureHash:prepared.disclosure.disclosureHash,task:prepared.disclosure.recipient});
       await runner.submit({contextId:id,consentId:consent.id,requestHash:prepared.requestHash,disclosureHash:prepared.disclosure.disclosureHash,intent,explicitSend:true});
       if(label!=='running')await runner.idle();
       const status=await runner.get(prepared.requestHash);if(status.state!==label)throw new Error('Actual fixture runner state differs: '+label);
       analysisCases.push({prepared,status,consent});
       if(release){release();release=null;await runner.idle();}
     }
     if(fixtureCalls!==5)throw new Error('Fixture analysis call reservation changed');
     await fs.writeFile('mod/build/test-fixtures/context-analysis.json',JSON.stringify({analysisCases,fixtureAdapterCalls:fixtureCalls,realModelCalls:0}));
   }finally{if(release)release();await runner.close();registry.close();}
   // Exact production P4 response + worker download, with independently
   // retained source/SEND/status pins. Separate from the five analysis calls.
   const patchIntent={format:'WorldPatchDesignIntent',version:1,purpose:'world-patch-design',agent:'codex',model:'gpt-6.1-sol',effort:'max',prompt:'原位替换入口材质；免费跨语言夹具。',maximumCalls:1};
   const patchPrepared=await store.operation('patch-task-disclosure',id,Buffer.from(JSON.stringify(patchIntent)));
   const patchConfirmation={format:'SavedWorldPatchDesignConfirmation',version:1,purpose:'world-patch-design',confirmed:true,
     taskDisclosureHash:patchPrepared.taskDisclosureHash,taskHash:patchPrepared.taskHash,requestHash:patchPrepared.task.requestHash,
     disclosureHash:patchPrepared.task.disclosure.disclosureHash,promptSha256:patchPrepared.task.request.promptSha256};
   const frozen=await store.operation('patch-freeze-task',id,Buffer.from(JSON.stringify({intent:patchIntent,confirmation:patchConfirmation})));
   const send={format:'FrozenWorldPatchExplicitSend',version:1,purpose:'world-patch-design',confirmed:true,maximumCalls:1,
     ...Object.fromEntries(['capsuleId','manifestHash','taskDisclosureHash','taskHash','requestHash','disclosureHash','promptSha256','reviewHash'].map(k=>[k,frozen[k]]))};
   let patchCalls=0;const patchRunner=await createWorldPatchDesignRunner({dataDir:taskSource,contexts:store,adapterFor:()=>({async generate(args){
     patchCalls++;if(args.prompt!==patchPrepared.task.disclosure.modelPrompt)throw new Error('Patch fixture disclosure changed');
     return {spec:{format:'WorldPatchProposal',version:1,snapshotHash:frozen.snapshotHash,selectionHash:frozen.selectionHash,
       operations:[{op:'set',position:[0,0,0],before:'minecraft:stone',after:'minecraft:glass'}]}};
   }})});
   try{
     await patchRunner.submit(send);let status;
     for(let i=0;i<300;i++){status=await patchRunner.get(frozen.capsuleId);if(status.state==='completed-checked')break;await new Promise(resolve=>setTimeout(resolve,20));}
     if(status.state!=='completed-checked'||patchCalls!==1)throw new Error('Actual patch fixture did not complete once: state='+status.state+', freeAdapterCalls='+patchCalls);
     const request=JSON.parse(await fs.readFile(taskSource+'/world-patch-design/'+frozen.capsuleId+'/request.json','utf8')).value;
     const bytes=await patchRunner.downloadPreview(frozen.capsuleId,status.candidateHash);
     const candidateBytes=await patchRunner.downloadCandidate(frozen.capsuleId,status.candidateHash);
     // Reference is NEVER derived from the unverified download.
     const reference={capsuleId:frozen.capsuleId,manifestHash:frozen.manifestHash,submissionHash:status.submissionHash,runtimeHash:request.runtimeHash,
       responseHash:status.responseCheck.responseHash,candidateHash:status.candidateHash,selection,contextRevision:9,
       snapshotHash:frozen.snapshotHash,selectionHash:frozen.selectionHash,patchHash:status.responseCheck.patchHash,previewHash:status.responseCheck.previewHash};
     await fs.writeFile('mod/build/test-fixtures/world-patch-preview-download.json',bytes);
     await fs.writeFile('mod/build/test-fixtures/world-patch-candidate-download.json',candidateBytes);
     await fs.writeFile('mod/build/test-fixtures/world-patch-preview-reference.json',JSON.stringify({reference,fixtureAdapterCalls:patchCalls,realModelCalls:0,worldWrites:0}));
     await fs.writeFile('mod/build/test-fixtures/world-patch-player-task.json',JSON.stringify({id,payload,selection,contextRevision:9,saved,
       intent:patchIntent,prepared:patchPrepared,confirmation:patchConfirmation,frozen,runtimeHash:patchRunner.runtimeHash,status,
       sendingCapabilities:worldPatchSendingCapabilities({preparationEnabled:true,sendingEnabled:true,runtimeHash:patchRunner.runtimeHash}),
       disabledSendingCapabilities:worldPatchSendingCapabilities({preparationEnabled:true,sendingEnabled:false,runtimeHash:null}),
       fixtureAdapterCalls:patchCalls,realModelCalls:0,worldWrites:0}));
   }finally{await patchRunner.close();}
   // Heterogeneous original facts and unknown coverage: verifies the Java
   // review against production input construction, without any adapter.
   const rawStates=[['minecraft:stone',false],['minecraft:oak_stairs[waterlogged=false,shape=inner_left,half=bottom,facing=east]',false],
     ['minecraft:oak_door[powered=false,open=true,hinge=right,half=lower,facing=north]',false],['minecraft:water[level=0]',false],
     ['minecraft:glass',true],['testmod:floor[property=a]',false],['minecraft:air',false],['minecraft:crying_obsidian',false],
     ['minecraft:light[level=15]',false],['minecraft:oak_trapdoor[waterlogged=false,powered=false,open=false,half=bottom,facing=north]',false],
     ['minecraft:unclassified[notwaterlogged=true]',false],['minecraft:stone[unsupported=true]',false]];
   const mixedPayload=JSON.stringify({selection,capture:{fence:{start:9,end:9},chunks:selectionChunks(selection).map((c,i)=>{
     if(i===3)return {x:c.x,z:c.z,coverage:'unknown',palette:[],runs:[]};
     const palette=rawStates.map(([state,blockEntity])=>({state,blockEntity}));let remaining=regionCells(c.region);const runs=[];
     for(let index=0;index<palette.length;index++){const count=index===palette.length-1?remaining:1;runs.push([index,count]);remaining-=count;}
     return {x:c.x,z:c.z,coverage:'known',palette,runs};
   })}}),mixedId='32b74bfd-7f39-4f9e-bc03-4c93c32cc4e1';
   const mixedSaved=await store.operation('capture',mixedId,Buffer.from(mixedPayload));
   const mixedPrepared=await store.operation('patch-task-disclosure',mixedId,Buffer.from(JSON.stringify(patchIntent)));
   await fs.writeFile('mod/build/test-fixtures/world-patch-mixed-task.json',JSON.stringify({id:mixedId,payload:mixedPayload,selection,contextRevision:9,saved:mixedSaved,intent:patchIntent,prepared:mixedPrepared}));
 }finally{await store.close();}
}
