import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {jointPixelFixture} from './joint-assembly-input-fixture.mjs';
import {v4Request} from './quality-v4-fixtures.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {prepareReferenceWorldAssemblyDraft,bindReferenceWorldAssemblyDraft,readJointAssemblyReferenceInput} from '../../bridge/reference-world-assembly-input.mjs';
import {readFrozenReferenceWorldAssembly} from '../../bridge/reference-world-assembly.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {validateJobReferenceInput} from '../../contracts/reference-generation.mjs';
import {codexImageInput} from '../../bridge/codex-image-input.mjs';

const sendFor=p=>({format:'ReferenceWorldAssemblySend',version:2,purpose:'reference-world-assembly',confirmed:true,
  preparationHash:p.preparationHash,maximumCalls:p.maximumCalls});
async function setup(t) {
  const {model,...generationOverrides}=v4Request;
  const f=await jointPixelFixture(t,{generationOverrides:{...generationOverrides,qualityTier:'lite'}}),contextId=randomUUID();
  const selection={format:'WorldSelection',version:1,world:{worldId:'world_joint_input_synthetic',dimension:'minecraft:overworld',minY:-64,maxY:320},
    revision:3,context:{min:[-1,-41,-1],max:[17,-29,17]},edit:{min:[0,-40,0],max:[16,-30,16]},protected:[]};
  const capture={fence:{start:7,end:7},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',
    palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const contexts=new WorldContextStore({dataDir:f.dataDir});t.after(()=>contexts.close());
  const saved=await contexts.operation('capture',contextId,Buffer.from(JSON.stringify({selection,capture})));
  const options={dataDir:f.dataDir,contextId,referenceOwnerId:f.ownerId,referenceSetHash:f.manifest.setHash,generation:f.generation,
    selectedCapability:{id:f.generation.model,supportsImages:true,efforts:['high','max']}};
  const prepared=await prepareReferenceWorldAssemblyDraft(options),send=sendFor(prepared);
  return {f,saved,contexts,options,prepared,send,selection,capture};
}

test('pure pixel draft prepares and binds ONE independent full joint SEND, never an ordinary generation confirmation',async t=>{
  const h=await setup(t);
  assert.equal(h.prepared.jobId,h.f.jobId);assert.equal(h.prepared.maximumCalls,8);
  assert.equal(h.prepared.snapshotHash,h.saved.record.snapshotHash);assert.equal(h.prepared.referenceSetHash,h.f.manifest.setHash);
  assert.equal(h.prepared.modelSent,false);assert.equal(h.prepared.callsReserved,0);
  assert.equal(h.prepared.v1ConsentTransferable,false);
  assert.deepEqual(await fs.readdir(h.f.jobDirectory),[],'Free preparation creates no job/consent data');
  await assert.rejects(fs.stat(path.join(h.f.dataDir,'reference-drafts',h.f.ownerId,'preparations')),e=>e.code==='ENOENT');
  const bound=await bindReferenceWorldAssemblyDraft({...h.options,directory:h.f.jobDirectory,send:h.send});
  assert.deepEqual(bound.prepared,h.prepared);assert.equal(bound.referenceInput.format,'JointAssemblyReferenceInput');
  assert.throws(()=>validateJobReferenceInput(bound.referenceInput),'Ordinary input validator cannot accept joint authority');
  const reference=await readJobReferenceInput({directory:h.f.jobDirectory,input:bound.referenceInput,model:h.f.generation.model,runtimeHash:h.f.runtimeHash});
  assert.equal(reference.preparation.format,'JointAssemblyReferencePreparation');assert.equal(reference.preparation.ordinaryGenerationAuthorityTransferred,false);
  assert.equal(reference.binding.authorization,'independent-full-joint-send-required');assert.deepEqual(reference.send,h.send);
  const original=await readFrozenReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:bound.referenceInput});
  assert.deepEqual(original.prepared,h.prepared);assert.deepEqual(original.send,h.send);
  const actual=await codexImageInput({cwd:h.f.jobDirectory,referenceInput:bound.referenceInput,model:h.f.generation.model});
  assert.deepEqual(actual.images,reference.images);assert.equal(actual.referenceBindingHash,reference.binding.bindingHash);
  for(const [i,image]of actual.images.entries())assert.equal(hash(await fs.readFile(image)),h.f.manifest.references[i].sha256);
  assert.deepEqual(await bindReferenceWorldAssemblyDraft({...h.options,directory:h.f.jobDirectory,send:h.send}),bound);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),e=>e.code==='ENOENT');
});

test('ordinary/one-call/changed model, prompt, budget, scope or capability cannot authorize a full joint image binding',async t=>{
  const h=await setup(t),attempt=options=>bindReferenceWorldAssemblyDraft({...h.options,directory:h.f.jobDirectory,send:h.send,...options});
  for(const send of [
    {format:'ReferenceGenerationSend',version:1,accepted:true},
    {format:'ReferenceWorldPatchSend',version:1,confirmed:true},
    {...h.send,maximumCalls:26},{...h.send,confirmed:false},{...h.send,preparationHash:'a'.repeat(64)},
  ]) {await assert.rejects(attempt({send}));assert.deepEqual(await fs.readdir(h.f.jobDirectory),[]);}
  for(const generation of [{...h.f.generation,prompt:'another request'},{...h.f.generation,qualityTier:'pro'},
    {...h.f.generation,effort:'high'},{...h.f.generation,key:randomUUID()}])
    await assert.rejects(attempt({generation}));
  await assert.rejects(attempt({selectedCapability:{...h.options.selectedCapability,supportsImages:false}}));
  await assert.rejects(attempt({selectedCapability:{...h.options.selectedCapability,efforts:['high']}}));
  const contextId=randomUUID();
  await h.contexts.operation('capture',contextId,Buffer.from(JSON.stringify({selection:{...h.selection,revision:4},capture:h.capture})));
  await assert.rejects(attempt({contextId}),'Another context cannot inherit the original SEND');
  assert.deepEqual(await fs.readdir(h.f.jobDirectory),[]);
});

test('concurrent identical full joint binding cannot overwrite or create an ordinary SEND',async t=>{
  const h=await setup(t),options={...h.options,directory:h.f.jobDirectory,send:h.send};
  const attempts=await Promise.allSettled([bindReferenceWorldAssemblyDraft(options),bindReferenceWorldAssemblyDraft(options)]);
  const successful=attempts.filter(r=>r.status==='fulfilled');assert.ok(successful.length>=1);
  const original=await readJointAssemblyReferenceInput({directory:h.f.jobDirectory,input:successful[0].value.referenceInput,model:h.f.generation.model});
  assert.deepEqual(original.send,h.send);assert.equal(original.binding.ordinaryGenerationAuthorityTransferred,false);
  assert.deepEqual(await bindReferenceWorldAssemblyDraft(options),successful[0].value);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),e=>e.code==='ENOENT');
});

for(const kind of ['empty-parent','partial-owner','unknown-member'])test(kind+' is preserved; no copying into unknown joint input',async t=>{
  const h=await setup(t),parent=path.join(h.f.jobDirectory,'reference-input');await fs.mkdir(parent);
  if(kind!=='empty-parent')await fs.mkdir(path.join(parent,h.f.ownerId));
  if(kind==='unknown-member')await fs.writeFile(path.join(parent,h.f.ownerId,'unknown.json'),'original unknown');
  const before=await fs.readdir(parent);
  await assert.rejects(bindReferenceWorldAssemblyDraft({...h.options,directory:h.f.jobDirectory,send:h.send}));
  assert.deepEqual(await fs.readdir(parent),before);
  if(kind==='unknown-member')assert.equal(await fs.readFile(path.join(parent,h.f.ownerId,'unknown.json'),'utf8'),'original unknown');
});

test('original independent copied input rejects rehashed preparation, send, changed PNG, missing and hardlinked image',async t=>{
  const h=await setup(t),bound=await bindReferenceWorldAssemblyDraft({...h.options,directory:h.f.jobDirectory,send:h.send});
  const root=path.join(h.f.jobDirectory,'reference-input',h.f.ownerId),args={directory:h.f.jobDirectory,input:bound.referenceInput,model:h.f.generation.model};
  const reference=await readJointAssemblyReferenceInput(args);
  const mutate=async(relative,change)=>{const file=path.join(root,relative),saved=await fs.readFile(file);
    try{await fs.writeFile(file,change(saved));await assert.rejects(readJointAssemblyReferenceInput(args));}finally{await fs.writeFile(file,saved);}};
  await mutate('send.json',value=>{const send=JSON.parse(value);send.maximumCalls++;return JSON.stringify(send);});
  await mutate('reference-preparation.json',value=>{const p=JSON.parse(value);p.generation.prompt='changed';
    const {preparationHash,...content}=p;return JSON.stringify({...content,preparationHash:hash(content)});});
  await mutate('binding.json',value=>{const b=JSON.parse(value);b.ordinaryGenerationAuthorityTransferred=true;
    const {bindingHash,...content}=b;return JSON.stringify({...content,bindingHash:hash(content)});});
  await mutate('joint-preparation.json',value=>{const p=JSON.parse(value);p.maximumCalls=26;return JSON.stringify(p);});
  const image=reference.images[0],retained=path.join(h.f.jobDirectory,'retained-original.png');await fs.rename(image,retained);
  try {await assert.rejects(readJointAssemblyReferenceInput(args));await fs.link(retained,image);
    await assert.rejects(readJointAssemblyReferenceInput(args),/link/);await fs.unlink(image);}
  finally {await fs.rename(retained,image);}
  const png=await fs.readFile(image);try {const changed=Buffer.from(png);changed[changed.length-1]^=1;await fs.writeFile(image,changed);
    await assert.rejects(readJointAssemblyReferenceInput(args));}finally{await fs.writeFile(image,png);}
  await assert.rejects(readJointAssemblyReferenceInput({...args,input:{...args.input,preparationHash:'a'.repeat(64)}}));
  await assert.rejects(readJointAssemblyReferenceInput({...args,model:'other'}));
  await assert.rejects(readJointAssemblyReferenceInput({...args,runtimeHash:'b'.repeat(64)}));
  assert.equal((await readJointAssemblyReferenceInput(args)).binding.bindingHash,bound.referenceInput.bindingHash);
});

test('completed job-owned joint pixels remain readable after draft deletion/expiry; fresh authorization does not',async t=>{
  const h=await setup(t),bound=await bindReferenceWorldAssemblyDraft({...h.options,directory:h.f.jobDirectory,send:h.send});
  const args={directory:h.f.jobDirectory,input:bound.referenceInput,model:h.f.generation.model,runtimeHash:h.f.runtimeHash};
  const draft=path.join(h.f.dataDir,'reference-drafts',h.f.ownerId),retained=path.join(h.f.dataDir,'retained-pixel-draft');
  await fs.rename(draft,retained);await assert.rejects(prepareReferenceWorldAssemblyDraft(h.options));
  assert.equal((await readJointAssemblyReferenceInput(args)).manifest.setHash,h.f.manifest.setHash);
  await fs.rename(retained,draft);
  const originalNow=Date.now;try {Date.now=()=>h.prepared.recordExpiresAt+1;
    await assert.rejects(prepareReferenceWorldAssemblyDraft(h.options),/expired/);
    assert.equal((await readJointAssemblyReferenceInput(args)).manifest.setHash,h.f.manifest.setHash);
    assert.equal((await readFrozenReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:bound.referenceInput})).prepared.preparationHash,h.prepared.preparationHash);
  }finally{Date.now=originalNow;}
});
