import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {prepareReferenceWorldAssembly,freezeReferenceWorldAssembly,readFrozenReferenceWorldAssembly,
  runReferenceWorldAssembly,readReferenceWorldAssemblyCandidate,readReferenceWorldAssemblyCandidatePart} from '../../bridge/reference-world-assembly.mjs';
import {REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,REFERENCE_ASSEMBLY_CANDIDATE_CLAIM,
  saveReferenceWorldAssemblyCandidate} from '../../bridge/reference-world-assembly-candidate.mjs';
import {codexRequestFingerprint} from '../../bridge/codex-persistent-receipt.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {referenceFixture,referenceBrief,sendConsent} from './reference-generation-fixture.mjs';
import {jointPixelFixture} from './joint-assembly-input-fixture.mjs';
import {prepareReferenceWorldAssemblyDraft,bindReferenceWorldAssemblyDraft} from '../../bridge/reference-world-assembly-input.mjs';
import {v4Request,v4Response} from './quality-v4-fixtures.mjs';
import {stagedRequest,stagedResponse} from './decomposed-assembly-fixtures.mjs';

const sendFor=p=>({format:'ReferenceWorldAssemblySend',version:2,purpose:'reference-world-assembly',confirmed:true,
  preparationHash:p.preparationHash,maximumCalls:p.maximumCalls});
async function setup(t,{tier='lite',staged=false,images=2,protect=false,independent=false}={}) {
  const {model:unused,...generationOverrides}=staged?stagedRequest:v4Request;
  generationOverrides.qualityTier=tier;
  const f=await (independent?jointPixelFixture:referenceFixture)(t,{version:2,images,generationOverrides});
  const size=staged?[32,224,32]:[16,10,16],origin=[-16,-40,-16],contextId=randomUUID();
  const selection={format:'WorldSelection',version:1,world:{worldId:'world_joint_synthetic',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:7,
    edit:{min:origin,max:origin.map((v,i)=>v+size[i])},context:{min:origin.map(v=>v-1),max:origin.map((v,i)=>v+size[i]+1)},
    protected:protect?[{min:[-14,-40,-14],max:[-13,-39,-13]}]:[]};
  const store=new WorldContextStore({dataDir:f.dataDir});t.after(()=>store.close());
  const capture={fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const saved=await store.operation('capture',contextId,Buffer.from(JSON.stringify({selection,capture})));
  const selectedCapability={id:f.generation.model,supportsImages:true,efforts:['high','max']};
  let referenceInput;
  if(independent) {
    const options={dataDir:f.dataDir,contextId,referenceOwnerId:f.ownerId,referenceSetHash:f.manifest.setHash,generation:f.generation,selectedCapability};
    const draft=await prepareReferenceWorldAssemblyDraft(options);
    referenceInput=(await bindReferenceWorldAssemblyDraft({...options,directory:f.jobDirectory,send:sendFor(draft)})).referenceInput;
    await assert.rejects(fs.lstat(path.join(f.dataDir,'reference-drafts',f.ownerId,'preparations')),e=>e.code==='ENOENT');
  } else {await f.confirm();referenceInput=await f.bind();}
  const reference=await readJobReferenceInput({directory:f.jobDirectory,input:referenceInput,model:f.generation.model,runtimeHash:f.runtimeHash});
  const prepareOptions={dataDir:f.dataDir,directory:f.jobDirectory,contextId,referenceInput,selectedCapability};
  const prepared=await prepareReferenceWorldAssembly(prepareOptions),send=sendFor(prepared),calls=[],observations=[];
  const adapter={models:async()=>[structuredClone(selectedCapability)],generate:async request=>{
    const input=JSON.parse(request.prompt.split('Assembly input (data):\n').at(-1)),schema=request.outputSchema;
    const index=calls.length+1;calls.push({input,request,index});
    const ledger=JSON.parse(await fs.readFile(path.join(f.jobDirectory,'assembly-journal',`call-${index}.json`)));
    assert.equal(ledger.value.state,'pending','Original slot is durably reserved BEFORE dispatch');
    assert.equal(input.worldContext.snapshotHash,saved.record.snapshotHash);
    assert.deepEqual(input.worldContext.origin,origin);assert.equal(input.worldContext.canAuthorizePlacement,false);
    assert.match(request.prompt,/WORLD-BOUND ASSEMBLY/);assert.equal(request.model,f.generation.model);assert.equal(request.effort,'max');
    await validateModelImageFiles(request.images,f.jobDirectory);
    const hashes=request.referenceInput?reference.manifest.references.map(r=>r.sha256):await Promise.all(request.images.map(async file=>hash(await fs.readFile(file))));
    const binding={version:1,provider:'codex',storage:'persistent-single-turn',threadId:'synthetic-'+index,turnId:null,
      model:request.model,effort:request.effort,requestHash:codexRequestFingerprint({prompt:request.prompt,model:request.model,
        effort:request.effort,outputSchema:schema,imageHashes:hashes,...(request.referenceInput?{referenceBindingHash:hash(request.referenceInput)}:{})})};
    await request.onProviderBinding(binding);await request.onProviderBinding({...binding,turnId:'turn-'+index});
    if(schema.properties.format.enum[0]==='ArchitectureReferenceBrief') {
      assert.deepEqual(request.referenceInput,referenceInput);assert.equal(request.images.length,0);return {spec:referenceBrief(reference)};
    }
    assert.equal(request.referenceInput,undefined);assert.equal(input.referenceArchitecture.briefHash,hash(input.referenceArchitecture.brief));
    return {spec:(staged?stagedResponse:v4Response)(input,{outputSchema:schema})};
  }};
  const runOptions={directory:f.jobDirectory,referenceInput,preparationHash:prepared.preparationHash,adapter,
    signal:new AbortController().signal,onStage:async records=>observations.push(records),
    nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:f.jobDirectory,timeoutMs:10000,onWaiting:async s=>{
      if(s.state==='waiting')await acceptNativeEvidence(f.jobDirectory,s.id,fixtureUpload(s.request));}})};
  return {f,referenceInput,reference,store,saved,contextId,selectedCapability,prepareOptions,prepared,send,calls,observations,adapter,runOptions};
}

for(const independent of [false,true])for(const tier of ['lite','pro','max','ultra'])test((independent?'independent pixel-only ':'legacy separately bound ')+tier+' joint task runs the REAL shared component/native orchestration with one budget and original environment',async t=>{
  const h=await setup(t,{tier,staged:tier==='ultra',images:tier==='lite'?1:4,independent});
  await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  const result=await runReferenceWorldAssembly(h.runOptions);
  assert.equal(result.joint.sharedPipeline,true);assert.equal(result.records.length,h.calls.length);
  assert.equal(result.records.every(r=>r.worldContextHash===h.prepared.worldContextHash),true);
  assert.equal(result.summary.worldContext.snapshotHash,h.saved.record.snapshotHash);
  assert.equal(result.summary.referenceAnalysis.sharedTaskBudget,true);assert.equal(result.summary.visualReviewCurrent,true);
  assert.equal(result.binding.sourceHash,result.summary.sourceHash);assert.equal(result.binding.origin[0],-16);
  assert.equal(result.patches.reduce((sum,p)=>sum+p.writes.length,0)>0,true);assert.equal(result.joint.canAuthorizePlacement,false);
  assert.equal(result.joint.realImageUnderstandingVerified,false);assert.equal(result.joint.worldWrites,0);
  assert.equal(result.summary.maximumCalls,{lite:8,pro:14,max:20,ultra:26}[tier]);
  assert.equal(result.records.length,tier==='ultra'?17:8);
  if(tier==='ultra') {assert.equal(result.summary.decomposition.independentConceptCalls,3);
    assert.equal(result.summary.decomposition.requiredRoleStagesAccepted,4);assert.equal(result.summary.completedPackages.length,5);
    assert.equal(result.scene.bounds.height,224);assert.equal(result.patchSet.partCount>1,true);
    assert.equal(result.patchSet.operationCount,result.patches.reduce((sum,p)=>sum+p.writes.length,0));
    assert.equal(new Set(result.patches.flatMap(p=>p.writes.map(w=>w.position.join(',')))).size,result.patchSet.operationCount);
    assert.equal(result.patchSet.partialPublicationAllowed,false);assert.equal(result.patch,null);}
  const native=await readNativeBundle(result.finalDirectory);assert.equal(result.binding.cellsHash,native.manifest.cellsHash);
  assert.equal(native.manifest.diagnosticOnly,undefined);
  const readOptions={directory:h.f.jobDirectory,referenceInput:h.referenceInput,preparationHash:h.prepared.preparationHash,
    candidateHash:result.candidate.candidateHash};
  const saved=await readReferenceWorldAssemblyCandidate(readOptions);
  assert.equal(saved.candidate.partCount,result.patches.length);assert.equal(saved.candidate.completeSetVerified,true);
  assert.equal(saved.candidate.partialPublicationAllowed,false);assert.equal(saved.candidate.canAuthorizePlacement,false);
  assert.equal(saved.candidate.reservedCalls,h.calls.length);assert.deepEqual(saved.patchSet,result.patchSet);
  assert.deepEqual(saved.patches,result.patches);assert.equal(saved.candidate.cellsHash,native.manifest.cellsHash);
  const last=await readReferenceWorldAssemblyCandidatePart({...readOptions,partIndex:result.patches.length-1});
  assert.equal(last.patch.patchHash,result.patches.at(-1).patchHash);assert.equal(last.partIsApplyScope,false);
  assert.equal(last.completeSetVerified,true);assert.equal(last.canAuthorizePlacement,false);assert.equal(h.calls.length,result.records.length);
  if(tier==='ultra') {
    const partFile=path.join(h.f.jobDirectory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,`part-${String(result.patches.length-1).padStart(3,'0')}.json`);
    const retained=path.join(h.f.jobDirectory,'retained-ultra-part.json');await fs.rename(partFile,retained);
    try {await assert.rejects(readReferenceWorldAssemblyCandidatePart({...readOptions,partIndex:0}),'Part zero cannot download as complete when another part is absent');}
    finally {await fs.rename(retained,partFile);}
    assert.equal(h.calls.length,result.records.length);
  }
  const meta=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,'assembly-journal/identity.json')));
  assert.equal(meta.value.requestHash,h.prepared.preparationHash);assert.equal(meta.value.maximumCalls,h.prepared.maximumCalls);
});

test('completed joint candidate rereads original files/ledger/render evidence, never invokes or republishes a task',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  const result=await runReferenceWorldAssembly(h.runOptions),root=path.join(h.f.jobDirectory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY);
  const options={directory:h.f.jobDirectory,referenceInput:h.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:result.candidate.candidateHash};
  const calls=h.calls.length;
  h.adapter.models=async()=>{throw Error('A completed result read must not discover/switch a model');};
  h.adapter.generate=async()=>{throw Error('A completed result read must not invoke a model');};
  const original=await readFrozenReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput});
  const repeated=await saveReferenceWorldAssemblyCandidate({directory:h.f.jobDirectory,original,result});
  assert.equal(repeated.candidate.candidateHash,result.candidate.candidateHash);assert.equal(h.calls.length,calls);
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/read-only result/);assert.equal(h.calls.length,calls);
  const workerRead=async input=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../../bridge/reference-world-assembly-result-worker.mjs',import.meta.url),{workerData:input});
    let message;worker.on('message',m=>{message=m;});worker.on('error',reject);
    worker.on('exit',code=>code?reject(Error('Original result worker exit '+code)):resolve(message));
  });
  const metadata=await workerRead({operation:'metadata',...options});assert.equal(metadata.ok,true);
  assert.equal(metadata.result.candidate.candidateHash,result.candidate.candidateHash);assert.equal(metadata.result.originalCompleteSetReverified,true);
  const part=await workerRead({operation:'part',...options,partIndex:0});assert.equal(part.ok,true);assert.equal(part.result.partIsApplyScope,false);
  assert.equal((await workerRead({operation:'invoke',...options})).ok,false);
  assert.equal((await workerRead({operation:'metadata',...options,model:'alternate'})).ok,false);
  await assert.rejects(readReferenceWorldAssemblyCandidate({...options,preparationHash:'a'.repeat(64)}),/preparation/);
  await assert.rejects(readReferenceWorldAssemblyCandidate({...options,candidateHash:'b'.repeat(64)}),/identity/);
  for (const partIndex of [-1,1,0.1,'0']) await assert.rejects(readReferenceWorldAssemblyCandidatePart({...options,partIndex}));
  assert.equal(h.calls.length,calls);
  const mutate=async(relative,change)=>{
    const file=path.join(h.f.jobDirectory,relative),bytes=await fs.readFile(file);
    try {await fs.writeFile(file,change(bytes));await assert.rejects(readReferenceWorldAssemblyCandidate(options));}
    finally {await fs.writeFile(file,bytes);}
  };
  await mutate(REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY+'/part-000.json',bytes=>{const value=JSON.parse(bytes);value.writes[0].after='minecraft:diamond_block';
    const {patchHash,...content}=value;return JSON.stringify({...content,patchHash:hash(content)});});
  const candidateFile=path.join(root,'candidate.json'),partFile=path.join(root,'part-000.json');
  const candidateBytes=await fs.readFile(candidateFile),partBytes=await fs.readFile(partFile);
  try {
    const part=JSON.parse(partBytes);part.writes[0].after='minecraft:diamond_block';const changedPart=Buffer.from(JSON.stringify(part));
    const candidate=JSON.parse(candidateBytes),pin=candidate.files.find(f=>f.path==='part-000.json');pin.bytes=changedPart.length;pin.sha256=hash(changedPart);
    const {candidateHash,...content}=candidate,changedCandidate={...content,candidateHash:hash(content)};
    await fs.writeFile(partFile,changedPart);await fs.writeFile(candidateFile,JSON.stringify(changedCandidate));
    await assert.rejects(readReferenceWorldAssemblyCandidate({...options,candidateHash:changedCandidate.candidateHash}),/original task/);
  } finally {await fs.writeFile(partFile,partBytes);await fs.writeFile(candidateFile,candidateBytes);}
  await mutate(REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY+'/preview-000.json',bytes=>{const value=JSON.parse(bytes);value.movable=true;return JSON.stringify(value);});
  await mutate('assembly-journal/call-1.json',bytes=>{const value=JSON.parse(bytes);value.value.state='pending';return JSON.stringify({value:value.value,sha256:hash(value.value)});});
  await mutate('reference-world-assembly-final/cells.bin',bytes=>{const changed=Buffer.from(bytes);changed[0]^=1;return changed;});
  await mutate(result.candidate.branch+'/assembly/summary.json',bytes=>{const value=JSON.parse(bytes);value.completedPackages=[];return JSON.stringify(value);});
  const proof=result.candidate.proofFiles.find(f=>f.path.startsWith('native-evidence/')&&f.path.endsWith('.png'));
  await mutate(proof.path,bytes=>{const changed=Buffer.from(bytes);changed[changed.length-1]^=1;return changed;});
  const missing=path.join(root,'part-000.json'),retained=path.join(h.f.jobDirectory,'retained-part.json');
  await fs.rename(missing,retained);
  try {await assert.rejects(readReferenceWorldAssemblyCandidate(options));} finally {await fs.rename(retained,missing);}
  const unexpected=path.join(root,'unexpected.json');await fs.writeFile(unexpected,'{}');
  try {await assert.rejects(readReferenceWorldAssemblyCandidate(options),/unknown members/);} finally {await fs.unlink(unexpected);}
  await fs.rename(missing,retained);await fs.link(retained,missing);
  try {await assert.rejects(readReferenceWorldAssemblyCandidate(options),/link/);} finally {await fs.unlink(missing);await fs.rename(retained,missing);}
  const saved=await readReferenceWorldAssemblyCandidate(options);assert.equal(saved.candidate.candidateHash,result.candidate.candidateHash);
  assert.equal(h.calls.length,calls);assert.equal(saved.candidate.worldWrites,0);
  const realNow=Date.now;
  try {Date.now=()=>h.prepared.recordExpiresAt+1;
    assert.equal((await readReferenceWorldAssemblyCandidate(options)).candidate.candidateHash,result.candidate.candidateHash);
  } finally {Date.now=realNow;}
});

for (const existing of ['partial-directory','unknown-claim'])test(existing+' stops joint dispatch before any model call; no adoption or cleanup',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  const target=path.join(h.f.jobDirectory,existing==='partial-directory'?REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY:REFERENCE_ASSEMBLY_CANDIDATE_CLAIM);
  if(existing==='partial-directory')await fs.mkdir(target);else await fs.writeFile(target,'unknown original publication');
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/read-only result/);assert.equal(h.calls.length,0);
  assert.equal((await fs.lstat(target)).isDirectory(),existing==='partial-directory');
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),e=>e.code==='ENOENT');
});

test('free preparation and freeze do not reserve calls; old one-call/image SEND cannot grant new joint authority',async t=>{
  const h=await setup(t);assert.equal(h.prepared.version,2);assert.equal(h.prepared.modelSent,false);
  assert.equal(h.prepared.v1ConsentTransferable,false);
  for(const send of [sendConsent(h.f.preparation),{...h.send,version:1},{...h.send,maximumCalls:26},{...h.send,preparationHash:'a'.repeat(64)}])
    await assert.rejects(freezeReferenceWorldAssembly({...h.prepareOptions,send}));
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),e=>e.code==='ENOENT');
  await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  assert.deepEqual(await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send}),h.prepared);
  assert.equal(h.calls.length,0);
});

test('changed image/effort advertisement rejects before the first provider call',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  h.adapter.models=async()=>[{...h.selectedCapability,efforts:['max','high']}];
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/advertisement changed/);assert.equal(h.calls.length,0);
});

test('exact full-task source pins reject context, consent and archived data changes without rebasing',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  const root=path.join(h.f.jobDirectory,'reference-world-assembly-v2'),file=path.join(root,'snapshot.json'),bytes=await fs.readFile(file);
  const changed=JSON.parse(bytes);changed.selection.revision++;
  await fs.writeFile(file,JSON.stringify(changed));
  await assert.rejects(readFrozenReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput}),/file changed/);
  await assert.rejects(runReferenceWorldAssembly(h.runOptions));assert.equal(h.calls.length,0);
  await fs.writeFile(file,bytes);
  const original=await readFrozenReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput});
  assert.equal(original.prepared.snapshotHash,h.saved.record.snapshotHash);
  assert.deepEqual(original.send,h.send);
});

test('unknown original turn remains reserved once; replay cannot generate a replacement',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});let starts=0;
  h.adapter.generate=async request=>{starts++;await request.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',
    threadId:'unknown-synthetic',turnId:'original-turn',model:request.model,effort:request.effort,
    requestHash:codexRequestFingerprint({prompt:request.prompt,model:request.model,effort:request.effort,outputSchema:request.outputSchema,
      imageHashes:h.reference.manifest.references.map(r=>r.sha256),referenceBindingHash:hash(request.referenceInput)})});throw Error('Unknown upstream transport');};
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/Unknown upstream/);
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/observer unavailable/);assert.equal(starts,1);
  const call=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,'assembly-journal/call-1.json')));
  assert.equal(call.value.state,'pending');assert.equal(call.value.providerBinding.turnId,'original-turn');
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'reference-world-assembly-final')),e=>e.code==='ENOENT');
});

test('final full-scene geometry touching protected baseline cannot publish a subset patch',async t=>{
  const h=await setup(t,{protect:true});await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/protected baseline/);
  assert.equal(h.calls.length,8,'No manual retry or incomplete single-call substitute');
});

test('archive mutation at BEFORE-turn checkpoint rejects without sending a replacement or publishing a final',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});let attempts=0;
  h.adapter.generate=async request=>{
    attempts++;const file=path.join(h.f.jobDirectory,'reference-world-assembly-v2/send.json');
    const value=JSON.parse(await fs.readFile(file));value.maximumCalls++;await fs.writeFile(file,JSON.stringify(value));
    await request.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',threadId:'mutated-synthetic',turnId:null,
      model:request.model,effort:request.effort,requestHash:codexRequestFingerprint({prompt:request.prompt,model:request.model,
        effort:request.effort,outputSchema:request.outputSchema,imageHashes:h.reference.manifest.references.map(r=>r.sha256),referenceBindingHash:hash(request.referenceInput)})});
    throw Error('Should never pass mutated BEFORE-turn checkpoint');
  };
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/file changed/);assert.equal(attempts,1);
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/file changed/);assert.equal(attempts,1);
});

test('wrong selected-model/pixel request binding cannot pass the actual provider checkpoint',async t=>{
  const h=await setup(t);await freezeReferenceWorldAssembly({...h.prepareOptions,send:h.send});
  h.adapter.generate=async request=>{await request.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',
    threadId:'wrong-synthetic',turnId:null,model:request.model,effort:request.effort,requestHash:'f'.repeat(64)});};
  await assert.rejects(runReferenceWorldAssembly(h.runOptions),/provider input differs/);
  const call=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,'assembly-journal/call-1.json')));
  assert.equal(call.value.providerBinding,undefined);assert.equal(call.value.index,1);
});
