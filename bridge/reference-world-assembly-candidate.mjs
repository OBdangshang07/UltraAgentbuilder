import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys} from '../contracts/world-selection.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {readNativeBundle} from '../src/generation/bundle.mjs';
import {assemblyWorldContextData,compileAssemblyWorldPatch,WORLD_ASSEMBLY_PATCH_LIMITS} from '../src/world/assembly-context.mjs';
import {prepareWorldPatchPreview} from '../src/world/world-patch-preview-data.mjs';
import {readNativeEvidence,readNativeRevisionComparison} from './native-evidence.mjs';
import {assemblyCorrectionInput} from '../src/design/correction-feedback.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';

// Original local evidence and complete native differences only. No adapter,
// compiler worker, render request, journal invoke or world writer is used here.
export const REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY = 'reference-world-assembly-candidate-v2';
export const REFERENCE_ASSEMBLY_CANDIDATE_CLAIM = 'reference-world-assembly-candidate-publication.json';
export const REFERENCE_ASSEMBLY_CANDIDATE_LIMITS = Object.freeze({
  metadataBytes:2*1024**2, recordsBytes:2*1024**2, partBytes:16*1024**2,
  candidateBytes:96*1024**2, proofFileBytes:64*1024**2, proofBytes:512*1024**2, proofFiles:4096,
});
const digest = /^[a-f0-9]{64}$/, branchName = /^assembly-run-[A-Za-z0-9_-]{6,32}$/;
const raw = value => Buffer.from(JSON.stringify(value));
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
async function member(root,relative,maximum) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p=>!p||p==='.'||p==='..')) fail('Unsafe joint result evidence path');
  await physical(root);let full=root;
  const segments=relative.split('/');
  for (const segment of segments.slice(0,-1)) {full=path.join(full,segment);await physical(full);}
  full=path.join(full,segments.at(-1));
  const before=await fs.lstat(full);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size<1 || before.size>maximum || await fs.realpath(full)!==full) fail('Joint result file type/link/size rejected');
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
async function immutable(file,bytes) {
  const handle=await fs.open(file,'wx',0o600);
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
}

/** Pin the whole ORIGINAL selected branch, ledger, references, render evidence
 * and final bundle. No copying, cleanup, re-rendering or alternate branches. */
async function evidencePins(directory,branch,signal) {
  const roots=['reference-world-assembly-v2','reference-input','assembly-journal',branch,'reference-world-assembly-final'];
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
        const bytes=await member(directory,relativeFile,REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofFileBytes);
        total+=bytes.length;if (total>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.proofBytes) fail('Joint original evidence byte quota');
        pins.push({path:relativeFile,bytes:bytes.length,sha256:hash(bytes)});
      }
    }
  }
  for (const root of roots) await visit(root);
  return pins;
}

async function terminalEvidence(directory,original,branch,records,signal) {
  if (!branchName.test(branch)) fail('Original completed assembly branch required');
  const root=branch+'/assembly',p=original.prepared,summary=await json(directory,root+'/summary.json');
  if (!Array.isArray(records) || !records.length || records.length>p.maximumCalls || summary.reservedCalls!==records.length
    || summary.maximumCalls!==p.maximumCalls || summary.tier!==p.tier || summary.sourceHash!==summary.finalTextReviewSourceHash
    || summary.finalTextReviewCurrent!==true || summary.visualReviewCurrent!==true || summary.designQuality?.nativeMaterialReview!==true
    || summary.worldContext?.worldContextHash!==p.worldContextHash || summary.worldContext.snapshotHash!==p.snapshotHash
    || summary.worldContext.selectionHash!==p.selectionHash) fail('Original complete current joint review required');
  const world=assemblyWorldContextData(original.worldContext);
  const checkedEnvelope=async name=>{
    const envelope=await json(directory,'assembly-journal/'+name);
    exactKeys(envelope,['value','sha256'],'original joint journal envelope');
    if (!digest.test(envelope.sha256??'') || hash(envelope.value)!==envelope.sha256) fail('Original joint journal changed');return envelope.value;
  };
  const identity=await checkedEnvelope('identity.json');
  if (hash(identity)!==hash({version:1,requestHash:p.preparationHash,policyHash:hash(original.reference.preparation.policy),
    runtimeHash:p.runtimeHash,maximumCalls:p.maximumCalls}) || hash(await checkedEnvelope('dispatched.json'))!==hash({count:records.length})) fail('Original joint ledger request/count differs');
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

async function prepare(directory,original,branch,records,signal) {
  await physical(directory);signal?.throwIfAborted();
  const {summary,evidence}=await terminalEvidence(directory,original,branch,records,signal);
  const finalDirectory=path.join(directory,'reference-world-assembly-final');
  await physical(finalDirectory);
  // Strong physical file reads precede the existing native bundle validator.
  const proofFiles=await evidencePins(directory,branch,signal),pins=new Map(proofFiles.map(f=>[f.path,f]));
  const archiveNames=['manifest.json',...original.manifest.files.map(f=>f.path)].map(n=>'reference-world-assembly-v2/'+n).sort();
  if (hash(proofFiles.filter(f=>f.path.startsWith('reference-world-assembly-v2/')).map(f=>f.path).sort())!==hash(archiveNames)
    || hash(await json(directory,'reference-world-assembly-v2/manifest.json'))!==hash(original.manifest)) fail('Original frozen joint archive changed during result preparation');
  for (const file of original.manifest.files) {
    const pin=pins.get('reference-world-assembly-v2/'+file.path);
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
    || hash(diagnosticCells)!==diagnostic.cellsHash || diagnostic.cellsHash!==native.manifest.cellsHash
    || !diagnosticCells.equals(native.binary)) fail('Final original native asset differs from reviewed geometry');
  const lowered=compileAssemblyWorldPatch(original.worldContext,native,{signal});
  const previews=lowered.patches.map(p=>prepareWorldPatchPreview(original.saved.snapshot,p,{signal}));
  const buffers={'records.json':raw(records),'patch-set.json':raw(lowered.patchSet)};
  lowered.patches.forEach((p,i)=>{buffers[partName('part',i)]=raw(p);buffers[partName('preview',i)]=raw(previews[i]);});
  let total=0;
  for (const [name,bytes] of Object.entries(buffers)) {
    const maximum=name==='records.json'?REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.recordsBytes:REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.partBytes;
    total+=bytes.length;if (!bytes.length || bytes.length>maximum || total>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.candidateBytes) fail('Complete joint candidate quota; no clipping or partial candidate');
  }
  const content={format:'ReferenceWorldAssemblyCandidate',version:2,purpose:'reference-world-assembly',
    jobId:p.jobId,preparationHash:p.preparationHash,archiveHash:original.manifest.manifestHash,runtimeHash:p.runtimeHash,
    referenceBindingHash:p.referenceBindingHash,referenceSetHash:p.referenceSetHash,worldContextHash:p.worldContextHash,
    snapshotHash:p.snapshotHash,selectionHash:p.selectionHash,sourceHash:summary.sourceHash,
    assetHash:native.manifest.assetHash,cellsHash:native.manifest.cellsHash,origin:[...p.origin],
    branch,recordsHash:hash(records),summaryHash:hash(summary),reservedCalls:records.length,maximumCalls:p.maximumCalls,tier:p.tier,
    patchSetHash:lowered.patchSet.patchSetHash,partCount:lowered.patchSet.partCount,operationCount:lowered.patchSet.operationCount,
    previewHashes:previews.map(v=>v.previewHash),currentNativeEvidenceHash:evidence.evidenceHash,
    files:Object.entries(buffers).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:hash(bytes)})),proofFiles,
    coordinateSpace:'original-world-absolute',movable:false,omittedCells:'keep',completeSetVerified:true,
    partialPublicationAllowed:false,originalScopeAndNativeCellsVerified:true,
    finalReviewAccepted:summary.finalTextReviewAccepted,realImageUnderstandingVerified:false,
    providerReceiptAuditVerified:false,worldRendered:false,serverBaselineVerified:false,physicsVerified:false,
    canAuthorizePlacement:false,crashAtomicPublication:false,additionalModelCalls:0,worldWrites:0};
  const candidate=freeze({...content,candidateHash:hash(content)});buffers['candidate.json']=raw(candidate);
  if (buffers['candidate.json'].length>REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes) fail('Complete joint evidence metadata quota');
  return {candidate,buffers,summary,records,native,finalDirectory,previews,...lowered};
}

/** Caller retains the ORIGINAL candidateHash in its independently bound job
 * receipt. A self-rehashed file cannot pick a new asset, branch, or partial set. */
export async function readReferenceWorldAssemblyCandidateData({directory,original,expectedCandidateHash,signal}) {
  if (!digest.test(expectedCandidateHash??'')) fail('Original complete joint candidate hash required');
  const root=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  const candidate=await json(root,'candidate.json',REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes);
  if (candidate.candidateHash!==expectedCandidateHash) fail('Original candidate identity changed');
  const records=await json(root,'records.json',REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.recordsBytes);
  const rebuilt=await prepare(directory,original,candidate.branch,records,signal);
  if (rebuilt.candidate.candidateHash!==expectedCandidateHash) fail('Candidate differs from complete original task/asset/proofs');
  const names=(await fs.readdir(root)).sort();
  if (hash(names)!==hash(Object.keys(rebuilt.buffers).sort())) fail('Joint candidate incomplete or contains unknown members');
  for (const [name,bytes] of Object.entries(rebuilt.buffers)) {
    const maximum=name==='candidate.json'?REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.metadataBytes:name==='records.json'?REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.recordsBytes:REFERENCE_ASSEMBLY_CANDIDATE_LIMITS.partBytes;
    if (!(await member(root,name,maximum)).equals(bytes)) fail('Joint candidate member differs from complete original native result');
  }
  if (hash(await evidencePins(directory,candidate.branch,signal))!==hash(rebuilt.candidate.proofFiles)) fail('Original joint proof changed during candidate read');
  return rebuilt;
}

/** Metadata commits LAST. Failed/unknown publication claims and partial
 * directories stay preserved; no timeout/PID permits ownership takeover. */
export async function saveReferenceWorldAssemblyCandidate({directory,original,result,signal}) {
  const relative=path.relative(directory,path.resolve(result.summary.lastAcceptedDirectory)).replaceAll('\\','/'),branch=relative.split('/')[0];
  const prepared=await prepare(directory,original,branch,result.records,signal);
  if (hash(result.scene)!==prepared.candidate.sourceHash || hash(result.summary)!==prepared.candidate.summaryHash) fail('Live joint result changed from original final evidence');
  const root=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY),claimFile=path.join(directory,REFERENCE_ASSEMBLY_CANDIDATE_CLAIM);
  const claim=raw({format:'ReferenceWorldAssemblyCandidatePublication',version:2,id:randomUUID(),candidateHash:prepared.candidate.candidateHash});
  await immutable(claimFile,claim);
  try {
    signal?.throwIfAborted();
    try {await fs.lstat(root);return await readReferenceWorldAssemblyCandidateData({directory,original,expectedCandidateHash:prepared.candidate.candidateHash,signal});}
    catch (error) {if (error.code!=='ENOENT') throw error;}
    await fs.mkdir(root,{mode:0o700});await physical(root);
    for (const [name,bytes] of Object.entries(prepared.buffers)) {signal?.throwIfAborted();await immutable(path.join(root,name),bytes);}
    return await readReferenceWorldAssemblyCandidateData({directory,original,expectedCandidateHash:prepared.candidate.candidateHash,signal});
  } finally {
    if (!(await member(directory,path.basename(claimFile),2048)).equals(claim)) fail('Joint candidate publication claim changed; preserved');
    await fs.unlink(claimFile); // exact successfully written OWN claim only
  }
}

export function referenceWorldAssemblyCandidatePart(result,index) {
  if (!Number.isSafeInteger(index) || index<0 || index>=result.candidate.partCount || index>=WORLD_ASSEMBLY_PATCH_LIMITS.parts) fail('Exact complete-set part index required');
  return freeze({format:'ReferenceWorldAssemblyCandidatePart',version:2,purpose:'reference-world-assembly',
    preparationHash:result.candidate.preparationHash,candidateHash:result.candidate.candidateHash,
    patchSet:result.patchSet,index,patch:result.patches[index],preview:result.previews[index],
    completeSetVerified:true,partIsApplyScope:false,canAuthorizePlacement:false,serverBaselineVerified:false,
    additionalModelCalls:0,worldWrites:0});
}
