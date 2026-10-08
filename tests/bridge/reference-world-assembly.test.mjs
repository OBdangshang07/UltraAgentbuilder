import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeBundle} from '../../src/generation/bundle.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {prepareReferenceWorldAssembly,freezeReferenceWorldAssembly,readFrozenReferenceWorldAssembly,
  runReferenceWorldAssembly} from '../../bridge/reference-world-assembly.mjs';
import {codexRequestFingerprint} from '../../bridge/codex-persistent-receipt.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {referenceFixture,referenceBrief,sendConsent} from './reference-generation-fixture.mjs';
import {v4Request,v4Response} from './quality-v4-fixtures.mjs';
import {stagedRequest,stagedResponse} from './decomposed-assembly-fixtures.mjs';

const sendFor=p=>({format:'ReferenceWorldAssemblySend',version:2,purpose:'reference-world-assembly',confirmed:true,
  preparationHash:p.preparationHash,maximumCalls:p.maximumCalls});
async function setup(t,{tier='lite',staged=false,images=2,protect=false}={}) {
  const {model:unused,...generationOverrides}=staged?stagedRequest:v4Request;
  generationOverrides.qualityTier=tier;
  const f=await referenceFixture(t,{version:2,images,generationOverrides});await f.confirm();const referenceInput=await f.bind();
  const reference=await readJobReferenceInput({directory:f.jobDirectory,input:referenceInput,model:f.generation.model,runtimeHash:f.runtimeHash});
  const size=staged?[32,224,32]:[16,10,16],origin=[-16,-40,-16],contextId=randomUUID();
  const selection={format:'WorldSelection',version:1,world:{worldId:'world_joint_synthetic',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:7,
    edit:{min:origin,max:origin.map((v,i)=>v+size[i])},context:{min:origin.map(v=>v-1),max:origin.map((v,i)=>v+size[i]+1)},
    protected:protect?[{min:[-14,-40,-14],max:[-13,-39,-13]}]:[]};
  const store=new WorldContextStore({dataDir:f.dataDir});t.after(()=>store.close());
  const capture={fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const saved=await store.operation('capture',contextId,Buffer.from(JSON.stringify({selection,capture})));
  const selectedCapability={id:f.generation.model,supportsImages:true,efforts:['high','max']};
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

for(const tier of ['lite','pro','max','ultra'])test(tier+' joint task runs the REAL shared component/native orchestration with one budget and original environment',async t=>{
  const h=await setup(t,{tier,staged:tier==='ultra',images:tier==='lite'?1:4});
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
  const meta=JSON.parse(await fs.readFile(path.join(h.f.jobDirectory,'assembly-journal/identity.json')));
  assert.equal(meta.value.requestHash,h.prepared.preparationHash);assert.equal(meta.value.maximumCalls,h.prepared.maximumCalls);
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
