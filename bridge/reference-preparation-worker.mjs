import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parentPort,workerData} from 'node:worker_threads';
import {hash} from '../src/generation/compiler.mjs';
import {REFERENCE_OWNER,REFERENCE_LIMITS,referenceConfirmation} from '../contracts/reference-attachments.mjs';
import {REFERENCE_PREPARATION_LIMITS as limits,validateReferencePreparation} from '../contracts/reference-preparation.mjs';
import {importReferenceSet,prepareReferenceModelInput,previewReferenceSet} from './reference-attachments.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {REFERENCE_ARCHIVE_OPERATIONS,REFERENCE_ARCHIVE_MAINTENANCE_OPERATIONS} from '../contracts/reference-archive.mjs';
import {referencePreparationRequestHash,readReferencePreparation} from './reference-preparation-data.mjs';
export {referencePreparationRequestHash,readReferencePreparation} from './reference-preparation-data.mjs';

const digest=/^[a-f0-9]{64}$/;
async function physicalDirectory(directory,create=false){
  if(create)await fs.mkdir(directory).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await fs.lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(await fs.realpath(directory),directory);return directory;
}
async function immutable(file,value){
  const bytes=Buffer.from(JSON.stringify(value));
  try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;const existing=await safeEvidenceFile(path.dirname(file),path.basename(file),limits.inputBytes);assert.ok(existing.equals(bytes),'Reference preparation identity conflict');}
}
async function namedDirectories(folder,pattern,maximum){
  let entries=[];try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  assert.ok(entries.every(e=>e.isDirectory()&&!e.isSymbolicLink()&&pattern.test(e.name)),'Unknown or linked reference preparation entry');
  assert.ok(entries.length<=maximum,'Reference preparation storage quota exceeded');return entries.map(e=>e.name);
}
function decode(bytes){
  assert.ok(bytes.byteLength>0&&bytes.byteLength<=limits.inputBytes,'Reference preparation input byte quota');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function referencePreparationOperation({dataDir,operation,ownerId,input,preparationHash,imageId,runtimeHash,capability,actionId,archiveActionId,purpose}){
  if(REFERENCE_ARCHIVE_MAINTENANCE_OPERATIONS.includes(operation))return (await import('./reference-archive-maintenance.mjs')).referenceArchiveMaintenanceOperation({dataDir,operation,ownerId,input,actionId,archiveActionId,purpose});
  if(REFERENCE_ARCHIVE_OPERATIONS.includes(operation))return (await import('./reference-archive.mjs')).referenceArchiveOperation({dataDir,operation,ownerId,input,actionId});
  dataDir=path.resolve(dataDir);await physicalDirectory(dataDir);assert.match(ownerId,REFERENCE_OWNER);
  assert.ok(['prepare','get','record','image','confirm'].includes(operation));
  const parent=path.join(dataDir,'reference-drafts'),root=path.join(parent,ownerId);
  if(operation==='prepare'){
    const value=decode(input),policy=validateReferencePreparation(ownerId,value);
    assert.equal(capability?.id,value.generation.model);assert.equal(capability.supportsImages,true,'Selected model has not advertised reference-image input');
    assert.match(runtimeHash,digest);
    await (await import('./reference-archive.mjs')).assertReferenceDraftWritable(dataDir,ownerId);
    await physicalDirectory(parent,true);
    const drafts=await namedDirectories(parent,REFERENCE_OWNER,limits.drafts);
    if(!drafts.includes(ownerId))assert.ok(drafts.length<limits.drafts,'Reference draft storage quota reached');
    await physicalDirectory(root,true);
    const sets=await namedDirectories(path.join(root,'reference-sets'),digest,limits.setsPerDraft);
    const preparations=await namedDirectories(path.join(root,'preparations'),digest,limits.preparationsPerDraft);
    // A full owner may still reread/reconfirm existing preparation, but new
    // imports must not grow storage without the separate confirmed archive protocol.
    const preview=previewReferenceSet(ownerId,value.upload).manifest,generation=value.generation;
    const content={format:'ReferenceGenerationPreparation',version:value.version,ownerId,provider:'codex',model:generation.model,generation,
      generationHash:hash(generation),requestHash:referencePreparationRequestHash({version:value.version,generation,referenceSetHash:preview.setHash,policy,runtimeHash}),referenceSetHash:preview.setHash,
      references:preview.references,referenceMode:preview.mode,policy,runtimeHash,referenceAnalysisUsesTaskBudget:true,
      generationSubmitted:false,callsReserved:0,sendingImplemented:false,canAuthorizePlacement:false};
    const preparation={...content,preparationHash:hash(content)},folder=path.join(root,'preparations',preparation.preparationHash);
    assert.ok(sets.includes(preview.setHash)||sets.length<limits.setsPerDraft,'Reference image-set quota reached');
    assert.ok(preparations.includes(preparation.preparationHash)||preparations.length<limits.preparationsPerDraft,'Reference preparation quota reached');
    const manifest=await importReferenceSet(root,value.upload);assert.equal(manifest.setHash,preview.setHash);
    await physicalDirectory(path.dirname(folder),true);await physicalDirectory(folder,true);await immutable(path.join(folder,'preparation.json'),preparation);
    return (await readReferencePreparation(root,ownerId,preparation.preparationHash)).preparation;
  }
  await physicalDirectory(parent);await physicalDirectory(root);
  const {preparation,references,recordBytes}=await readReferencePreparation(root,ownerId,preparationHash);
  if(operation==='get')return preparation;
  if(operation==='record')return {record:recordBytes,sha256:hash(recordBytes)};
  if(operation==='image'){
    assert.match(imageId,digest);const index=references.manifest.references.findIndex(r=>r.id===imageId);assert.ok(index>=0,'Image is not in this exact prepared set');
    const bytes=await safeEvidenceFile(root,`reference-sets/${preparation.referenceSetHash}/image-${index}.png`,REFERENCE_LIMITS.bytesPerImage);
    assert.equal(hash(bytes),references.manifest.references[index].sha256);return {png:bytes,sha256:hash(bytes)};
  }
  const confirmation=decode(input);referenceConfirmation(confirmation);
  assert.equal(runtimeHash,preparation.runtimeHash,'Reference preparation runtime changed; prepare and inspect again before sending');
  await prepareReferenceModelInput({directory:root,setHash:preparation.referenceSetHash,requestHash:preparation.requestHash,
    provider:preparation.provider,model:preparation.model,capability,confirmation});
  const content={format:'ReferencePreparationConfirmation',version:1,ownerId,preparationHash,requestHash:preparation.requestHash,
    referenceSetHash:preparation.referenceSetHash,provider:preparation.provider,model:preparation.model,
    confirmationHash:hash(confirmation),accepted:true,generationSubmitted:false,callsReserved:0,sendingImplemented:false,canAuthorizePlacement:false};
  const receipt={...content,receiptHash:hash(content)};
  await immutable(path.join(root,'preparations',preparationHash,'confirmation.json'),{receipt,confirmation});return receipt;
}
if(parentPort&&workerData?.kind==='reference-preparation-v1'){
  try{parentPort.postMessage({ok:true,value:await referencePreparationOperation(workerData)});}
  catch(e){parentPort.postMessage({ok:false,error:e.message,code:e.code??null});}
}
