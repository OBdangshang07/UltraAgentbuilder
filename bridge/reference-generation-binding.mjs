import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {REFERENCE_OWNER,REFERENCE_LIMITS,REFERENCE_DATA_RULE,referenceConfirmation} from '../contracts/reference-attachments.mjs';
import {validateReferenceGenerationSend,validateJobReferenceInput,REFERENCE_DIGEST} from '../contracts/reference-generation.mjs';
import {readReferencePreparation} from './reference-preparation-data.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';

async function physical(directory,create=false){
  if(create)await fs.mkdir(directory).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await fs.lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Reference directory link/type rejected');
  assert.equal(await fs.realpath(directory),directory,'Reference directory redirected');return directory;
}
async function immutable(file,bytes){
  try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;
    assert.ok((await safeEvidenceFile(path.dirname(file),path.basename(file),REFERENCE_LIMITS.bytesPerImage)).equals(bytes),'Job reference identity conflict');}
}
export async function readReferencePreparationConfirmation(root,p){
  const saved=JSON.parse((await safeEvidenceFile(root,`preparations/${p.preparationHash}/confirmation.json`,16384)).toString('utf8'));
  assert.deepEqual(Object.keys(saved).sort(),['confirmation','receipt']);referenceConfirmation(saved.confirmation);
  const expected={format:'ReferenceSendConfirmation',version:1,ownerId:p.ownerId,requestHash:p.requestHash,
    setHash:p.referenceSetHash,provider:p.provider,model:p.model,accepted:true};
  assert.deepEqual(saved.confirmation,expected,'Original free preparation confirmation changed');
  const content={format:'ReferencePreparationConfirmation',version:1,ownerId:p.ownerId,preparationHash:p.preparationHash,
    requestHash:p.requestHash,referenceSetHash:p.referenceSetHash,provider:p.provider,model:p.model,
    confirmationHash:hash(expected),accepted:true,generationSubmitted:false,callsReserved:0,sendingImplemented:false,canAuthorizePlacement:false};
  assert.deepEqual(saved.receipt,{...content,receiptHash:hash(content)},'Original preparation confirmation receipt mismatch');
  return saved.receipt;
}
function bindingContent(jobId,p,receipt,sendConfirmation){
  return {format:'JobReferenceBinding',version:1,jobId,ownerId:p.ownerId,preparationHash:p.preparationHash,
    requestHash:p.requestHash,generationHash:p.generationHash,referenceSetHash:p.referenceSetHash,
    policyHash:hash(p.policy),runtimeHash:p.runtimeHash,provider:p.provider,model:p.model,
    preparationConfirmationHash:receipt.receiptHash,sendConfirmationHash:hash(sendConfirmation),
    referenceAnalysisUsesTaskBudget:true,canAuthorizePlacement:false};
}

/** Freeze exact draft bytes into a newly owned job. Does not invoke a provider,
 * reserve a call, publish a job, or authorize any world write. */
export async function bindReferencePreparationToJob({dataDir,jobDirectory,ownerId,preparationHash,generation,runtimeHash,capability,sendConfirmation}){
  dataDir=path.resolve(dataDir);jobDirectory=path.resolve(jobDirectory);
  await physical(dataDir);await physical(jobDirectory);assert.match(path.basename(jobDirectory),REFERENCE_OWNER);
  assert.match(ownerId,REFERENCE_OWNER);assert.match(preparationHash,REFERENCE_DIGEST);
  const sourceParent=await physical(path.join(dataDir,'reference-drafts')),source=await physical(path.join(sourceParent,ownerId));
  const {preparation:p,references}=await readReferencePreparation(source,ownerId,preparationHash);
  assert.deepEqual(generation,p.generation,'Reference generation changed after preparation');
  assert.equal(runtimeHash,p.runtimeHash,'Reference runtime changed after preparation');
  assert.equal(capability?.id,p.model);assert.equal(capability.supportsImages,true,'Selected model has not advertised reference-image input');
  const receipt=await readReferencePreparationConfirmation(source,p);validateReferenceGenerationSend(sendConfirmation,p);
  const content=bindingContent(path.basename(jobDirectory),p,receipt,sendConfirmation),binding={...content,bindingHash:hash(content)};
  const parent=await physical(path.join(jobDirectory,'reference-input'),true);
  // One stable owner/set/preparation per job. Different SEND identities must
  // create a different job, never silently replace a dispatched job's input.
  const entries=await fs.readdir(parent);assert.ok(entries.every(n=>n===ownerId),'A job cannot reference another draft');
  const target=await physical(path.join(parent,ownerId),true);
  const existing=await fs.readdir(target);
  if(existing.includes('binding.json')){
    const input={format:'JobReferenceInput',version:1,ownerId,bindingHash:binding.bindingHash};
    return (await readJobReferenceInput({directory:jobDirectory,input,model:p.model,runtimeHash})).input;
  }
  assert.ok(existing.every(n=>['reference-sets','preparations','send.json'].includes(n)),'Unknown job reference file');
  // Copy the original canonical images and manifest, not a re-encoded upload.
  const setParent=await physical(path.join(target,'reference-sets'),true),setRoot=await physical(path.join(setParent,p.referenceSetHash),true);
  assert.deepEqual(await fs.readdir(setParent),[p.referenceSetHash],'Job image set cannot be replaced');
  for(const r of references.manifest.references)
    await immutable(path.join(setRoot,r.file),await safeEvidenceFile(source,`reference-sets/${p.referenceSetHash}/${r.file}`,REFERENCE_LIMITS.bytesPerImage));
  await immutable(path.join(setRoot,'manifest.json'),await safeEvidenceFile(source,`reference-sets/${p.referenceSetHash}/manifest.json`,65536));
  const prepParent=await physical(path.join(target,'preparations'),true),prepRoot=await physical(path.join(prepParent,preparationHash),true);
  assert.deepEqual(await fs.readdir(prepParent),[preparationHash],'Job preparation cannot be replaced');
  for(const name of ['preparation.json','confirmation.json'])
    await immutable(path.join(prepRoot,name),await safeEvidenceFile(source,`preparations/${preparationHash}/${name}`,131072));
  await immutable(path.join(target,'send.json'),Buffer.from(JSON.stringify(sendConfirmation)));
  // Binding is committed last; incomplete copies never become sendable.
  await immutable(path.join(target,'binding.json'),Buffer.from(JSON.stringify(binding)));
  const input={format:'JobReferenceInput',version:1,ownerId,bindingHash:binding.bindingHash};
  return (await readJobReferenceInput({directory:jobDirectory,input,model:p.model,runtimeHash})).input;
}

export async function readJobReferenceInput({directory,input,model,runtimeHash}){
  // A separately versioned full joint SEND may use the SAME reference-analysis
  // pipeline. It is never an ordinary ReferenceGenerationSend or v1 input.
  if(input?.format==='JointAssemblyReferenceInput')
    return (await import('./reference-world-assembly-input.mjs')).readJointAssemblyReferenceInput({directory,input,model,runtimeHash});
  validateJobReferenceInput(input);directory=path.resolve(directory);await physical(directory);
  const jobId=path.basename(directory);assert.match(jobId,REFERENCE_OWNER);
  const parent=await physical(path.join(directory,'reference-input'));
  assert.deepEqual(await fs.readdir(parent),[input.ownerId],'Job reference owner mismatch');
  const root=await physical(path.join(parent,input.ownerId));
  assert.deepEqual((await fs.readdir(root)).sort(),['binding.json','preparations','reference-sets','send.json']);
  const binding=JSON.parse((await safeEvidenceFile(root,'binding.json',16384)).toString('utf8'));
  assert.match(binding.preparationHash,REFERENCE_DIGEST);
  const {preparation:p,references}=await readReferencePreparation(root,input.ownerId,binding.preparationHash);
  const receipt=await readReferencePreparationConfirmation(root,p),sendConfirmation=JSON.parse((await safeEvidenceFile(root,'send.json',16384)).toString('utf8'));
  validateReferenceGenerationSend(sendConfirmation,p);
  const content=bindingContent(jobId,p,receipt,sendConfirmation),expected={...content,bindingHash:hash(content)};
  assert.deepEqual(binding,expected,'Job reference binding identity mismatch');assert.equal(input.bindingHash,binding.bindingHash);
  assert.equal(model,binding.model,'Job reference selected model mismatch');
  if(runtimeHash!==undefined)assert.equal(runtimeHash,binding.runtimeHash,'Job reference runtime mismatch');
  assert.deepEqual(await fs.readdir(path.join(root,'reference-sets')),[p.referenceSetHash]);
  assert.deepEqual(await fs.readdir(path.join(root,'preparations')),[p.preparationHash]);
  return {input:structuredClone(input),binding,preparation:p,manifest:references.manifest,images:references.images,
    rules:REFERENCE_DATA_RULE,canAuthorizePlacement:false};
}
