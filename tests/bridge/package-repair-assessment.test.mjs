import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,packageEdit,packageResponse,acceptReview} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';
import {completedFormatError} from '../fixtures/completed-format-error.mjs';

for(const refinement of [false,true])test(`terminal audit reconstructs ${refinement?'final refinement':'first construction'} with a format-corrected candidate patch and rejects tampering`,async()=>{
 const project=fileURLToPath(new URL('../../',import.meta.url)),root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-patch-audit-'));
 const frozen=await freezeSceneRuntime(project,path.join(root,'runtime')),mod=n=>import(pathToFileURL(path.join(frozen.runtime,n)));
 const {startBridge}=await mod('bridge/server.mjs'),{CompletedResponseFormatError,parseModelJson}=await mod('bridge/model-json.mjs');
 let calls=0;const badAt=refinement?6:3,invalidAt=refinement?7:4,repairAt=refinement?8:5,total=refinement?9:7;
 const adapter={close(){},async generate(args){
  const n=++calls,input=JSON.parse(args.prompt.split('Assembly input (data):\n').at(-1)),format=args.outputSchema.properties.format.enum[0];
  if(n===1)return {spec:assemblyPlan()};
  if(n===2)return {spec:{format:'SceneConceptReview',version:1,sourceHash:input.sourceHash,planHash:input.planHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'accept',summary:'Offline audit fixture',issues:[]}};
  if(n===invalidAt)throw await completedFormatError(args.cwd,CompletedResponseFormatError,parseModelJson,undefined,'codex');
  if(format==='SceneAssemblyReview')return {spec:refinement&&n===5?{...acceptReview(input),verdict:'revise',task:'exterior',issues:[{task:'exterior',criterion:'materials',evidence:'exterior__detail fixture',change:'Refine owned detail'}]}:acceptReview(input)};
  const edit=packageEdit(input);
  if(n===badAt)edit.components.put=[shape('exterior__bad',[2,1,0],[1,1,1],'frame'),shape('exterior__preserve',[0,1,0],[1,1,1],'frame')];
  if(n===repairAt){assert.equal(format,'ScenePackageRepair');if(refinement)assert.equal(input.refinement,true);edit.components.put=[shape('exterior__bad',[1,1,0],[1,1,1],'frame')];}
  return {spec:packageResponse(input,edit)};
 }};
 const dataDir=path.join(root,'data'),bridge=await startBridge({dataDir,adapter,claudeAdapter:adapter,deepseekAdapter:adapter});let job;
 const startedAt=new Date().toISOString();
 try{
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+bridge.connection.token},url='http://127.0.0.1:'+bridge.connection.port;
  const input={key:'offline-patch-audit',agent:'codex',model:'offline',prompt:'16×10×16格离线审计测试',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyRecovery:'safe',assemblyDesignReview:'text',assemblyConfirmed:true,maxRepairs:0};
  const submitted=await (await fetch(url+'/v1/jobs',{method:'POST',headers,body:JSON.stringify(input)})).json();assert.ok(submitted.id);
  for(let i=0;i<500;i++){job=await (await fetch(url+'/v1/jobs/'+submitted.id,{headers})).json();if(['preview-ready','failed'].includes(job.state))break;await delay(40);}
  assert.equal(job.state,'preview-ready',job.error);assert.equal(calls,total);
 }finally{await bridge.close();}
 const directory=path.join(dataDir,'jobs',job.id),saved=JSON.parse(await fs.readFile(path.join(directory,'job.json'))),protocol={type:'offline-audit-fixture',realModelCalls:0};
 const ledger={protocol,protocolHash:hash(protocol),...frozen,maximumCalls:26,reservedCalls:total,finishedAt:new Date().toISOString(),results:[{
  jobId:job.id,state:saved.state,assemblyCallsReserved:saved.assemblyCallsReserved,assemblyStages:saved.assemblyStages,assetDirectory:directory,startedAt,finishedAt:new Date().toISOString(),assetHash:saved.assetHash
 }]};
 const file=path.join(root,'ledger.json');await fs.writeFile(file,JSON.stringify(ledger));
 const audit=async output=>{
  const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),file,output],{windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>text+=d);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,text};
 };
 const reportFile=path.join(root,'assessment.json'),result=await audit(reportFile);assert.equal(result.code,0,result.text);
 const report=JSON.parse(await fs.readFile(reportFile));assert.equal(report.final.assetHash,saved.assetHash);assert.equal(report.stages[repairAt-1].formatCorrectionOf,invalidAt);assert.equal(report.stages[repairAt-1].state,'accepted');assert.equal(report.additionalModelCalls,0);
 const patchInputFile=path.join(directory,saved.recovery.branch,`assembly/${repairAt}/input.json`),patchInput=JSON.parse(await fs.readFile(patchInputFile));
 patchInput.repairBase.scene.seed++;await fs.writeFile(patchInputFile,JSON.stringify(patchInput));
 const rejected=await audit(path.join(root,'tampered-assessment.json'));assert.notEqual(rejected.code,0);assert.match(rejected.text,/repair base differs/);assert.equal(calls,total);
});
