import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys} from '../contracts/world-selection.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {prepareCoupledAssemblyWorldContext} from '../src/world/assembly-coupled-context.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';
import {readReferenceWorldPatchPreparationSource,rebuildReferenceWorldPatchContextSource,REFERENCE_PATCH_CONTEXT_FILE_LIMITS} from './reference-world-patch-source.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {assemblyRuntimeIdentity} from './assembly-durability.mjs';

// Independent new preparation/archive/SEND. There is deliberately NO adapter,
// model budget reservation, candidate, HTTP endpoint or native world writer.
export const COUPLED_REFERENCE_ASSEMBLY_ARCHIVE='coupled-reference-world-assembly-v1';
const purpose='coupled-reference-world-assembly',archiveFiles={...REFERENCE_PATCH_CONTEXT_FILE_LIMITS,'preparation.json':65536,'send.json':4096};
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};
const raw=v=>Buffer.from(JSON.stringify(v));
function capability(value,generation){
  exactKeys(value,['id','supportsImages','efforts'],'explicit coupled image capability');
  if(value.id!==generation.model||value.supportsImages!==true||!Array.isArray(value.efforts)||!value.efforts.length||value.efforts.length>16
    ||value.efforts.some(e=>!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(e))
    ||new Set(value.efforts).size!==value.efforts.length||!value.efforts.includes(generation.effort))throw Error('Exact advertised coupled image model/effort required');
  return structuredClone(value);
}
export function coupledReferenceWorldAssemblyPreparation(reference,saved,selectedCapability){
  const p=reference.preparation,generation=p.generation,tier=p.policy.assembly;
  const supportedReference=p.version===2||p.format==='CoupledAssemblyReferencePreparation'&&p.version===1;
  if(!supportedReference||generation.agent!=='codex'||generation.assemblyConfirmed!==true||tier.recovery?.mode!=='safe'
    ||tier.designReview?.mode!=='native'||![2,3,4].includes(tier.quality?.version))throw Error('New coupled task requires explicit shared reference policy, safe recovery and native review');
  const worldContext=prepareCoupledAssemblyWorldContext(saved.snapshot);
  if(p.policy.minimumHeight>worldContext.maximumBounds.height||p.policy.maximumBounds&&Object.keys(worldContext.maximumBounds).some(k=>p.policy.maximumBounds[k]>worldContext.maximumBounds[k]))throw Error('Requested coupled building cannot fit original W; no shrinking or clipping');
  const value={format:'CoupledReferenceWorldAssemblyPreparation',version:1,purpose,
    jobId:reference.binding.jobId,contextId:saved.record.id,recordHash:saved.record.recordHash,payloadSha256:saved.record.payloadSha256,recordExpiresAt:saved.record.expiresAt,
    referenceBindingHash:reference.binding.bindingHash,referenceSetHash:reference.manifest.setHash,referencePreparationHash:p.preparationHash,
    generationHash:p.generationHash,policyHash:hash(p.policy),runtimeHash:p.runtimeHash,
    selected:{agent:generation.agent,model:generation.model,effort:generation.effort,capability:capability(selectedCapability,generation)},
    tier:tier.id,maximumCalls:tier.maximumCalls,providerRetries:tier.providerRetries,
    snapshotHash:worldContext.snapshotHash,selectionHash:worldContext.selectionHash,worldContextHash:worldContext.worldContextHash,
    couplingPolicyHash:worldContext.couplingPolicyHash,generationProtocolHash:worldContext.protocolHash,
    origin:[...worldContext.origin],maximumBounds:structuredClone(worldContext.maximumBounds),imageCount:reference.manifest.references.length,
    imageAnnotations:reference.manifest.references.map(({id,width,height,annotation,sha256})=>({id,width,height,annotation,sha256})),
    stages:'same-reference-analysis-concepts-prototypes-components-native-review-pipeline',
    budget:'one-original-shared-ledger-including-analysis-corrections-recovery-and-review',
    privacy:'confirmed-reference-pixels-and-original-block-context-no-HUD-accounts-or-container-content',
    targetPolicy:'new-complete-native-coupled-groups-only',sourceAuthority:worldContext.sourceAuthority,
    legacyFullConsentTransferable:false,state:'prepared-not-sent',modelSent:false,callsReserved:0,serverBaselineVerified:false,canAuthorizePlacement:false};
  if(raw(value).length+128>65536)throw Error('Complete coupled preparation quota');return freeze({...value,preparationHash:hash(value)});
}
export function verifyCoupledReferenceWorldAssemblySend(send,prepared){
  exactKeys(send,['format','version','purpose','confirmed','preparationHash','maximumCalls'],'independent coupled full-task SEND');
  if(prepared.format!=='CoupledReferenceWorldAssemblyPreparation'||prepared.version!==1||prepared.purpose!==purpose
    ||send.format!=='CoupledReferenceWorldAssemblySend'||send.version!==1||send.purpose!==purpose||send.confirmed!==true
    ||send.preparationHash!==prepared.preparationHash||send.maximumCalls!==prepared.maximumCalls)throw Error('New exact coupled full-task SEND required; legacy consent cannot transfer');
}

async function physical(directory){
  const absolute=path.resolve(directory);if(absolute!==directory)throw Error('Physical absolute coupled archive required');let current=path.parse(absolute).root;
  for(const part of ['',...path.relative(current,absolute).split(path.sep).filter(Boolean)]){current=path.join(current,part);const s=await fs.lstat(current);if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(current)!==current)throw Error('Coupled archive directory redirected; retained');}
}
async function member(root,name,maximum){
  await physical(root);const bytes=await safeEvidenceFile(root,name,maximum),stat=await fs.lstat(path.join(root,name));
  if(!bytes.length||stat.nlink!==1||stat.size!==bytes.length)throw Error('Original coupled archive member type/link/quota changed');return bytes;
}
async function immutable(file,bytes){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}

export async function prepareCoupledReferenceWorldAssembly({dataDir,directory,contextId,referenceInput,selectedCapability}){
  directory=path.resolve(directory);await physical(directory);const runtimeHash=await assemblyRuntimeIdentity();
  const reference=await readJobReferenceInput({directory,input:referenceInput,model:selectedCapability?.id,runtimeHash});
  const source=await readReferenceWorldPatchPreparationSource({dataDir,contextId,intent:{referenceOwnerId:reference.input.ownerId,referenceSetHash:reference.manifest.setHash}});
  if(hash(source.reference.manifest)!==hash(reference.manifest))throw Error('Original coupled world/reference picture annotations differ');
  for(const [i,image]of source.reference.images.entries())if(hash(image)!==hash(await fs.readFile(reference.images[i])))throw Error('Original coupled world/reference pixels differ');
  return coupledReferenceWorldAssemblyPreparation(reference,source.saved,selectedCapability);
}
export async function freezeCoupledReferenceWorldAssembly(options){
  const {dataDir,contextId,referenceInput,selectedCapability,send}=options,directory=path.resolve(options.directory);
  const prepared=await prepareCoupledReferenceWorldAssembly({dataDir,directory,contextId,referenceInput,selectedCapability});verifyCoupledReferenceWorldAssemblySend(send,prepared);
  if(Date.now()>=prepared.recordExpiresAt)throw Error('Original capture expired before coupled freeze; no refresh');
  const root=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_ARCHIVE);
  try{await fs.mkdir(root,{mode:0o700});}catch(error){
    if(error.code!=='EEXIST')throw error;const old=await readFrozenCoupledReferenceWorldAssembly({directory,referenceInput});
    if(hash(old.prepared)!==hash(prepared)||hash(old.send)!==hash(send))throw Error('Existing coupled archive/SEND differs; retained');return old.prepared;
  }
  await physical(root);
  const source=await readReferenceWorldPatchPreparationSource({dataDir,contextId,intent:{referenceOwnerId:referenceInput.ownerId,referenceSetHash:prepared.referenceSetHash}});
  const reference=await readJobReferenceInput({directory,input:referenceInput,model:prepared.selected.model,runtimeHash:prepared.runtimeHash});
  if(hash(coupledReferenceWorldAssemblyPreparation(reference,source.saved,selectedCapability))!==hash(prepared))throw Error('Coupled scope/policy changed while freezing; partial archive retained');
  const values={...source.contextFiles,'preparation.json':raw(prepared),'send.json':raw(send)},files=[];
  for(const [name,maximum]of Object.entries(archiveFiles)){const bytes=values[name];if(!bytes.length||bytes.length>maximum)throw Error('Coupled source archive quota; partial retained');await immutable(path.join(root,name),bytes);files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
  const value={format:'CoupledReferenceWorldAssemblyArchive',version:1,purpose,preparationHash:prepared.preparationHash,frozenAt:Date.now(),files,modelSent:false,canAuthorizePlacement:false};
  if(value.frozenAt>=prepared.recordExpiresAt)throw Error('Capture expired during coupled freeze; partial archive retained');
  await immutable(path.join(root,'manifest.json'),raw({...value,manifestHash:hash(value)}));return (await readFrozenCoupledReferenceWorldAssembly({directory,referenceInput})).prepared;
}
/** Archival ORIGINAL data only. No expiry refresh, provider, registry adoption
 * or final consent is acquired by reopening this read-only archive. */
export async function readFrozenCoupledReferenceWorldAssembly({directory,referenceInput}){
  directory=path.resolve(directory);const root=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_ARCHIVE),manifest=JSON.parse(await member(root,'manifest.json',65536));
  exactKeys(manifest,['format','version','purpose','preparationHash','frozenAt','files','modelSent','canAuthorizePlacement','manifestHash'],'coupled source archive');
  const {manifestHash,...content}=manifest;
  if(manifest.format!=='CoupledReferenceWorldAssemblyArchive'||manifest.version!==1||manifest.purpose!==purpose||hash(content)!==manifestHash
    ||!Number.isSafeInteger(manifest.frozenAt)||manifest.frozenAt<0||manifest.frozenAt>Date.now()||manifest.modelSent!==false||manifest.canAuthorizePlacement!==false)throw Error('Original coupled archive identity changed');
  const names=Object.keys(archiveFiles),entries=await fs.readdir(root);
  if(entries.length!==names.length+1||entries.some(n=>n!=='manifest.json'&&!names.includes(n))||!Array.isArray(manifest.files)||manifest.files.length!==names.length)throw Error('Incomplete/unknown coupled archive; no adoption');
  const sources={};for(const [i,name]of names.entries()){
    const pin=manifest.files[i];exactKeys(pin,['path','bytes','sha256'],'coupled archive source');const bytes=await member(root,name,archiveFiles[name]);
    if(pin.path!==name||pin.bytes!==bytes.length||pin.sha256!==hash(bytes))throw Error('Original coupled archive source changed');sources[name]=bytes;
  }
  const prepared=JSON.parse(sources['preparation.json']),send=JSON.parse(sources['send.json']);
  const reference=await readJobReferenceInput({directory,input:referenceInput,model:prepared.selected?.model,runtimeHash:prepared.runtimeHash});
  const saved=rebuildReferenceWorldPatchContextSource(Object.fromEntries(Object.keys(REFERENCE_PATCH_CONTEXT_FILE_LIMITS).map(n=>[n,sources[n]])),prepared.contextId,manifest.frozenAt);
  const expected=coupledReferenceWorldAssemblyPreparation(reference,saved,prepared.selected?.capability);
  if(hash(expected)!==hash(prepared)||manifest.preparationHash!==expected.preparationHash)throw Error('Original coupled policy/reference/scope pins changed');verifyCoupledReferenceWorldAssemblySend(send,expected);
  return {prepared:expected,send,reference,saved,worldContext:prepareCoupledAssemblyWorldContext(saved.snapshot),manifest};
}
