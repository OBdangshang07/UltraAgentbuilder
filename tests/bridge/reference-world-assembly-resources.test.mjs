import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ReferenceWorldAssemblyResources,JOINT_ASSEMBLY_RESOURCE_LIMITS} from '../../bridge/reference-world-assembly-resources.mjs';
import {REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY} from '../../bridge/reference-world-assembly-candidate.mjs';
import {jointResourceFixture,jointResourceBytes} from './joint-assembly-resource-fixture.mjs';

test('worker preparation is free and path-owned; bind requires an independently created original job and exact new SEND',async t=>{
  const h=await jointResourceFixture(t);
  assert.equal(h.prepared.modelSent,false);assert.equal(h.prepared.callsReserved,0);
  await assert.rejects(fs.stat(h.resources.root),e=>e.code==='ENOENT');
  await assert.rejects(h.operation('bind',{...h.input,send:h.send}));
  assert.deepEqual(await fs.readdir(h.f.jobDirectory),[]);await assert.rejects(fs.stat(h.resources.root),e=>e.code==='ENOENT');
  const bound=await h.bind();assert.deepEqual(bound.prepared,h.prepared);assert.equal(bound.referenceInput.format,'JointAssemblyReferenceInput');
  assert.deepEqual(await h.operation('bind',{...h.input,send:h.send}),bound);
  assert.equal(Object.isFrozen(bound),true);assert.equal(Object.isFrozen(bound.prepared.imageAnnotations[0]),true);
  await assert.rejects(fs.stat(path.join(h.f.jobDirectory,'assembly-journal')),e=>e.code==='ENOENT');
  await assert.rejects(fs.stat(path.join(h.f.dataDir,'reference-drafts',h.f.ownerId,'preparations')),e=>e.code==='ENOENT');
});

for(const tier of ['lite','pro','max','ultra'])test(tier+' resource reads verify actual shared full pipeline and complete original differences before ANY part',async t=>{
  const h=await jointResourceFixture(t,{tier,images:tier==='lite'?1:4}),bound=await h.bind(),result=await h.run(bound);
  const read={referenceInput:bound.referenceInput,preparationHash:h.prepared.preparationHash,candidateHash:result.candidate.candidateHash};
  const metadata=await h.operation('metadata',read),part=await h.operation('part',{...read,partIndex:0});
  assert.equal(metadata.originalCompleteSetReverified,true);assert.equal(metadata.candidate.reservedCalls,h.calls.length);
  assert.equal(metadata.candidate.maximumCalls,{lite:8,pro:14,max:20,ultra:26}[tier]);
  assert.equal(part.partIsApplyScope,false);assert.equal(part.canAuthorizePlacement,false);assert.equal(part.additionalModelCalls,0);
  assert.equal(part.worldWrites,0);assert.equal(part.completeSetVerified,true);assert.deepEqual(part.patch,result.patches[0]);
  assert.equal(Object.isFrozen(part.patch.writes[0]),true);assert.equal(h.calls.length,tier==='ultra'?17:8);
  assert.doesNotMatch(JSON.stringify(metadata),new RegExp(h.f.dataDir.replaceAll('\\','\\\\')));
  for(const wrong of [{...read,candidateHash:'a'.repeat(64)},{...read,preparationHash:'b'.repeat(64)},
    {...read,referenceInput:{...read.referenceInput,ownerId:randomUUID()}},{...read,directory:h.f.jobDirectory}])await assert.rejects(h.operation('metadata',wrong));
  for(const partIndex of [-1,'0',0.5,32])await assert.rejects(h.operation('part',{...read,partIndex}));
  if(tier==='ultra') {
    assert.equal(result.scene.bounds.height,224);assert.equal(result.patches.length>1,true);
    const file=path.join(h.f.jobDirectory,REFERENCE_ASSEMBLY_CANDIDATE_DIRECTORY,`part-${String(result.patches.length-1).padStart(3,'0')}.json`);
    const retained=path.join(h.f.jobDirectory,'retained-original-part.json');await fs.rename(file,retained);
    try{await assert.rejects(h.operation('part',{...read,partIndex:0}));}finally{await fs.rename(retained,file);}
  }
  const root=path.join(h.f.dataDir,'reference-drafts',h.f.ownerId),retained=path.join(h.f.dataDir,'retained-original-draft');await fs.rename(root,retained);
  assert.equal((await h.operation('metadata',read)).candidate.candidateHash,read.candidateHash);
  await assert.rejects(h.operation('prepare'));assert.equal(h.calls.length,result.records.length);
});

test('strict resource operation/UUID/bytes/UTF-8/keys reject caller paths, authority and model actions',async t=>{
  const h=await jointResourceFixture(t);
  for(const operation of ['send','invoke','recover','render','apply','__proto__'])await assert.rejects(h.resources.operation(operation,h.f.ownerId,jointResourceBytes(h.input)));
  for(const id of ['../jobs',h.f.ownerId+'/..',h.f.ownerId.toUpperCase(),'C:/fixture/private'])await assert.rejects(h.resources.operation('prepare',id,jointResourceBytes(h.input)));
  for(const payload of [undefined,{},'',Buffer.alloc(0),Buffer.alloc(JOINT_ASSEMBLY_RESOURCE_LIMITS.inputBytes+1),Buffer.from([123,34,255,34,58,49,125])])
    await assert.rejects(h.resources.operation('prepare',h.f.ownerId,payload));
  for(const injected of ['directory','dataDir','runtimeHash','adapter','canAuthorizePlacement','send'])await assert.rejects(h.operation('prepare',{...h.input,[injected]:'unauthorized'}));
  await assert.rejects(h.operation('prepare',{...h.input,generation:{...h.f.generation,key:randomUUID()}}));
  assert.deepEqual(await fs.readdir(h.f.jobDirectory),[]);await assert.rejects(fs.stat(h.resources.root),e=>e.code==='ENOENT');
});

test('resource queue is bounded and retains exact copied queued input, not a caller-mutated Buffer',async t=>{
  const h=await jointResourceFixture(t),bytes=jointResourceBytes(h.input);
  const pending=[h.resources.operation('prepare',h.f.ownerId,bytes),h.resources.operation('prepare',h.f.ownerId,bytes),h.resources.operation('prepare',h.f.ownerId,bytes)];
  bytes.fill(0);assert.equal(h.resources.busy(),true);
  await assert.rejects(h.resources.operation('prepare',h.f.ownerId,jointResourceBytes(h.input)),e=>e.statusCode===429);
  for(const value of await Promise.all(pending))assert.deepEqual(value,h.prepared);
  await h.resources.close();assert.equal(h.resources.busy(),false);
});

test('cancellation retires active/queued workers without retry; closed resources reject future work',async t=>{
  const h=await jointResourceFixture(t),controller=new AbortController();
  const active=h.operation('prepare',h.input,{signal:controller.signal}),queued=h.operation('prepare');
  const checks=[assert.rejects(active,/cancelled/),assert.rejects(queued,/cancelled/)];
  controller.abort();const cancelled=await h.resources.cancel(h.f.ownerId);await Promise.all(checks);
  assert.equal(cancelled.canAuthorizePlacement,false);assert.equal(cancelled.additionalModelCalls,0);assert.equal(h.resources.busy(),false);
  assert.deepEqual(await h.operation('prepare'),h.prepared);
  const a=h.operation('prepare'),b=h.operation('prepare'),closed=[assert.rejects(a,/closed/),assert.rejects(b,/closed/)];
  await h.resources.close();await Promise.all(closed);assert.equal(h.resources.busy(),false);await assert.rejects(h.operation('prepare'),/closed/);
});

test('fixed time quota retires only the original worker and does not turn an observation timeout into retry authority',async t=>{
  const h=await jointResourceFixture(t);t.mock.timers.enable({apis:['setTimeout']});
  const work=h.operation('prepare'),rejected=assert.rejects(work,e=>e.statusCode===503&&/time quota/.test(e.message));
  t.mock.timers.tick(JOINT_ASSEMBLY_RESOURCE_LIMITS.operationMs+1);await rejected;t.mock.timers.reset();
  assert.equal(h.resources.busy(),false);assert.equal(h.calls.length,0);
  await assert.rejects(fs.stat(h.resources.root),e=>e.code==='ENOENT');
  assert.deepEqual(await h.operation('prepare'),h.prepared,'Only a separately requested NEW free verification can run');
});

for(const kind of ['partial','unknown'])test(kind+' input is preserved; queued bind never repairs or takes over it',async t=>{
  const h=await jointResourceFixture(t);await fs.mkdir(h.resources.root);const dir=path.join(h.resources.root,h.f.ownerId);
  await fs.rename(h.f.jobDirectory,dir);await fs.mkdir(path.join(dir,'reference-input'));
  if(kind==='unknown')await fs.writeFile(path.join(dir,'reference-input','unknown-original'),'retain');
  await assert.rejects(h.operation('bind',{...h.input,send:h.send}));
  const names=await fs.readdir(path.join(dir,'reference-input'));assert.deepEqual(names,kind==='unknown'?['unknown-original']:[]);
  if(kind==='unknown')assert.equal(await fs.readFile(path.join(dir,'reference-input','unknown-original'),'utf8'),'retain');
  assert.equal(h.calls.length,0);
});

test('redirected private job root is rejected without touching another directory',async t=>{
  const h=await jointResourceFixture(t),target=path.join(h.f.dataDir,'untouched');await fs.mkdir(target);await fs.writeFile(path.join(target,'private'),'retain');
  try{await fs.symlink(target,h.resources.root,process.platform==='win32'?'junction':'dir');}
  catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS directory-link privilege unavailable');return;}throw e;}
  await assert.rejects(h.operation('bind',{...h.input,send:h.send}));assert.deepEqual(await fs.readdir(target),['private']);
  assert.equal(await fs.readFile(path.join(target,'private'),'utf8'),'retain');
});
