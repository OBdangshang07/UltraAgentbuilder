import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parentPort,workerData} from 'node:worker_threads';
import {hash} from '../src/generation/compiler.mjs';
import {REFERENCE_OWNER} from '../contracts/reference-attachments.mjs';
import {validateReferenceGenerationSend} from '../contracts/reference-generation.mjs';
import {validateReferenceGenerationJobRequest,REFERENCE_JOB_LIMITS} from '../contracts/reference-generation-job.mjs';
import {readReferencePreparation} from './reference-preparation-data.mjs';
import {bindReferencePreparationToJob,readJobReferenceInput,readReferencePreparationConfirmation} from './reference-generation-binding.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {readReferenceJobHistory} from './reference-job-history.mjs';

async function physical(directory,create=false){
  if(create)await fs.mkdir(directory).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await fs.lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Reference SEND directory redirected');
  assert.equal(await fs.realpath(directory),directory);return directory;
}
async function immutable(file,value){
  const bytes=Buffer.from(JSON.stringify(value)),handle=await fs.open(file,'wx',0o600).catch(async e=>{
    if(e.code!=='EEXIST')throw e;
    assert.ok((await safeEvidenceFile(path.dirname(file),path.basename(file),32768)).equals(bytes),'Original reference SEND cannot be replaced');return null;
  });
  if(handle)try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
function checkedIntent(value,ownerId){
  const {intentHash,...content}=value;
  assert.deepEqual(Object.keys(content).sort(),['format','version','jobId','ownerId','requestHash','runtimeHash','submission'].sort());
  assert.equal(content.format,'ReferenceGenerationSubmission');assert.equal(content.version,1);
  assert.match(content.jobId,REFERENCE_OWNER);assert.equal(content.ownerId,ownerId);
  validateReferenceGenerationJobRequest(content.submission);assert.equal(content.submission.ownerId,ownerId);
  assert.equal(content.runtimeHash,content.submission.sendConfirmation.runtimeHash);
  assert.equal(content.requestHash,hash(content.submission));assert.equal(intentHash,hash(content));return value;
}
async function list(dataDir){
  const parent=path.join(dataDir,'reference-submissions');
  try{await physical(parent);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const names=await fs.readdir(parent);assert.ok(names.length<=REFERENCE_JOB_LIMITS.submissions,'Reference submission quota exceeded');
  assert.ok(names.every(n=>n.endsWith('.json')&&REFERENCE_OWNER.test(n.slice(0,-5))),'Unknown reference submission entry');
  const entries=[];
  for(const name of names)entries.push(checkedIntent(JSON.parse((await safeEvidenceFile(parent,name,32768)).toString('utf8')),name.slice(0,-5)));
  assert.equal(new Set(entries.map(e=>e.jobId)).size,entries.length,'Reference job ID reused');return entries;
}
function descriptor(intent,reference){
  const p=reference.preparation;assert.equal(p.version,2,'Production reference SEND requires preparation v2');
  validateReferenceGenerationSend(intent.submission.sendConfirmation,p);
  assert.equal(p.generation.key,intent.ownerId);assert.equal(p.runtimeHash,intent.runtimeHash);
  assert.equal(p.policy.assembly?.referenceAnalysis?.mode,'job-owned-prelude');
  return {jobId:intent.jobId,key:intent.ownerId,requestHash:intent.requestHash,request:p.generation,
    policy:p.policy,referenceInput:reference.input,runtimeHash:p.runtimeHash,submission:intent.submission,canAuthorizePlacement:false};
}
export async function referenceGenerationOperation({dataDir,operation,input,jobId,imageId,runtimeHash,capability}){
  dataDir=path.resolve(dataDir);await physical(dataDir);const submissions=await list(dataDir);
  if(operation==='list')return submissions.map(({jobId,ownerId,requestHash,submission})=>({jobId,ownerId,requestHash,submission}));
  if(['recover','history','image'].includes(operation)){
    if(operation==='image')assert.match(imageId,/^[a-f0-9]{64}$/);
    assert.match(jobId,REFERENCE_OWNER);const intent=submissions.find(s=>s.jobId===jobId);assert.ok(intent,'Original reference SEND index missing');
    if(operation==='recover')assert.equal(intent.runtimeHash,runtimeHash,'Reference SEND runtime changed; no model called');
    const directory=path.join(dataDir,'jobs',jobId);await physical(directory);
    const saved=JSON.parse((await safeEvidenceFile(directory,'reference-recovery-request.json',32768)).toString('utf8'));
    const {recoveryHash,...content}=saved;assert.equal(recoveryHash,hash(content));
    assert.deepEqual(Object.keys(content).sort(),['format','version','submissionHash','referenceInput'].sort());
    assert.equal(content.format,'ReferenceGenerationRecoveryRequest');assert.equal(content.version,1);
    assert.equal(content.submissionHash,intent.intentHash);
    const reference=await readJobReferenceInput({directory,input:content.referenceInput,model:intent.submission.sendConfirmation.model,runtimeHash:intent.runtimeHash});
    if(operation!=='recover')return readReferenceJobHistory({directory,intent,reference,...(operation==='image'?{imageId}:{})});
    return descriptor(intent,reference);
  }
  assert.equal(operation,'submit');assert.ok(input?.byteLength>0&&input.byteLength<=REFERENCE_JOB_LIMITS.inputBytes);
  const submission=validateReferenceGenerationJobRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input)));
  const requestHash=hash(submission),existing=submissions.find(s=>s.ownerId===submission.ownerId);
  if(existing)assert.equal(existing.requestHash,requestHash,'Idempotency key reused with changed reference SEND');
  assert.equal(submission.sendConfirmation.runtimeHash,runtimeHash,'Reference runtime changed; prepare again before SEND');
  const jobs=await physical(path.join(dataDir,'jobs')),directory=existing?path.join(jobs,existing.jobId):null;
  if(existing){
    // A complete job-owned capsule no longer depends on mutable draft storage.
    try{
      const recovered=await referenceGenerationOperation({dataDir,operation:'recover',jobId:existing.jobId,runtimeHash});
      assert.equal(capability?.id,recovered.request.model);assert.equal(capability.supportsImages,true,'Selected model has not advertised reference-image input');return recovered;
    }catch(e){if(e.code!=='ENOENT')throw e;}
    // Missing capsule can be completed locally only before any publication or
    // invocation. Never rebind a dispatched job or guess an unknown receipt.
    const names=await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    assert.ok(!names.some(n=>['job.json','assembly-journal'].includes(n)||n.startsWith('assembly-run-')||n.startsWith('codex-response-')),
      'Published reference job is missing its original capsule; no resend');
  }
  const source=path.join(dataDir,'reference-drafts',submission.ownerId);await physical(source);
  const {preparation:p}=await readReferencePreparation(source,submission.ownerId,submission.preparationHash);
  assert.equal(p.version,2,'Production reference SEND requires preparation v2');validateReferenceGenerationSend(submission.sendConfirmation,p);
  assert.equal(runtimeHash,p.runtimeHash);assert.equal(capability?.id,p.model);assert.equal(capability.supportsImages,true,'Selected model has not advertised reference-image input');
  await readReferencePreparationConfirmation(source,p);
  let intent=existing;
  if(!intent){
    assert.ok(submissions.length<REFERENCE_JOB_LIMITS.submissions,'Reference submission quota reached');
    const parent=await physical(path.join(dataDir,'reference-submissions'),true);
    const content={format:'ReferenceGenerationSubmission',version:1,jobId:randomUUID(),ownerId:submission.ownerId,requestHash,runtimeHash,submission};
    intent={...content,intentHash:hash(content)};await immutable(path.join(parent,submission.ownerId+'.json'),intent);
  }
  const jobDirectory=await physical(path.join(jobs,intent.jobId),true);
  const referenceInput=await bindReferencePreparationToJob({dataDir,jobDirectory,ownerId:submission.ownerId,
    preparationHash:submission.preparationHash,generation:p.generation,runtimeHash,capability,sendConfirmation:submission.sendConfirmation});
  const content={format:'ReferenceGenerationRecoveryRequest',version:1,submissionHash:intent.intentHash,referenceInput};
  await immutable(path.join(jobDirectory,'reference-recovery-request.json'),{...content,recoveryHash:hash(content)});
  return referenceGenerationOperation({dataDir,operation:'recover',jobId:intent.jobId,runtimeHash});
}
if(parentPort&&workerData?.kind==='reference-generation-v1'){
  try{parentPort.postMessage({ok:true,value:await referenceGenerationOperation(workerData)});}
  catch(e){parentPort.postMessage({ok:false,error:e.message,code:e.code??null});}
}
