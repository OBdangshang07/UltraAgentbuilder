import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {referenceFixture} from './reference-generation-fixture.mjs';
import {v4Request} from './quality-v4-fixtures.mjs';
import {WorldContextStore} from '../../bridge/world-context-store.mjs';
import {selectionChunks,regionCells} from '../../contracts/world-selection.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {readReferenceWorldPatchPreparationSource} from '../../bridge/reference-world-patch-source.mjs';
import {prepareReferenceWorldAssembly,verifyReferenceWorldAssemblySend} from '../../bridge/reference-world-assembly.mjs';
import {coupledReferenceWorldAssemblyPreparation,prepareCoupledReferenceWorldAssembly,verifyCoupledReferenceWorldAssemblySend,
  freezeCoupledReferenceWorldAssembly,readFrozenCoupledReferenceWorldAssembly,COUPLED_REFERENCE_ASSEMBLY_ARCHIVE} from '../../bridge/coupled-reference-world-assembly-preparation.mjs';
import {ASSEMBLY_COUPLING_POLICY_HASH} from '../../contracts/assembly-coupling-policy.mjs';
import {assemblyGenerationContext,COUPLED_ASSEMBLY_GENERATION_RULES} from '../../src/world/assembly-coupled-context.mjs';
import {hash} from '../../src/generation/compiler.mjs';

const sendFor=p=>({format:'CoupledReferenceWorldAssemblySend',version:1,purpose:'coupled-reference-world-assembly',confirmed:true,preparationHash:p.preparationHash,maximumCalls:p.maximumCalls});
async function fixture(t){
  const {model,...generationOverrides}=v4Request,f=await referenceFixture(t,{version:2,images:1,generationOverrides:{...generationOverrides,qualityTier:'lite'}});
  const contextId=randomUUID(),origin=[-16,-40,-16],size=[16,10,16],selection={format:'WorldSelection',version:1,
    world:{worldId:'synthetic_coupled_prep',dimension:'minecraft:overworld',minY:-64,maxY:320},revision:7,
    context:{min:origin.map(v=>v-1),max:origin.map((v,i)=>v+size[i]+1)},edit:{min:origin,max:origin.map((v,i)=>v+size[i])},protected:[]};
  const capture={fence:{start:9,end:9},chunks:selectionChunks(selection).map(c=>({x:c.x,z:c.z,coverage:'known',palette:[{state:'minecraft:air',blockEntity:false}],runs:[[0,regionCells(c.region)]]}))};
  const store=new WorldContextStore({dataDir:f.dataDir});t.after(()=>store.close());const saved=await store.operation('capture',contextId,Buffer.from(JSON.stringify({selection,capture})));
  await f.confirm();const referenceInput=await f.bind(),selectedCapability={id:f.generation.model,supportsImages:true,efforts:['high','max']};
  const options={dataDir:f.dataDir,directory:f.jobDirectory,contextId,referenceInput,selectedCapability},prepared=await prepareCoupledReferenceWorldAssembly(options);
  const source=await readReferenceWorldPatchPreparationSource({dataDir:f.dataDir,contextId,intent:{referenceOwnerId:f.ownerId,referenceSetHash:f.preparation.referenceSetHash}});
  return {f,selection,saved:source.saved,referenceInput,options,prepared,send:sendFor(prepared),root:path.join(f.jobDirectory,COUPLED_REFERENCE_ASSEMBLY_ARCHIVE)};
}
test('new coupled preparation binds exact original scope/images/shared budget and rejects legacy full SEND',async t=>{
  const h=await fixture(t),old=await prepareReferenceWorldAssembly(h.options),p=h.prepared;
  assert.equal(p.format,'CoupledReferenceWorldAssemblyPreparation');assert.equal(p.version,1);assert.equal(p.maximumCalls,8);assert.equal(p.modelSent,false);assert.equal(p.callsReserved,0);assert.equal(p.canAuthorizePlacement,false);
  assert.equal(p.couplingPolicyHash,ASSEMBLY_COUPLING_POLICY_HASH);assert.deepEqual(p.origin,h.selection.edit.min);assert.equal(p.snapshotHash,old.snapshotHash);assert.equal(p.selectionHash,old.selectionHash);assert.notEqual(p.worldContextHash,old.worldContextHash);assert.notEqual(p.preparationHash,old.preparationHash);
  verifyCoupledReferenceWorldAssemblySend(h.send,p);
  assert.throws(()=>verifyCoupledReferenceWorldAssemblySend({...h.send,format:'ReferenceWorldAssemblySend',version:2,purpose:'reference-world-assembly'},p),/New exact coupled/);
  assert.throws(()=>verifyReferenceWorldAssemblySend(h.send,old),/exact full-task SEND/);
});
test('free freeze/read retains complete original coupled context without calls, old archive or candidate',async t=>{
  const h=await fixture(t),p=await freezeCoupledReferenceWorldAssembly({...h.options,send:h.send});assert.deepEqual(p,h.prepared);
  const first=await fs.readFile(path.join(h.root,'manifest.json')),read=await readFrozenCoupledReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput});
  assert.deepEqual(read.prepared,p);assert.equal(assemblyGenerationContext(read.worldContext).rules,COUPLED_ASSEMBLY_GENERATION_RULES);assert.equal(read.worldContext.worldContextHash,p.worldContextHash);
  assert.deepEqual(await freezeCoupledReferenceWorldAssembly({...h.options,send:h.send}),p);assert.deepEqual(await fs.readFile(path.join(h.root,'manifest.json')),first);
  assert.equal(read.manifest.files.length,8);assert.equal(read.manifest.modelSent,false);for(const name of ['assembly-journal','reference-world-assembly-v2','reference-world-assembly-candidate-v2'])await assert.rejects(fs.lstat(path.join(h.f.jobDirectory,name)),{code:'ENOENT'});
});
test('wrong purpose, scope hash or budget cannot create a coupled archive',async t=>{
  const h=await fixture(t);for(const change of [{purpose:'reference-world-assembly'},{preparationHash:'f'.repeat(64)},{maximumCalls:26},{confirmed:false},{format:'ReferenceWorldAssemblySend',version:2}])await assert.rejects(freezeCoupledReferenceWorldAssembly({...h.options,send:{...h.send,...change}}),/New exact coupled/);
  await assert.rejects(fs.lstat(h.root),{code:'ENOENT'});
});
test('image/effort advertisement and requested bounds remain mandatory before any call',async t=>{
  const h=await fixture(t),reference=await readJobReferenceInput({directory:h.f.jobDirectory,input:h.referenceInput,model:h.f.generation.model});
  for(const cap of [{...h.options.selectedCapability,supportsImages:false},{...h.options.selectedCapability,efforts:['high']},{...h.options.selectedCapability,id:'different-synthetic-model'}])assert.throws(()=>coupledReferenceWorldAssemblyPreparation(reference,h.saved,cap),/Exact advertised/);
  const oversized=structuredClone(reference);oversized.preparation.policy.minimumHeight=11;assert.throws(()=>coupledReferenceWorldAssemblyPreparation(oversized,h.saved,h.options.selectedCapability),/cannot fit original W/);
});
test('self-rehashed changed archive payload does not replace independently reconstructed source facts',async t=>{
  const h=await fixture(t);await freezeCoupledReferenceWorldAssembly({...h.options,send:h.send});const file=path.join(h.root,'payload.json'),bytes=Buffer.concat([await fs.readFile(file),Buffer.from(' ')]);await fs.writeFile(file,bytes);
  const manifest=JSON.parse(await fs.readFile(path.join(h.root,'manifest.json'))),pin=manifest.files.find(f=>f.path==='payload.json');pin.bytes=bytes.length;pin.sha256=hash(bytes);delete manifest.manifestHash;manifest.manifestHash=hash(manifest);await fs.writeFile(path.join(h.root,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(readFrozenCoupledReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput}));
});
test('partial or unknown publication remains preserved and cannot be silently completed',async t=>{
  const h=await fixture(t);await fs.mkdir(h.root);const sentinel=path.join(h.root,'partial-original.json');await fs.writeFile(sentinel,'retained synthetic partial');
  await assert.rejects(freezeCoupledReferenceWorldAssembly({...h.options,send:h.send}));assert.equal(await fs.readFile(sentinel,'utf8'),'retained synthetic partial');await assert.rejects(fs.lstat(path.join(h.root,'manifest.json')),{code:'ENOENT'});
});
test('expiry permits archival inspection, never a new freeze or refreshed model permission',async t=>{
  const h=await fixture(t);await freezeCoupledReferenceWorldAssembly({...h.options,send:h.send});t.mock.timers.enable({apis:['Date'],now:h.prepared.recordExpiresAt+1});
  const read=await readFrozenCoupledReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput});assert.equal(read.prepared.recordExpiresAt,h.prepared.recordExpiresAt);assert.equal(read.prepared.canAuthorizePlacement,false);
  await assert.rejects(freezeCoupledReferenceWorldAssembly({...h.options,send:h.send}),/expired/i);
});
test('unknown archive member is not evicted or ignored by an archival read',async t=>{
  const h=await fixture(t);await freezeCoupledReferenceWorldAssembly({...h.options,send:h.send});const unknown=path.join(h.root,'unknown.json');await fs.writeFile(unknown,'retained synthetic unknown');
  await assert.rejects(readFrozenCoupledReferenceWorldAssembly({directory:h.f.jobDirectory,referenceInput:h.referenceInput}),/Incomplete\/unknown/);assert.equal(await fs.readFile(unknown,'utf8'),'retained synthetic unknown');
});
