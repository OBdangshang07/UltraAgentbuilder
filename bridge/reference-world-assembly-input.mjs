import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys} from '../contracts/world-selection.mjs';
import {REFERENCE_OWNER,REFERENCE_LIMITS,REFERENCE_DATA_RULE} from '../contracts/reference-attachments.mjs';
import {validateReferencePreparation} from '../contracts/reference-preparation.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {previewReferenceSet} from './reference-attachments.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';
import {readReferenceWorldPatchPreparationSource} from './reference-world-patch-source.mjs';
import {referenceWorldAssemblyPreparation,verifyReferenceWorldAssemblySend,freezeReferenceWorldAssembly} from './reference-world-assembly.mjs';

// Independent pixel-draft -> FULL joint task authority. No ordinary reference
// generation preparation, confirmation or SEND is manufactured or inherited.
const digest=/^[a-f0-9]{64}$/;
const bytes=value=>Buffer.from(JSON.stringify(value));
const fail=message=>{throw Object.assign(Error(message+'; original joint files retained'),{statusCode:409});};
async function physical(root) {
  root=path.resolve(root);let ancestor=path.parse(root).root;
  for(const part of path.relative(ancestor,root).split(path.sep).filter(Boolean)) {
    ancestor=path.join(ancestor,part);const stat=await fs.lstat(ancestor);
    if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(ancestor)!==ancestor)fail('Joint input directory redirected');
  }
  return root;
}
async function member(root,relative,maximum) {
  if(!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'))fail('Unsafe joint input member');
  const full=path.join(root,relative);await physical(path.dirname(full));const before=await fs.lstat(full);
  const same=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.dev===before.dev&&stat.ino===before.ino
    &&stat.size===before.size&&stat.mtimeMs===before.mtimeMs&&stat.ctimeMs===before.ctimeMs;
  if(!same(before)||before.size<1||before.size>maximum||await fs.realpath(full)!==full)fail('Joint input file type/link/size rejected');
  const handle=await fs.open(full,'r');
  try {
    if(!same(await handle.stat()))fail('Joint input changed before open');
    const value=Buffer.alloc(before.size+1);let count=0;
    while(count<value.length){const result=await handle.read(value,count,value.length-count,count);if(!result.bytesRead)break;count+=result.bytesRead;}
    if(count!==before.size||!same(await handle.stat())||!same(await fs.lstat(full))||await fs.realpath(full)!==full)fail('Joint input changed while reading');
    return value.subarray(0,count);
  } finally {await handle.close();}
}
const json=async(root,name,maximum=131072)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await member(root,name,maximum)));
async function immutable(file,value) {
  const handle=await fs.open(file,'wx',0o600);
  try {await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
}
function identities({contextId,referenceOwnerId,referenceSetHash,generation}) {
  if(!REFERENCE_OWNER.test(contextId??'')||!REFERENCE_OWNER.test(referenceOwnerId??'')||!digest.test(referenceSetHash??'')
    ||generation?.key!==referenceOwnerId)fail('Exact original joint draft/context/key required');
}
function referenceData({ownerId,generation,manifest,runtimeHash}) {
  // Reuse the pure generation/policy VALIDATOR, not its disk protocol or SEND.
  const policy=validateReferencePreparation(ownerId,{format:'ReferenceGenerationPreparationRequest',version:2,generation,
    upload:{format:'UserReferenceUpload',version:1,mode:manifest.mode,
      references:manifest.references.map(r=>({png:'',annotation:r.annotation}))}});
  const requestHash=hash({purpose:'reference-world-assembly',version:2,generation,referenceSetHash:manifest.setHash,policyHash:hash(policy),runtimeHash});
  const content={format:'JointAssemblyReferencePreparation',version:2,purpose:'reference-world-assembly',ownerId,
    provider:'codex',model:generation.model,generation:structuredClone(generation),generationHash:hash(generation),requestHash,
    referenceSetHash:manifest.setHash,references:structuredClone(manifest.references),referenceMode:manifest.mode,policy,runtimeHash,
    referenceAnalysisUsesTaskBudget:true,ordinaryGenerationAuthorityTransferred:false,
    generationSubmitted:false,callsReserved:0,canAuthorizePlacement:false};
  const preparation={...content,preparationHash:hash(content)};
  const bindingContent={format:'JointAssemblyReferenceBinding',version:2,purpose:'reference-world-assembly',jobId:generation.key,ownerId,
    preparationHash:preparation.preparationHash,requestHash,generationHash:preparation.generationHash,
    referenceSetHash:manifest.setHash,policyHash:hash(policy),runtimeHash,provider:'codex',model:generation.model,
    authorization:'independent-full-joint-send-required',ordinaryGenerationAuthorityTransferred:false,canAuthorizePlacement:false};
  return {preparation,binding:{...bindingContent,bindingHash:hash(bindingContent)},manifest};
}
function canonicalReference(ownerId,manifest,images) {
  const computed=previewReferenceSet(ownerId,{format:'UserReferenceUpload',version:1,mode:manifest.mode,
    references:manifest.references.map((r,i)=>({png:images[i].toString('base64'),annotation:r.annotation}))});
  if(hash(computed.manifest)!==hash(manifest)||computed.images.some((v,i)=>!v.equals(images[i])))fail('Original joint reference pixels/annotations changed');
  return computed;
}
async function draft(options) {
  identities(options);
  const {dataDir,contextId,referenceOwnerId,referenceSetHash,generation,selectedCapability}=options;
  const runtimeHash=await assemblyRuntimeIdentity();
  const source=await readReferenceWorldPatchPreparationSource({dataDir,contextId,intent:{referenceOwnerId,referenceSetHash}});
  canonicalReference(referenceOwnerId,source.reference.manifest,source.reference.images);
  const reference=referenceData({ownerId:referenceOwnerId,generation,manifest:source.reference.manifest,runtimeHash});
  const prepared=referenceWorldAssemblyPreparation(reference,source.saved,selectedCapability);
  return {source,reference,prepared};
}

/** Read existing canonical pixel draft and context only. No copied job,
 * confirmation, provider, reservation, SEND record, snapshot refresh or write. */
export async function prepareReferenceWorldAssemblyDraft(options) {
  return (await draft(options)).prepared;
}

export function validateJointAssemblyReferenceInput(input) {
  exactKeys(input,['format','version','purpose','ownerId','bindingHash','preparationHash'],'full joint reference input');
  if(input.format!=='JointAssemblyReferenceInput'||input.version!==2||input.purpose!=='reference-world-assembly'
    ||!REFERENCE_OWNER.test(input.ownerId??'')||!digest.test(input.bindingHash??'')||!digest.test(input.preparationHash??''))fail('Independent full joint reference identity required');
  return input;
}

/** Only a job owner supplies directory; never expose paths in an HTTP body.
 * Copies exact reference bytes after the one NEW complete joint SEND. A partial
 * directory is not adopted, repaired, re-encoded or silently overwritten. */
export async function bindReferenceWorldAssemblyDraft({directory,send,...options}) {
  directory=await physical(directory);
  const {source,reference,prepared}=await draft(options);verifyReferenceWorldAssemblySend(send,prepared);
  if(path.basename(directory)!==prepared.jobId)fail('Original joint job directory/key differs');
  const input={format:'JointAssemblyReferenceInput',version:2,purpose:'reference-world-assembly',ownerId:options.referenceOwnerId,
    bindingHash:reference.binding.bindingHash,preparationHash:prepared.preparationHash};
  const parent=path.join(directory,'reference-input'),root=path.join(parent,input.ownerId);
  try {await fs.mkdir(parent,{mode:0o700});}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const original=await readJointAssemblyReferenceInput({directory,input,model:prepared.selected.model,runtimeHash:prepared.runtimeHash});
    if(hash(original.jointPreparation)!==hash(prepared)||hash(original.send)!==hash(send))fail('Existing full joint input differs');
    await freezeReferenceWorldAssembly({dataDir:options.dataDir,directory,contextId:options.contextId,referenceInput:input,
      selectedCapability:options.selectedCapability,send});
    return {prepared,referenceInput:input};
  }
  await physical(parent);await fs.mkdir(root,{mode:0o700});await physical(root);
  const sets=path.join(root,'reference-sets');await fs.mkdir(sets,{mode:0o700});await physical(sets);
  const set=path.join(sets,prepared.referenceSetHash);await fs.mkdir(set,{mode:0o700});await physical(set);
  for(const [i,image]of source.reference.images.entries())await immutable(path.join(set,`image-${i}.png`),image);
  await immutable(path.join(set,'manifest.json'),source.referenceManifestBytes);
  await immutable(path.join(root,'reference-preparation.json'),bytes(reference.preparation));
  await immutable(path.join(root,'joint-preparation.json'),bytes(prepared));
  await immutable(path.join(root,'send.json'),bytes(send));
  // Binding commits LAST. Unknown partial copies always stay incomplete.
  await immutable(path.join(root,'binding.json'),bytes(reference.binding));
  const owned=await readJointAssemblyReferenceInput({directory,input,model:prepared.selected.model,runtimeHash:prepared.runtimeHash});
  if(hash(owned.jointPreparation)!==hash(prepared))fail('Full joint copied input differs');
  await freezeReferenceWorldAssembly({dataDir:options.dataDir,directory,contextId:options.contextId,referenceInput:input,
    selectedCapability:options.selectedCapability,send});
  return {prepared,referenceInput:input};
}

/** Unified prelude/Codex image reading uses this independent consent. Expired
 * COMPLETED evidence remains readable; fresh dispatch still checks the original
 * archive expiry and runtime. It grants no ordinary generation authority. */
export async function readJointAssemblyReferenceInput({directory,input,model,runtimeHash}) {
  validateJointAssemblyReferenceInput(input);directory=await physical(directory);
  if(path.basename(directory)!==input.ownerId)fail('Original full joint job/owner differs');
  const parent=await physical(path.join(directory,'reference-input'));
  if(hash((await fs.readdir(parent)).sort())!==hash([input.ownerId]))fail('Original joint image owner differs');
  const root=await physical(path.join(parent,input.ownerId));
  const names=['binding.json','joint-preparation.json','reference-preparation.json','reference-sets','send.json'];
  if(hash((await fs.readdir(root)).sort())!==hash(names.sort()))fail('Joint image input incomplete/unknown');
  const binding=await json(root,'binding.json'),preparation=await json(root,'reference-preparation.json');
  const jointPreparation=await json(root,'joint-preparation.json'),send=await json(root,'send.json',4096);
  const {preparationHash,...content}=jointPreparation;
  if(preparationHash!==input.preparationHash||hash(content)!==preparationHash
    ||jointPreparation.format!=='ReferenceWorldAssemblyPreparation'||jointPreparation.version!==2
    ||jointPreparation.purpose!=='reference-world-assembly'||jointPreparation.jobId!==input.ownerId
    ||jointPreparation.referenceBindingHash!==input.bindingHash||jointPreparation.modelSent!==false
    ||jointPreparation.callsReserved!==0||jointPreparation.canAuthorizePlacement!==false)fail('Original complete joint preparation differs');
  verifyReferenceWorldAssemblySend(send,jointPreparation);
  const setHash=jointPreparation.referenceSetHash;
  if(!digest.test(setHash??''))fail('Original joint pixel set identity required');
  const sets=await physical(path.join(root,'reference-sets'));
  if(hash((await fs.readdir(sets)).sort())!==hash([setHash]))fail('Joint image set replaced/duplicated');
  const set=await physical(path.join(sets,setHash)),manifest=await json(set,'manifest.json',65536);
  if(!Array.isArray(manifest.references)||manifest.references.length<1||manifest.references.length>REFERENCE_LIMITS.images)fail('Joint reference image quota');
  const imageNames=manifest.references.map((_,i)=>`image-${i}.png`);
  if(hash((await fs.readdir(set)).sort())!==hash(['manifest.json',...imageNames].sort()))fail('Incomplete/unknown joint image files');
  const images=[];let total=0;
  for(const name of imageNames) {
    const value=await member(set,name,Math.min(REFERENCE_LIMITS.bytesPerImage,REFERENCE_LIMITS.bytesPerSet-total));
    total+=value.length;images.push(value);
  }
  canonicalReference(input.ownerId,manifest,images);
  const expected=referenceData({ownerId:input.ownerId,generation:preparation.generation,manifest,runtimeHash:preparation.runtimeHash});
  if(hash(preparation)!==hash(expected.preparation)||hash(binding)!==hash(expected.binding)||binding.bindingHash!==input.bindingHash
    ||jointPreparation.referencePreparationHash!==preparation.preparationHash||jointPreparation.generationHash!==preparation.generationHash
    ||jointPreparation.policyHash!==hash(preparation.policy)||jointPreparation.runtimeHash!==preparation.runtimeHash
    ||jointPreparation.selected?.agent!=='codex'||jointPreparation.selected.model!==model
    ||jointPreparation.selected.effort!==preparation.generation.effort||model!==preparation.model
    ||runtimeHash!==undefined&&runtimeHash!==preparation.runtimeHash)fail('Original full joint image/model/policy binding differs');
  return {input:structuredClone(input),binding,preparation,manifest,images:imageNames.map(name=>path.join(set,name)),
    jointPreparation,send,rules:REFERENCE_DATA_RULE,canAuthorizePlacement:false};
}
