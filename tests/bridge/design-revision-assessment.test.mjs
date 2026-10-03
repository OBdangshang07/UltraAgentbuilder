import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan,planEdit} from '../design/assembly-fixtures.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';

test('terminal auditor reconstructs image-revision history and rejects altered context or stripped attachment receipts',async()=>{
 const project=fileURLToPath(new URL('../../',import.meta.url));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-visual-revision-audit-'));
 const snapshot=await freezeSceneRuntime(project,path.join(directory,'runtime'));
 const mod=n=>import(pathToFileURL(path.join(snapshot.runtime,n)));
 const {runSceneAssembly}=await mod('bridge/scene-assembly.mjs');
 const {generationPreflight}=await mod('bridge/generation-policy.mjs');
 const {requestNativeEvidence,acceptNativeEvidence}=await mod('bridge/native-evidence.mjs');
 const request={agent:'codex',model:'offline',prompt:'16×10×16格审计用例',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyQuality:'v3',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
 let records=[],calls=0;
 const startedAt=new Date().toISOString();
 await assert.rejects(runSceneAssembly({directory,prompt:request.prompt,policy:generationPreflight(request),signal:new AbortController().signal,
  rules:await fs.readFile(path.join(snapshot.runtime,'prompts/scene-v1.md'),'utf8'),onStage:async r=>{records=r;},
  nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:directory,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting')await acceptNativeEvidence(directory,s.id,fixtureUpload(s.request));}}),
  invoke:async(p,i,o)=>{
   calls++;const input=JSON.parse(p.split('Assembly input (data):\n').at(-1));
   if(i===1)return {format:'SceneConceptSet',version:1,candidates:Array.from({length:input.count},(_,n)=>{
    const scene=assemblyPlan().scene;scene.components[0].size[0]-=n;scene.constraints={...scene.constraints,interior:false,walkable:false,passages:[]};return {id:'candidate-'+n,rationale:'Offline audit, not quality evidence',scene};
   })};
   if(i===2)return {format:'SceneConceptSelection',version:1,candidateSetHash:input.candidateSetHash,evidenceHash:input.designEvidence.evidenceHash,selected:input.candidates[0].id,reason:'Offline audit',comparisons:input.designEvidence.subjects.map(s=>({id:s.id,strength:'Fixture',weakness:'Not quality proof',views:[input.designEvidence.views.findIndex(v=>v.subjectId===s.id)]}))};
   if(i===3)return assemblyPlan();
   if(i===4)return {format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:input.designEvidence.evidenceHash,verdict:'revise',summary:'Offline audit',issues:[{criterion:'facade',evidence:'Fixture facade',change:'Coordinate actual geometry'}]};
   if(i===5){assert.equal(o.images.length,8);const next=structuredClone(input.priorPlan);next.scene.palette[0].material='quartz';return planEdit(input.priorPlan,next);}
   throw new Error('offline terminal fixture after saved visual revision');
  }
 }),/offline terminal fixture/);
 assert.equal(calls,6);assert.equal(records[4].state,'accepted');
 const job={id:'offline-image-revision',state:'failed',model:'offline',assemblyCallsReserved:records.length,assemblyStages:records,generations:records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),error:'offline terminal fixture',recoveryEnabled:false};
 const protocol={type:'offline-image-revision-audit',realModelCalls:0};
 const ledger={protocol,protocolHash:hash(protocol),...snapshot,maximumCalls:26,reservedCalls:records.length,finishedAt:new Date().toISOString(),results:[{jobId:job.id,state:job.state,assemblyCallsReserved:records.length,assemblyStages:records,assetDirectory:directory,startedAt,finishedAt:new Date().toISOString()}]};
 const jobFile=path.join(directory,'job.json'),ledgerFile=path.join(directory,'ledger.json');
 await fs.writeFile(jobFile,JSON.stringify(job));await fs.writeFile(ledgerFile,JSON.stringify(ledger));
 const audit=async name=>{
  const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,path.join(directory,name+'.json')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';
  child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>text+=d);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,text};
 };
 const good=await audit('assessment');assert.equal(good.code,0,good.text);
 const inputFile=path.join(directory,'assembly/5/input.json'),original=await fs.readFile(inputFile,'utf8'),input=JSON.parse(original);
 input.designRevisionContext.activeConcerns[0].consecutiveRounds=99;await fs.writeFile(inputFile,JSON.stringify(input));
 const badContext=await audit('bad-context');assert.notEqual(badContext.code,0);assert.match(badContext.text,/context mismatch/);
 await fs.writeFile(inputFile,original);
 delete records[4].imageCount;delete records[4].imageEvidenceHash;
 await fs.writeFile(jobFile,JSON.stringify(job));await fs.writeFile(ledgerFile,JSON.stringify(ledger));
 const badAttachment=await audit('bad-attachment');assert.notEqual(badAttachment.code,0);assert.match(badAttachment.text,/image attachment receipt/);
 assert.equal(calls,6);
});
