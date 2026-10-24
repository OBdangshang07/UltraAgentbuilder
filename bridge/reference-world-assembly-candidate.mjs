import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../contracts/world-assembly-limits.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {readNativeBundle} from '../src/generation/bundle.mjs';
import {assemblyWorldContextData,streamAssemblyWorldPatch,WORLD_ASSEMBLY_PATCH_LIMITS} from '../src/world/assembly-context.mjs';
import {assemblyGenerationContext} from '../src/world/assembly-coupled-context.mjs';
import {readCoupledReferenceAssemblyRunClaim} from './coupled-reference-world-assembly-run-claim.mjs';
import {readCoupledReferenceWorldAssemblyExecutionStart} from './coupled-reference-world-assembly-execution.mjs';
import {prepareWorldPatchPreview} from '../src/world/world-patch-preview-data.mjs';
import {readNativeEvidence,readNativeRevisionComparison} from './native-evidence.mjs';
import {assemblyCorrectionInput} from '../src/design/correction-feedback.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';
import {readReferenceWorldAssemblyExecutionStart} from './reference-world-assembly-execution.mjs';
import {auditAssemblyProviderRecovery} from './assembly-provider-recovery-audit.mjs';

// Original local evidence and complete native differences only. No adapter,
// compiler worker, render request, journal invoke or world writer is used here.
export const REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY = 'reference-world-assembly-candidate-v2';
export const REFERENCE_ASSEMBLY_CANDIDATE_CLAIM = 'reference-world-assembly-candidate-publication.json';
export const REFERENCE_ASSEMBLY_CANDIDATE_LIMITS = Object.freeze({
  metadataBytes:WORLD_ASSEMBLY_LIMITS.metadataBytes, recordsBytes:WORLD_ASSEMBLY_LIMITS.recordsBytes, partBytes:WORLD_ASSEMBLY_LIMITS.partBytes,
  candidateBytes:WORLD_ASSEMBLY_LIMITS.candidateBytes, proofFileBytes:64*1024**2, proofBytes:512*1024**2, proofFiles:4096,
});
const digest = /^[a-f0-9]{64}$/, branchName = /^assembly-run-[A-Za-z0-9_-]{6,32}$/;
const raw = value => Buffer.from(JSON.stringify(value));
// Equal uint16 indices do not mean equal blocks or coordinates when palette
// order or dimensions drift. Ignore intentionally different diagnostic/quality
// status metadata, but retain the exact reviewed native index interpretation.
const nativeIndexSpace = manifest => ({schemaVersion:manifest.schemaVersion,minecraft:manifest.minecraft,dataVersion:manifest.dataVersion,
  dimensions:manifest.dimensions,palette:manifest.palette,setCount:manifest.setCount,clearCount:manifest.clearCount});
const freeze = value => {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child);Object.freeze(value);}
  return value;
};
const partName = (kind,index) => `${kind}-${String(index).padStart(3,'0')}.json`;
const fail = message => {throw Object.assign(Error(message+'; original joint evidence retained'),{statusCode:409});};
async function physical(full) {
  const stat=await fs.lstat(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(full)!==full) fail('Joint result directory redirected');
}
async function member(root,relative,maximum,allowVerifiedEmpty=false) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p=>!p||p==='.'||p==='..')) fail('Unsafe joint result evidence path');
  await physical(root);let full=root;
  const segments=relative.split('/');
  for (const segment of segments.slice(0,-1)) {full=path.join(full,segment);await physical(full);}
  full=path.join(full,segments.at(-1));
  const before=await fs.lstat(full);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size<(allowVerifiedEmpty?0:1) || before.size>maximum || await fs.realpath(full)!==full) fail('Joint result file type/link/size rejected');
  const handle=await fs.open(full,'r');
  try {
    const opened=await handle.stat();
    const same=s=>s.isFile()&&s.nlink===1&&s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.mtimeMs===before.mtimeMs&&s.ctimeMs===before.ctimeMs;
    if (!same(opened)) fail('Joint evidence changed before open');
    const bytes=Buffer.alloc(before.size+1);let size=0;
    while (size<bytes.length) {const found=await handle.read(bytes,size,bytes.length-size,size);if (!found.bytesRead) break;size+=found.bytesRead;}
    const after=await handle.stat(), current=await fs.lstat(full);
    if (size!==before.size || !same(after) || !same(current) || current.isSymbolicLink() || await fs.realpath(full)!==full) fail('Joint evidence changed while reading');
    return bytes.subarray(0,size);
  } finally {await handle.close();}
}
const json = async (root,name,maximum=REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofFileBytes) =>
  JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await member(root,name,maximum)));
export const readReferenceAssemblyProofMember=member;
async function immutable(file,bytes) {
  const handle=await fs.open(file,'wx',0o600);
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
}

/** Pin the whole ORIGINAL selected branch, ledger, references, render evidence
 * and final bundle. No copying, cleanup, re-rendering or alternate branches. */
async function evidencePins(directory,branch,signal,verifiedEmptyAnswers=new Set(),archiveName='reference-world-assembly-v2') {
  const roots=[archiveName,'reference-input','assembly-journal',branch,'reference-world-assembly-final'];
  const names=await fs.readdir(directory);
  for (const name of ['native-evidence','native-comparisons','native-revisions']) if (names.includes(name)) roots.push(name);
  roots.push(...names.filter(n=>/^codex-response-[-\w]{1,96}$/.test(n)).sort());
  const pins=[];let total=0;
  async function visit(relative,depth=0) {
    signal?.throwIfAborted();if (depth>12) fail('Joint evidence directory depth quota');
    await physical(path.join(directory,relative));
    for (const name of (await fs.readdir(path.join(directory,relative))).sort()) {
      if (!/^[A-Za-z0-9_.-]{1,192}$/.test(name) || name==='.' || name==='..') fail('Unknown joint evidence filename');
      const relativeFile=relative+'/'+name,stat=await fs.lstat(path.join(directory,relativeFile));
      if (stat.isDirectory() && !stat.isSymbolicLink()) await visit(relativeFile,depth+1);
      else {
        if (pins.length>=REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofFiles) fail('Joint original evidence file quota');
        const bytes=await member(directory,relativeFile,REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofFileBytes,verifiedEmptyAnswers.has(relativeFile));
        total+=bytes.length;if (total>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofBytes) fail('Joint original evidence byte quota');
        pins.push({path:relativeFile,bytes:bytes.length,sha256:hash(bytes)});
      }
    }
  }
  for (const root of roots) await visit(root);
  for(const name of ['_owner.json','request.json','original-dispatch.json','original-execution-start.json','coupled-reference-world-assembly-run-claim.json'])if(names.includes(name)) {
    if(pins.length>=REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofFiles)fail('Joint original ownership evidence quota');
    const bytes=await member(directory,name,131072);total+=bytes.length;
    if(total>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofBytes)fail('Joint original ownership byte quota');
    pins.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
  }
  return pins;
}

// ONLY a completed full rebuild, or its private owner-memory cohort, may
// supply these pins. An empty answer is evidence of a retained failed call,
// never a usable model result or permission to retry an unknown outcome.
function emptyAnswersFromVerifiedCandidate(candidate) {
  const result=new Set();
  for(const pin of candidate.proofFiles)if(pin.bytes===0){
    if(!/^codex-response-[-\w]{1,96}\/answer-1\.txt$/.test(pin.path)||pin.sha256!==hash(Buffer.alloc(0)))
      fail('Unknown empty original evidence');
    result.add(pin.path);
  }
  return result;
}

async function verifiedCapacityEmptyAnswers(directory,original,branch,records,summary) {
  const failed=records.filter(r=>r.invocationOutcome==='completed-empty-capacity');
  if(!failed.length)return new Set();
  const p=original.prepared,audit=await auditAssemblyProviderRecovery({directory,root:path.join(directory,branch,'assembly'),
    records,summary,policy:original.reference.preparation.policy,requestHash:p.preparationHash,runtimeHash:p.runtimeHash,
    model:p.selected.model,effort:p.selected.effort});
  if(!audit?.report.allReservedCallsClosed)fail('Original capacity failures require a complete closed recovery audit');
  const empty=new Set();
  for(const record of failed){
    const d=audit.diagnosticFor(record.index),e=d?.responseEvidence;
    if(d?.reason!=='failed'||d.failureKind!=='model-capacity'||d.receivedTextBytes!==0||e?.persisted!==true
      ||!/^codex-response-[-\w]{1,96}$/.test(e.directory??'')||e.file!=='answer-1.txt')fail('Exact verified closed capacity answer required');
    empty.add(e.directory+'/'+e.file);
  }
  await audit.verifyUnchanged();return empty;
}

async function terminalEvidence(directory,original,branch,records,signal) {
  if (!branchName.test(branch)) fail('Original completed assembly branch required');
  const root=branch+'/assembly',p=original.prepared,summary=await json(directory,root+'/summary.json');
  if (!Array.isArray(records) || !records.length || records.length>p.maximumCalls || summary.reservedCalls!==records.length
    || summary.maximumCalls!==p.maximumCalls || summary.tier!==p.tier || summary.sourceHash!==summary.finalTextReviewSourceHash
    || summary.finalTextReviewCurrent!==true || summary.visualReviewCurrent!==true || summary.designQuality?.nativeMaterialReview!==true
    || summary.worldContext?.worldContextHash!==p.worldContextHash || summary.worldContext.snapshotHash!==p.snapshotHash
    || summary.worldContext.selectionHash!==p.selectionHash) fail('Original complete current joint review required');
  const world=assemblyGenerationContext(original.worldContext).data;
  const checkedEnvelope=async name=>{
    const envelope=await json(directory,'assembly-journal/'+name);
    exactKeys(envelope,['value','sha256'],'original joint journal envelope');
    if (!digest.test(envelope.sha256??'') || hash(envelope.value)!==envelope.sha256) fail('Original joint journal changed');return envelope.value;
  };
  const identity=await checkedEnvelope('identity.json');
  if (hash(identity)!==hash({version:1,requestHash:p.preparationHash,policyHash:hash(original.reference.preparation.policy),
    runtimeHash:p.runtimeHash,maximumCalls:p.maximumCalls}) || hash(await checkedEnvelope('dispatched.json'))!==hash({count:records.length})) fail('Original joint ledger request/count differs');
  if(world.format==='CoupledAssemblyWorldContext'){
    await readCoupledReferenceAssemblyRunClaim({directory,original});
    await readCoupledReferenceWorldAssemblyExecutionStart({directory,prepared:p});
  }
  else await readReferenceWorldAssemblyExecutionStart({directory,prepared:p});
  const journalNames=(await fs.readdir(path.join(directory,'assembly-journal'))).filter(n=>/^call-\d+\.json$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if (hash(journalNames)!==hash(records.map((_,i)=>`call-${i+1}.json`))) fail('Original joint call history missing/truncated');
  let currentReview=null;
  for (const [i,record] of records.entries()) {
    signal?.throwIfAborted();const index=i+1,base=root+'/'+index;
    if (record.index!==index || !['accepted','rejected','failed'].includes(record.state) || record.worldContextHash!==p.worldContextHash) fail('Nonterminal or changed original joint stage');
    const call=await checkedEnvelope(`call-${index}.json`),input=await json(directory,base+'/input.json');
    const referenceStage=['reference-analysis','correct-reference-analysis'].includes(record.phase);
    // The original non-staged concept-choice contract has no tier field.
    // Its choice is bound to the saved concept set; do not invent a new model
    // input or accept arbitrary omissions in other design/production stages.
    const untieredChoice=record.phase==='select-concept' && input.tier===undefined
      && original.reference.preparation.policy.assembly.prototypes?.mode!=='staged';
    const decision=untieredChoice?await json(directory,root+'/concept-selection.json'):null;
    const stagePolicyMatches=referenceStage
      ? input.tier===undefined && input.referenceBindingHash===original.reference.binding.bindingHash
        && input.referenceSetHash===original.reference.manifest.setHash && input.generationHash===p.generationHash
        && input.description===original.reference.preparation.generation.prompt
        && hash(input.references)===hash(original.reference.manifest.references.map(({id,width,height,annotation})=>({id,width,height,annotation})))
      : untieredChoice ? input.description===original.reference.preparation.generation.prompt
        && input.candidateSetHash===decision.candidateSetHash && input.designEvidence?.kind==='native-comparison'
        : input.tier!==undefined && hash(input.tier)===hash(original.reference.preparation.policy.assembly);
    if (call.index!==index || !['response','error'].includes(call.state) || hash(input.worldContext)!==hash(world)
      || !stagePolicyMatches
      || hash(await json(directory,base+'/model-input.json'))!==hash(assemblyCorrectionInput(input))) fail('Unknown invocation or changed original joint model context');
    if (record.responseReceived===true) {
      const response=await json(directory,base+'/response.json');
      const binding=call.providerBinding;
      if (call.state!=='response' || hash(response)!==hash(call.response) || binding?.version!==1 || binding.provider!=='codex'
        || binding.storage!=='persistent-single-turn' || !/^[-\w]{1,128}$/.test(binding.threadId??'')
        || !/^[-\w]{1,128}$/.test(binding.turnId??'') || !digest.test(binding.requestHash??'')
        || binding.model!==p.selected.model || binding.effort!==p.selected.effort) fail('Original stage response/provider binding differs from closed ledger');
      if (record.state!=='failed') {
        const result=await json(directory,base+'/result.json');
        if (result.accepted!==(record.state==='accepted')) fail('Original stage result differs');
      } else if (typeof record.error!=='string' || !record.error) fail('Original failed local check lacks its error');
      if (['review','correct-review'].includes(record.phase) && record.state==='accepted' && input.sourceHash===summary.sourceHash
        && response.sourceHash===summary.sourceHash && input.designEvidence?.evidenceHash===summary.finalVisualReview?.evidenceHash) currentReview={input,response};
    } else if (call.state!=='error' || record.state!=='failed') fail('Incomplete joint stage cannot publish a candidate');
  }
  const interfaces=await json(directory,root+'/interfaces.json'),packageIds=interfaces.packages?.map(p=>p.id);
  if (!Array.isArray(packageIds) || !packageIds.length || new Set(packageIds).size!==packageIds.length
    || hash([...packageIds].sort())!==hash([...(summary.completedPackages??[])].sort()) || !currentReview
    || summary.finalTextReviewAccepted!==(currentReview.response.verdict==='accept')
    || summary.visualReviewAccepted!==(currentReview.response.verdict==='accept')) fail('Mandatory packages or current final review are incomplete');
  const visual=summary.finalVisualReview,supplied=currentReview.input.designEvidence;
  // The shared pipeline ENRICHES the original render receipt with architectural
  // measurements/prototypes. Its review hash is not the raw renderer hash.
  const {evidenceHash,measurements,prototypeEvidence,cameraBasis,prototypeExpansion,...base}=supplied;
  if (hash({...base,measurements,prototypeEvidence,...(cameraBasis?{cameraBasis}:{}),...(prototypeExpansion?{prototypeExpansion}:{})})!==evidenceHash
    || evidenceHash!==visual.evidenceHash) fail('Original enriched native review evidence differs');
  const evidence=(await (visual.kind==='native-asset'?readNativeEvidence(directory,base.requestHash)
    :visual.kind==='native-revision'?readNativeRevisionComparison(directory,hash(base))
    :Promise.reject(Error('Current native material evidence required')))).evidence;
  const {evidenceHash:rawEvidenceHash,...rawBase}=evidence;
  if (hash(rawBase)!==hash(base) || rawEvidenceHash!==hash(base)) fail('Enriched review is not the exact original native render receipt');
  if (!evidence || evidence.sourceHash!==summary.sourceHash || evidence.assetHash!==visual.assetHash || evidence.cellsHash!==visual.cellsHash) fail('Original final native images differ');
  return {summary,evidence};
}

/** The complete original ledger/references/native-render/package verifier is
 * shared, not replaced by a reduced coupled-only proof. No provider/compiler,
 * new owner, candidate publication or world authority is acquired here. */
export async function readReviewedReferenceAssemblySource({directory,original,branch,records,signal}) {
  await physical(directory);signal?.throwIfAborted();
  const world=assemblyGenerationContext(original.worldContext).data,coupled=world.format==='CoupledAssemblyWorldContext';
  const archiveName=coupled?'coupled-reference-world-assembly-v1':'reference-world-assembly-v2';
  if(coupled?(original.prepared.format!=='CoupledReferenceWorldAssemblyPreparation'||original.prepared.version!==1)
    :(original.prepared.format!=='ReferenceWorldAssemblyPreparation'||original.prepared.version!==2))fail('Original checked context and independent preparation protocol differ');
  const {summary,evidence}=await terminalEvidence(directory,original,branch,records,signal);
  const verifiedEmptyAnswers=await verifiedCapacityEmptyAnswers(directory,original,branch,records,summary);
  const finalDirectory=path.join(directory,'reference-world-assembly-final');
  await physical(finalDirectory);
  // Strong physical file reads precede the existing native bundle validator.
  const proofFiles=await evidencePins(directory,branch,signal,verifiedEmptyAnswers,archiveName),pins=new Map(proofFiles.map(f=>[f.path,f]));
  const archiveNames=['manifest.json',...original.manifest.files.map(f=>f.path)].map(n=>archiveName+'/'+n).sort();
  if (hash(proofFiles.filter(f=>f.path.startsWith(archiveName+'/')).map(f=>f.path).sort())!==hash(archiveNames)
    || hash(await json(directory,archiveName+'/manifest.json'))!==hash(original.manifest)) fail('Original frozen joint archive changed during result preparation');
  for (const file of original.manifest.files) {
    const pin=pins.get(archiveName+'/'+file.path);
    if (pin?.sha256!==file.sha256 || pin.bytes!==file.bytes) fail('Original frozen joint file changed during result preparation');
  }
  const p=original.prepared,reference=await readJobReferenceInput({directory,input:original.reference.input,model:p.selected.model,runtimeHash:p.runtimeHash});
  for (const key of ['binding','preparation','manifest']) if (hash(reference[key])!==hash(original.reference[key])) fail('Original job-owned reference changed during result preparation');
  for (const [i,file] of reference.images.entries()) {
    const pin=pins.get(path.relative(directory,file).replaceAll('\\','/'));
    if (pin?.sha256!==reference.manifest.references[i].sha256) fail('Original reference pixels changed during result preparation');
  }
  const native=await readNativeBundle(finalDirectory);
  const diagnosticRelative=path.relative(directory,path.resolve(summary.lastAcceptedDirectory)).replaceAll('\\','/');
  if (!diagnosticRelative.startsWith(branch+'/assembly/') || !/^assembly-run-[A-Za-z0-9_-]{6,32}\/assembly\/\d+\/diagnostic$/.test(diagnosticRelative)) fail('Original reviewed diagnostic outside selected branch');
  const diagnostic=await json(directory,diagnosticRelative+'/manifest.json'),diagnosticCells=await member(directory,diagnosticRelative+'/cells.bin',16*1024**2);
  if (native.manifest.scene?.sourceHash!==summary.sourceHash || hash(native.scene)!==summary.sourceHash
    || diagnostic.scene?.sourceHash!==summary.sourceHash || diagnostic.assetHash!==evidence.assetHash
    || hash(nativeIndexSpace(diagnostic))!==hash(nativeIndexSpace(native.manifest))
    || hash(diagnosticCells)!==diagnostic.cellsHash || diagnostic.cellsHash!==native.manifest.cellsHash
    || !diagnosticCells.equals(native.binary)) fail('Final original native asset differs from reviewed geometry');
  const verifyUnchanged=async()=>{
    signal?.throwIfAborted();
    if(hash(await evidencePins(directory,branch,signal,verifiedEmptyAnswers,archiveName))!==hash(proofFiles))fail('Original joint proof changed during result preparation');
  };
  return {summary,evidence,native,finalDirectory,proofFiles,verifyUnchanged};
}

async function prepare(directory,original,branch,records,signal,{retainParts=true,partIndex=null,onMember,expectedCandidateHash}={}) {
  if (typeof retainParts!=='boolean' || partIndex!==null && (!Number.isSafeInteger(partIndex)
    || partIndex<0 || partIndex>=WORLD_ASSEMBLY_PATCH_LIMITS.parts)) fail('Exact retained result mode/part index required');
  // Legacy v2 entry never becomes a coupled candidate via copied JSON flags.
  assemblyWorldContextData(original.worldContext);
  const p=original.prepared,{summary,evidence,native,finalDirectory,proofFiles,verifyUnchanged}=
    await readReviewedReferenceAssemblySource({directory,original,branch,records,signal});
  // Production retains one current part/preview, never all patch trees and
  // serialized copies. The legacy data API deliberately retains its arrays.
  const buffers=retainParts?{}:null,patches=retainParts?[]:null,previews=retainParts?[]:null;
  const previewHashes=[],partFiles=[];let total=0,selectedPart=null;
  const emit=async(name,bytes)=>{
    const maximum=name==='records.json'?REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.recordsBytes:REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.partBytes;
    total+=bytes.length;if (!bytes.length || bytes.length>maximum || total>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.candidateBytes) fail('Complete joint candidate quota; no clipping or partial candidate');
    const pin={path:name,bytes:bytes.length,sha256:hash(bytes)};
    if(retainParts)buffers[name]=bytes;
    await onMember?.(name,bytes,maximum);signal?.throwIfAborted();return pin;
  };
  const recordsFile=await emit('records.json',raw(records));
  const lowered=await streamAssemblyWorldPatch(original.worldContext,native,{signal,onPart:async({index,patch})=>{
    const preview=prepareWorldPatchPreview(original.saved.snapshot,patch,{signal});
    if(retainParts){patches.push(patch);previews.push(preview);}
    if(index===partIndex)selectedPart={index,patch,preview};
    previewHashes.push(preview.previewHash);
    partFiles.push(await emit(partName('part',index),raw(patch)));
    partFiles.push(await emit(partName('preview',index),raw(preview)));
  }});
  if(partIndex!==null && selectedPart===null)fail('Exact complete-set part index required');
  const setFile=await emit('patch-set.json',raw(lowered.patchSet));
  const content={format:'ReferenceWorldAssemblyCandidate',version:2,purpose:'reference-world-assembly',
    jobId:p.jobId,preparationHash:p.preparationHash,archiveHash:original.manifest.manifestHash,runtimeHash:p.runtimeHash,
    referenceBindingHash:p.referenceBindingHash,referenceSetHash:p.referenceSetHash,worldContextHash:p.worldContextHash,
    snapshotHash:p.snapshotHash,selectionHash:p.selectionHash,sourceHash:summary.sourceHash,
    assetHash:native.manifest.assetHash,cellsHash:native.manifest.cellsHash,origin:[...p.origin],
    branch,recordsHash:hash(records),summaryHash:hash(summary),reservedCalls:records.length,maximumCalls:p.maximumCalls,tier:p.tier,
    patchSetHash:lowered.patchSet.patchSetHash,partCount:lowered.patchSet.partCount,operationCount:lowered.patchSet.operationCount,
    previewHashes,currentNativeEvidenceHash:evidence.evidenceHash,
    // Preserve the v2 byte identity/order of previously complete candidates.
    files:[recordsFile,setFile,...partFiles],proofFiles,
    coordinateSpace:'original-world-absolute',movable:false,omittedCells:'keep',completeSetVerified:true,
    partialPublicationAllowed:false,originalScopeAndNativeCellsVerified:true,
    finalReviewAccepted:summary.finalTextReviewAccepted,realImageUnderstandingVerified:false,
    providerReceiptAuditVerified:false,worldRendered:false,serverBaselineVerified:false,physicsVerified:false,
    canAuthorizePlacement:false,crashAtomicPublication:false,additionalModelCalls:0,worldWrites:0};
  const candidate=freeze({...content,candidateHash:hash(content)}),metadataBytes=raw(candidate);
  if(metadataBytes.length>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes)fail('Complete joint evidence metadata quota');
  if(expectedCandidateHash!==undefined && candidate.candidateHash!==expectedCandidateHash)
    fail('Candidate differs from complete original task/asset/proofs');
  await verifyUnchanged();
  // All provisional members and original proofs have been checked before the
  // final metadata callback; a callback failure never returns a complete set.
  if(retainParts)buffers['candidate.json']=metadataBytes;
  await onMember?.('candidate.json',metadataBytes,REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes);
  signal?.throwIfAborted();
  return {candidate,summary,records,native,finalDirectory,...lowered,
    ...(retainParts?{buffers,patches,previews,patch:patches.length===1?patches[0]:null}:{}),
    ...(selectedPart?{selectedPart}:{}),retainedAllParts:retainParts};
}

/** Caller retains the ORIGINAL candidateHash in its independently bound job
 * receipt. A self-rehashed file cannot pick a new asset, branch, or partial set. */
export async function readReferenceWorldAssemblyCandidateData({directory,original,expectedCandidateHash,signal,retainParts=true,partIndex=null}) {
  if (!digest.test(expectedCandidateHash??'')) fail('Original complete joint candidate hash required');
  const root=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  const candidate=await json(root,'candidate.json',REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes);
  if (candidate.candidateHash!==expectedCandidateHash) fail('Original candidate identity changed');
  const records=await json(root,'records.json',REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.recordsBytes);
  // Rebuild/compare EVERY member against the complete original asset even
  // when metadata or one part is requested. Do not trust self-rehashed pins.
  const rebuilt=await prepare(directory,original,candidate.branch,records,signal,{retainParts,partIndex,expectedCandidateHash,
    onMember:async(name,bytes,maximum)=>{
      if(!(await member(root,name,maximum)).equals(bytes))fail('Joint candidate member differs from complete original task/native result');
    }});
  const names=(await fs.readdir(root)).sort();
  if(hash(names)!==hash([...rebuilt.candidate.files.map(f=>f.path),'candidate.json'].sort()))fail('Joint candidate incomplete or contains unknown members');
  if (hash(await evidencePins(directory,candidate.branch,signal,emptyAnswersFromVerifiedCandidate(rebuilt.candidate)))!==hash(rebuilt.candidate.proofFiles)) fail('Original joint proof changed during candidate read');
  return rebuilt;
}

/** PRIVATE warm worker path. The parent owns this in-memory receipt from a
 * normally-closed full reconstruction, not caller/disk hashes. Reuse only the
 * proven semantic equality; read every byte and check every physical member
 * again. Keep at most the selected patch/preview, with no geometry regeneration,
 * compilation, model/world action or partial-set authority. */
export async function readCohortReferenceWorldAssemblyCandidate({directory,cohort,expectedCandidateHash,signal,partIndex=null}) {
  if(!digest.test(expectedCandidateHash??'')||cohort?.kind!=='original-complete-rebuild'
    ||cohort.candidate?.candidateHash!==expectedCandidateHash
    ||partIndex!==null&&(!Number.isSafeInteger(partIndex)||partIndex<0||partIndex>=cohort.candidate.partCount))
    fail('Exact previously fully verified complete candidate required');
  const {candidate,patchSet}=cohort,root=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  const verifiedEmptyAnswers=emptyAnswersFromVerifiedCandidate(candidate);
  await physical(directory);signal?.throwIfAborted();
  // The full verifier pinned the complete frozen context, original calls,
  // reference pixels, native geometry, ownership and current render evidence.
  // Re-enumeration detects added/removed files; hashing detects same-size edits
  // and self-rehashed on-disk manifests, without trusting filesystem metadata.
  if(hash(await evidencePins(directory,candidate.branch,signal,verifiedEmptyAnswers))!==hash(candidate.proofFiles))
    fail('Original joint proof changed since full reconstruction');
  let patch=null,preview=null,total=0;
  for(const pin of candidate.files){
    signal?.throwIfAborted();
    const maximum=pin.path==='records.json'?REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.recordsBytes:REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.partBytes;
    const bytes=await member(root,pin.path,maximum);total+=bytes.length;
    if(total>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.candidateBytes||bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)
      fail('Joint candidate member differs from original complete reconstruction');
    if(partIndex!==null&&(pin.path===partName('part',partIndex)||pin.path===partName('preview',partIndex))){
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(pin.path===partName('part',partIndex))patch=value;else preview=value;
    }
  }
  if(!(await member(root,'candidate.json',REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes)).equals(raw(candidate)))
    fail('Original fully verified candidate metadata changed');
  const names=(await fs.readdir(root)).sort();
  if(hash(names)!==hash([...candidate.files.map(f=>f.path),'candidate.json'].sort()))
    fail('Joint candidate incomplete or contains unknown members');
  if(hash(await evidencePins(directory,candidate.branch,signal,verifiedEmptyAnswers))!==hash(candidate.proofFiles))
    fail('Original joint proof changed during cohort read');
  signal?.throwIfAborted();
  return {candidate,patchSet,retainedAllParts:false,
    ...(partIndex===null?{}:{selectedPart:{index:partIndex,patch,preview}})};
}

/** Metadata commits LAST. Failed/unknown publication claims and partial
 * directories stay preserved; no timeout/PID permits ownership takeover. */
export async function saveReferenceWorldAssemblyCandidate({directory,original,result,signal,retainParts=true}) {
  const relative=path.relative(directory,path.resolve(result.summary.lastAcceptedDirectory)).replaceAll('\\','/'),branch=relative.split('/')[0];
  // Dry complete-source verification is bounded, before claiming publication.
  // A second streaming pass writes provisional members with metadata LAST.
  const prepared=await prepare(directory,original,branch,result.records,signal,{retainParts:false});
  if (hash(result.scene)!==prepared.candidate.sourceHash || hash(result.summary)!==prepared.candidate.summaryHash) fail('Live joint result changed from original final evidence');
  const root=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY),claimFile=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_CLAIM);
  const claim=raw({format:'ReferenceWorldAssemblyCandidatePublication',version:2,id:randomUUID(),candidateHash:prepared.candidate.candidateHash});
  await immutable(claimFile,claim);
  let succeeded=false;
  try {
    signal?.throwIfAborted();
    let exists=true;try{await fs.lstat(root);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
    if(!exists){
      await fs.mkdir(root,{mode:0o700});await physical(root);
      await prepare(directory,original,branch,result.records,signal,{retainParts:false,expectedCandidateHash:prepared.candidate.candidateHash,
        onMember:async(name,bytes)=>{signal?.throwIfAborted();await immutable(path.join(root,name),bytes);}});
    }
    const verified=await readReferenceWorldAssemblyCandidateData({directory,original,
      expectedCandidateHash:prepared.candidate.candidateHash,signal,retainParts});
    succeeded=true;return verified;
  } finally {
    // A failed/cancelled/unknown write keeps both the OWN claim and exact
    // provisional files. Neither retries nor read-only access can take over.
    if(succeeded){
      if (!(await member(directory,path.basename(claimFile),2048)).equals(claim)) fail('Joint candidate publication claim changed; preserved');
      await fs.unlink(claimFile); // exact successfully verified OWN claim only
    }
  }
}

export function referenceWorldAssemblyCandidatePart(result,index) {
  if (!Number.isSafeInteger(index) || index<0 || index>=result.candidate.partCount || index>=WORLD_ASSEMBLY_PATCH_LIMITS.parts) fail('Exact complete-set part index required');
  const selected=result.selectedPart?.index===index?result.selectedPart:null;
  const patch=selected?.patch??result.patches?.[index],preview=selected?.preview??result.previews?.[index];
  if(!patch || !preview || patch.patchHash!==result.patchSet.partHashes[index]
    || preview.previewHash!==result.candidate.previewHashes[index])fail('Exact original verified part required');
  return freeze({format:'ReferenceWorldAssemblyCandidatePart',version:2,purpose:'reference-world-assembly',
    preparationHash:result.candidate.preparationHash,candidateHash:result.candidate.candidateHash,
    patchSet:result.patchSet,index,patch,preview,
    completeSetVerified:true,partIsApplyScope:false,canAuthorizePlacement:false,serverBaselineVerified:false,
    additionalModelCalls:0,worldWrites:0});
}
