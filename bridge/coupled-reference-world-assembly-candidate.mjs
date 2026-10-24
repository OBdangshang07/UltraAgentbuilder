import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/generation/compiler.mjs';
import {WORLD_ASSEMBLY_LIMITS as limits} from '../contracts/world-assembly-limits.mjs';
import {coupledReferenceAssemblyOriginalRequest} from '../contracts/coupled-reference-world-assembly-job.mjs';
import {compileCoupledAssemblyContextPlan,coupledAssemblyWorldContextData} from '../src/world/assembly-coupled-context.mjs';
import {streamCoupledAssemblyParts,coupledAssemblyPlanData} from '../src/world/assembly-coupled-plan.mjs';
import {prepareCoupledAssemblyPreview} from '../src/world/assembly-coupled-preview.mjs';
import {collectCoupledAssemblyBinding} from '../src/world/assembly-coupled-binding.mjs';
import {readReviewedReferenceAssemblySource,readReferenceAssemblyProofMember as member} from './reference-world-assembly-candidate.mjs';

export const COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY='coupled-reference-world-assembly-candidate-v1';
export const COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_CLAIM='coupled-reference-world-assembly-candidate-publication.json';
const raw=v=>Buffer.from(JSON.stringify(v)),digest=/^[a-f0-9]{64}$/;
const publicationOwners=new WeakMap();
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};
const fail=message=>{throw Object.assign(Error(message+'; original coupled task retained'),{statusCode:409});};
const partName=(kind,index)=>kind+'-'+String(index).padStart(3,'0')+'.json';
function maximum(name){return name==='cells.bin'?16*1024**2:name==='native-manifest.json'?1024**2:name==='records.json'?limits.recordsBytes:name==='coupling-plan.json'?limits.metadataBytes:limits.partBytes;}
async function immutable(file,bytes){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function physical(root){const s=await fs.lstat(root);if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(root)!==root)fail('Coupled candidate directory redirected');}

async function prepare({directory,original,branch,records,signal,onMember,expectedCandidateHash,partIndex=null}){
  coupledAssemblyWorldContextData(original.worldContext);signal?.throwIfAborted();
  if(partIndex!==null&&(!Number.isSafeInteger(partIndex)||partIndex<0))fail('Exact complete-set part index required');
  const source=await readReviewedReferenceAssemblySource({directory,original,branch,records,signal});
  const {summary,evidence,native,proofFiles}=source,p=original.prepared,requestHash=hash(coupledReferenceAssemblyOriginalRequest(original));
  const plan=compileCoupledAssemblyContextPlan(original.worldContext,native,{signal});
  if(!plan.operationCount)fail('Coupled final asset has no world difference');
  const collector=collectCoupledAssemblyBinding(plan,{signal}),files=[],previewHashes=[];let total=0,selectedPart=null;
  async function emit(name,bytes){
    signal?.throwIfAborted();total+=bytes.length;
    if(!bytes.length||bytes.length>maximum(name)||total>limits.candidateBytes)fail('Complete coupled candidate byte quota; no clipping');
    const pin={path:name,bytes:bytes.length,sha256:hash(bytes)};files.push(pin);await onMember?.(name,bytes,maximum(name));signal?.throwIfAborted();
  }
  await emit('records.json',raw(records));await emit('native-manifest.json',await member(source.finalDirectory,'manifest.json',1024**2));await emit('cells.bin',native.binary);
  await emit('coupling-plan.json',raw(coupledAssemblyPlanData(plan)));
  const patchSet=await streamCoupledAssemblyParts(plan,{signal,onPart:async part=>{
    const preview=prepareCoupledAssemblyPreview(plan,part,{signal});collector.add(preview,part.index,part.partHash);previewHashes.push(preview.previewHash);
    await emit(partName('part',part.index),raw(part));await emit(partName('preview',part.index),raw(preview));
    if(part.index===partIndex)selectedPart={index:part.index,part,preview};
  }});
  if(partIndex!==null&&!selectedPart)fail('Requested part is outside original complete candidate');
  await emit('patch-set.json',raw(patchSet));
  const content={format:'CoupledReferenceWorldAssemblyCandidate',version:1,purpose:'coupled-reference-world-assembly',
    jobId:p.jobId,preparationHash:p.preparationHash,requestHash,archiveHash:original.manifest.manifestHash,runtimeHash:p.runtimeHash,
    referenceBindingHash:p.referenceBindingHash,referenceSetHash:p.referenceSetHash,worldContextHash:p.worldContextHash,
    snapshotHash:p.snapshotHash,selectionHash:p.selectionHash,sourceHash:summary.sourceHash,assetHash:native.manifest.assetHash,cellsHash:native.manifest.cellsHash,
    couplingPlanHash:plan.planHash,couplingPolicyHash:plan.policyHash,patchSetHash:patchSet.patchSetHash,origin:[...p.origin],branch,
    recordsHash:hash(records),summaryHash:hash(summary),reservedCalls:records.length,maximumCalls:p.maximumCalls,tier:p.tier,
    partCount:patchSet.partCount,operationCount:patchSet.operationCount,pairCount:plan.pairCount,previewHashes,
    currentNativeEvidenceHash:evidence.evidenceHash,files,proofFiles,coordinateSpace:'original-world-absolute',movable:false,
    omittedCells:'keep',completeSetVerified:true,partialPublicationAllowed:false,originalScopeAndNativeCellsVerified:true,
    finalReviewAccepted:summary.finalTextReviewAccepted,realImageUnderstandingVerified:false,providerReceiptAuditVerified:false,
    originalRegistryVerified:false,worldRendered:false,serverBaselineVerified:false,physicsVerified:false,canAuthorizePlacement:false,
    additionalModelCalls:0,worldWrites:0};
  const candidate=freeze({...content,candidateHash:hash(content)});
  if(raw(candidate).length>limits.metadataBytes)fail('Complete coupled metadata quota');
  if(expectedCandidateHash!==undefined&&candidate.candidateHash!==expectedCandidateHash)fail('Candidate differs from original full coupled task/proof');
  // Binding is DERIVED after candidateHash. It is intentionally not a member
  // of candidate.files: hashing it there would create a candidate/binding cycle.
  const binding=collector.finish(patchSet,{captureId:p.contextId,selection:original.saved.snapshot.selection,jobId:p.jobId,
    worldContextHash:p.worldContextHash,preparationHash:p.preparationHash,requestHash,runtimeHash:p.runtimeHash,referenceSetHash:p.referenceSetHash,
    contextRecordHash:p.recordHash,referenceBindingHash:p.referenceBindingHash,sourceHash:summary.sourceHash,
    currentNativeEvidenceHash:evidence.evidenceHash,candidateHash:candidate.candidateHash});
  await source.verifyUnchanged();signal?.throwIfAborted();
  await onMember?.('binding.json',raw(binding),limits.metadataBytes);signal?.throwIfAborted();
  await onMember?.('candidate.json',raw(candidate),limits.metadataBytes);signal?.throwIfAborted();
  return {candidate,binding,patchSet,plan,native,summary,records,finalDirectory:source.finalDirectory,...(selectedPart?{selectedPart}:{})};
}

/** Read and reconstruct ALL original proofs and members before exposing any
 * selected part. No compile/render/provider task, repair or owner is acquired. */
export async function readCoupledReferenceAssemblyCandidateData({directory,original,expectedCandidateHash,signal,partIndex=null,publicationOwner=null}){
  if(!digest.test(expectedCandidateHash??''))fail('Independently retained original coupled candidateHash required');
  const owner=publicationOwners.get(publicationOwner),claimName=COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_CLAIM;
  async function publication(){
    let claim;try{claim=await member(directory,claimName,2048);}catch(e){if(e.code==='ENOENT'){if(owner)fail('Original coupled publisher claim disappeared');return;}throw e;}
    if(owner?.directory!==directory||owner.candidateHash!==expectedCandidateHash||!claim.equals(owner.claim))fail('Coupled publication incomplete or uncertain; no readonly adoption');
  }
  await publication();
  const root=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);await physical(root);
  const metadata=await member(root,'candidate.json',limits.metadataBytes),candidate=JSON.parse(metadata);
  const {candidateHash,...content}=candidate;
  if(candidateHash!==expectedCandidateHash||hash(content)!==candidateHash||!metadata.equals(raw(candidate)))fail('Original coupled candidate metadata changed');
  const records=JSON.parse(await member(root,'records.json',limits.recordsBytes));
  const result=await prepare({directory,original,branch:candidate.branch,records,signal,expectedCandidateHash,partIndex,
    onMember:async(name,bytes,max)=>{if(!(await member(root,name,max)).equals(bytes))fail('Original complete coupled member differs');}});
  const expected=['candidate.json','binding.json',...result.candidate.files.map(f=>f.path)].sort();
  if(hash((await fs.readdir(root)).sort())!==hash(expected))fail('Unknown or missing coupled candidate member; retained');
  await publication();
  return result;
}

export async function saveCoupledReferenceAssemblyCandidate({directory,original,result,signal}){
  const relative=path.relative(directory,path.resolve(result.summary.lastAcceptedDirectory)).replaceAll('\\','/'),branch=relative.split('/')[0];
  const checked=await prepare({directory,original,branch,records:result.records,signal});
  if(hash(result.scene)!==checked.candidate.sourceHash||hash(result.summary)!==checked.candidate.summaryHash)fail('Live coupled result differs from reviewed source');
  const root=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY),file=path.join(directory,COUPLED_REFERENCE_ASSEMBLY_CANDIDATE_CLAIM);
  const claim=raw({format:'CoupledReferenceWorldAssemblyCandidatePublication',version:1,id:randomUUID(),candidateHash:checked.candidate.candidateHash});
  const publicationOwner=Object.freeze({purpose:'original-coupled-candidate-publisher'});
  await immutable(file,claim);publicationOwners.set(publicationOwner,{directory,candidateHash:checked.candidate.candidateHash,claim});let succeeded=false;
  try{
    await fs.mkdir(root,{mode:0o700});await physical(root);
    await prepare({directory,original,branch,records:result.records,signal,expectedCandidateHash:checked.candidate.candidateHash,
      onMember:async(name,bytes)=>{signal?.throwIfAborted();await immutable(path.join(root,name),bytes);}});
    const read=await readCoupledReferenceAssemblyCandidateData({directory,original,expectedCandidateHash:checked.candidate.candidateHash,signal,publicationOwner});succeeded=true;return read;
  }finally{
    publicationOwners.delete(publicationOwner);
    if(succeeded){if(!(await member(directory,path.basename(file),2048)).equals(claim))fail('Original coupled publication claim changed');await fs.unlink(file);}
  }
}
