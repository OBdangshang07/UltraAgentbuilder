import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {referenceFixture,freeConsent,sendConsent} from './reference-generation-fixture.mjs';

test('job-owned single/multiple references retain exact draft identity, pixels and annotations',async t=>{
  for(const images of [1,4]){
    const f=await referenceFixture(t,{images});await f.confirm();const input=await f.bind();
    const r=await readJobReferenceInput({directory:f.jobDirectory,input,model:f.capability.id,runtimeHash:f.runtimeHash});
    assert.equal(r.binding.jobId,f.jobId);assert.equal(r.manifest.ownerId,f.ownerId);assert.notEqual(f.ownerId,f.jobId);
    assert.equal(r.images.length,images);assert.equal(r.manifest.setHash,f.preparation.referenceSetHash);
    assert.equal(r.binding.policyHash,hash(f.preparation.policy));assert.equal(r.binding.canAuthorizePlacement,false);
    assert.deepEqual(r.preparation,f.preparation);
    const draft=path.join(f.dataDir,'reference-drafts',f.ownerId);
    for(const [i,image] of r.images.entries()){
      assert.equal(hash(await fs.readFile(image)),f.preparation.references[i].sha256);
      assert.deepEqual(await fs.readFile(image),await fs.readFile(path.join(draft,'reference-sets',r.manifest.setHash,`image-${i}.png`)));
    }
    assert.deepEqual(await f.bind(),input);assert.equal((await fs.readdir(f.jobDirectory)).includes('assembly-journal'),false);
    await fs.rename(draft,path.join(f.dataDir,'archived-draft-'+f.ownerId));
    assert.deepEqual((await readJobReferenceInput({directory:f.jobDirectory,input,model:f.capability.id})).manifest,r.manifest);
  }
});
test('free preparation confirmation never substitutes for explicit full SEND',async t=>{
  const f=await referenceFixture(t);
  await assert.rejects(f.bind(),e=>e.code==='ENOENT');assert.deepEqual(await fs.readdir(f.jobDirectory),[]);
  await f.confirm();
  for(const sendConfirmation of [undefined,freeConsent(f.preparation),{...sendConsent(f.preparation),accepted:false},
    {...sendConsent(f.preparation),action:'preview'}, {...sendConsent(f.preparation),extraAuthority:true}])
    await assert.rejects(f.bind({sendConfirmation}));
  assert.deepEqual(await fs.readdir(f.jobDirectory),[]);
});
test('every frozen request, model, policy, runtime and send field is required before copying',async t=>{
  const f=await referenceFixture(t);await f.confirm();
  for(const options of [{generation:{...f.generation,prompt:'changed'}},{generation:{...f.generation,key:randomUUID()}},
    {runtimeHash:'b'.repeat(64)},{capability:{id:f.capability.id,supportsImages:false}},{capability:{id:'other',supportsImages:true}}])
    await assert.rejects(f.bind(options));
  for(const key of ['ownerId','preparationHash','requestHash','generationHash','setHash','policyHash','runtimeHash','provider','model'])
    await assert.rejects(f.bind({sendConfirmation:{...sendConsent(f.preparation),[key]:key==='ownerId'?randomUUID():'changed'}}));
  assert.deepEqual(await fs.readdir(f.jobDirectory),[]);
});
test('runtime-only preparation changes cannot reuse consent even when old requestHash is unchanged',async t=>{
  const f=await referenceFixture(t);await f.confirm();
  const newer=await f.prepare({runtimeHash:'b'.repeat(64)});await f.confirm(newer);
  assert.equal(newer.requestHash,f.preparation.requestHash);assert.notEqual(newer.preparationHash,f.preparation.preparationHash);
  await assert.rejects(f.bind({preparationHash:newer.preparationHash,runtimeHash:newer.runtimeHash}),/SEND/);
  assert.deepEqual(await fs.readdir(f.jobDirectory),[]);
});
test('changed image annotations and input identities cannot rebind a completed job attachment',async t=>{
  const f=await referenceFixture(t);await f.confirm();const input=await f.bind();
  const request=structuredClone(f.request);request.upload.references[0].annotation.caption='different reference text';
  const newer=await f.prepare({input:Buffer.from(JSON.stringify(request))});await f.confirm(newer);
  await assert.rejects(f.bind({preparationHash:newer.preparationHash,sendConfirmation:sendConsent(newer)}));
  const r=await readJobReferenceInput({directory:f.jobDirectory,input,model:f.capability.id});assert.deepEqual(r.preparation,f.preparation);
  for(const modified of [{...input,ownerId:randomUUID()},{...input,bindingHash:'b'.repeat(64)},{...input,path:'C:/private.png'}])
    await assert.rejects(readJobReferenceInput({directory:f.jobDirectory,input:modified,model:f.capability.id}));
});
test('job-owned input refuses changed canonical image bytes and cross-job copies',async t=>{
  const f=await referenceFixture(t);await f.confirm();const input=await f.bind();
  const args={directory:f.jobDirectory,input,model:f.capability.id},r=await readJobReferenceInput(args),image=r.images[0],original=await fs.readFile(image);
  await fs.writeFile(image,Buffer.from('not the reference'));await assert.rejects(readJobReferenceInput(args));await fs.writeFile(image,original);
  const moved=path.join(f.dataDir,randomUUID());await fs.rename(f.jobDirectory,moved);
  await assert.rejects(readJobReferenceInput({...args,directory:moved}),/binding identity/);
});
test('rehashed unknown binding fields, changed SEND and free confirmation receipts are rejected',async t=>{
  const f=await referenceFixture(t);await f.confirm();const input=await f.bind(),root=path.join(f.jobDirectory,'reference-input',f.ownerId);
  const args={directory:f.jobDirectory,input,model:f.capability.id},file=path.join(root,'binding.json'),original=await fs.readFile(file),binding=JSON.parse(original);
  const {bindingHash,...content}=binding;content.allowWorldWrite=true;const forged={...content,bindingHash:hash(content)};
  await fs.writeFile(file,JSON.stringify(forged));await assert.rejects(readJobReferenceInput({...args,input:{...input,bindingHash:forged.bindingHash}}));
  await fs.writeFile(file,original);
  const send=path.join(root,'send.json'),sendBytes=await fs.readFile(send);
  await fs.writeFile(send,JSON.stringify({...sendConsent(f.preparation),model:'other'}));await assert.rejects(readJobReferenceInput(args));await fs.writeFile(send,sendBytes);
  const confirmation=path.join(root,'preparations',f.preparation.preparationHash,'confirmation.json'),saved=JSON.parse(await fs.readFile(confirmation));
  saved.receipt.callsReserved=1;await fs.writeFile(confirmation,JSON.stringify(saved));await assert.rejects(readJobReferenceInput(args));
});
test('linked reference directories and image files cannot redirect the model to arbitrary local data',async t=>{
  const f=await referenceFixture(t);await f.confirm();const input=await f.bind(),args={directory:f.jobDirectory,input,model:f.capability.id};
  const r=await readJobReferenceInput(args),image=r.images[0],saved=image+'.saved';await fs.rename(image,saved);
  await fs.symlink(saved,image,'file');await assert.rejects(readJobReferenceInput(args),/link|canonical/);
});
