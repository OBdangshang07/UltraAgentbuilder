import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,packageResponse} from '../design/assembly-fixtures.mjs';
import {requestNativeEvidence,acceptNativeEvidence} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from '../bridge/native-evidence-fixtures.mjs';
export async function failedDesignContinuationFixture(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-design-game-source-'));
 const request={agent:'codex',model:'offline',effort:'max',prompt:'16×10×16格范围，原生续测工程样本',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyQuality:'v2',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0},policy=generationPreflight(request);
 const job={id:randomUUID(),requestHash:hash(request),state:'generating',prompt:request.prompt,preflight:policy,recoveryEnabled:true,assemblyStages:[],assemblyCallsReserved:0};
 const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
 await assert.rejects(runDurableAssembly({directory,requestHash:job.requestHash,runtimeHash:'fixture',prompt:job.prompt,rules,policy,signal:new AbortController().signal,
  nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:directory,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting')await acceptNativeEvidence(directory,s.id,fixtureUpload(s.request));}}),
  onRecovery:async r=>{job.recovery=r;},onStage:async r=>{job.assemblyStages=r;job.assemblyCallsReserved=r.length;},invoke:async(p,i,o)=>{
   const input=JSON.parse(p.split('Assembly input (data):\n').at(-1)),kind=o.outputSchema.properties.format.enum[0];
   if(kind==='SceneAssemblyPlan')return assemblyPlan();
   if(kind==='SceneConceptReview')return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Engineering fixture',issues:[]};
   const edit=packageEdit(input);if(i>=4)edit.components.put[0].at.offset=i===5?[14,1,14]:[15,1,15];return packageResponse(input,edit);
  }}),/Component correction made no progress/);
 job.state='failed';await fs.writeFile(path.join(directory,'job.json'),JSON.stringify(job));
 const m=JSON.parse(await fs.readFile(path.join(directory,job.recovery.branch,'assembly/3/diagnostic/manifest.json')));
 return {directory,job,policy,rules,resume:{kind:'design-component-v1',sourceDirectory:directory,jobHash:hash(job),assetHash:m.assetHash,authorizedNewCalls:20,continuationConfirmed:true}};
}
