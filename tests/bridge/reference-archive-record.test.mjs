import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {referenceFixture} from './reference-generation-fixture.mjs';
import {referenceArchiveOperation} from '../../bridge/reference-archive.mjs';
import {referenceArchiveMaintenanceOperation} from '../../bridge/reference-archive-maintenance.mjs';
import {ReferencePreparationStore} from '../../bridge/reference-preparation.mjs';

async function tree(root){const files=[];
  async function walk(relative=''){for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())await walk(name);else files.push({path:name,sha256:hash(await fs.readFile(path.join(root,name)))});
  }}await walk();return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function fixture(t){
  const f=await referenceFixture(t,{version:2});await f.confirm();
  const archive=(kind,options={},hooks)=>referenceArchiveOperation({dataDir:f.dataDir,ownerId:f.ownerId,operation:'archive-'+kind,...options},hooks);
  const snapshot=await archive('snapshot'),confirmation={format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',
    ownerId:f.ownerId,actionId:randomUUID(),snapshotHash:snapshot.snapshotHash,accepted:true};
  const commit=hooks=>archive('confirm',{input:Buffer.from(JSON.stringify(confirmation))},hooks);
  const read=()=>archive('record',{actionId:confirmation.actionId});
  const root=path.join(f.dataDir,'reference-archives',confirmation.actionId);
  const maintenance=(purpose,kind,options={},hooks)=>referenceArchiveMaintenanceOperation({dataDir:f.dataDir,ownerId:f.ownerId,archiveActionId:confirmation.actionId,
    purpose,operation:kind==='get'?'archive-maintenance-get':`archive-${purpose}-${kind}`,...options},hooks);
  const consent=s=>({format:'ReferenceArchiveMaintenanceConfirmation',version:1,action:s.purpose==='purge'?'permanently-purge-archived-reference':'restore-archived-reference',
    ownerId:f.ownerId,archiveActionId:confirmation.actionId,actionId:randomUUID(),snapshotHash:s.snapshotHash,accepted:true,
    ...(s.purpose==='purge'?{permanentDeletionAccepted:true,retainedCopiesAcknowledged:true}:{})});
  return {...f,snapshot,confirmation,archive,commit,read,root,maintenance,consent};
}
function check(record,f){
  const {recordHash,...content}=record;assert.equal(hash(content),recordHash);assert.equal(record.format,'ReferenceDraftArchiveRecord');assert.equal(record.version,1);
  assert.equal(record.ownerId,f.ownerId);assert.equal(record.actionId,f.confirmation.actionId);
  assert.deepEqual(record.originalIntent.snapshot,f.snapshot);assert.deepEqual(record.originalIntent.confirmation,f.confirmation);
  const {intentHash,...intent}=record.originalIntent;assert.equal(hash(intent),intentHash);assert.equal(intent.confirmationHash,hash(f.confirmation));
  assert.equal(record.additionalModelCalls,0);assert.equal(record.worldWrites,0);assert.equal(record.canAuthorizePlacement,false);
  assert.ok(Buffer.byteLength(JSON.stringify(record))<=131072);
  if(record.maintenance){
    const {intentHash,...intent}=record.maintenance.intent;assert.equal(hash(intent),intentHash);
    assert.deepEqual(record.maintenance.status,record.status.maintenance);assert.equal(intent.archiveActionId,f.confirmation.actionId);
  }
}
test('original record GET preserves pending archive intent without moving data or publishing a receipt',async t=>{
  const f=await fixture(t);await assert.rejects(f.commit({rename(){throw Error('Pause original move');}}),/Pause original/);
  const before=await tree(f.dataDir),record=await f.read();check(record,f);assert.equal(record.status.state,'pending');assert.equal(record.maintenance,null);
  assert.deepEqual(await tree(f.dataDir),before);await assert.rejects(fs.stat(path.join(f.root,'receipt.json')),e=>e.code==='ENOENT');
  const store=new ReferencePreparationStore({dataDir:f.dataDir});t.after(()=>store.close());
  assert.deepEqual(await store.operation('archive-record',f.ownerId,{actionId:f.confirmation.actionId}),record);
  assert.deepEqual(await tree(f.dataDir),before);
});
test('original record GET preserves moved archive without closing the original receipt',async t=>{
  const f=await fixture(t);await assert.rejects(f.commit({async rename(a,b){await fs.rename(a,b);throw Error('Lost original move reply');}}),/Lost original/);
  const before=await tree(f.dataDir),record=await f.read();check(record,f);assert.equal(record.status.state,'moved-awaiting-receipt');assert.equal(record.maintenance,null);
  assert.deepEqual(await tree(f.dataDir),before);await assert.rejects(fs.stat(path.join(f.root,'receipt.json')),e=>e.code==='ENOENT');
  const receipt=await f.commit(),archived=await f.read();check(archived,f);assert.deepEqual(archived.status,receipt);
});
test('preexisting restore/purge original records bind historical consent before and after interrupted local operations',async t=>{
  for(const purpose of ['restore','purge']){
    const f=await fixture(t),receipt=await f.commit(),initial=await f.read();check(initial,f);assert.deepEqual(initial.status,receipt);assert.equal(initial.maintenance,null);
    const snapshot=await f.maintenance(purpose,'snapshot'),c=f.consent(snapshot),input=Buffer.from(JSON.stringify(c));
    const hooks=purpose==='restore'?{async rename(a,b){await fs.rename(a,b);throw Error('Lost original maintenance reply');}}:
      {async unlink(file){await fs.unlink(file);throw Error('Lost original maintenance reply');}};
    await assert.rejects(f.maintenance(purpose,'confirm',{input},hooks),/Lost original/);
    const before=await tree(f.dataDir),record=await f.read();check(record,f);assert.deepEqual(record.maintenance.intent.snapshot,snapshot);
    assert.deepEqual(record.maintenance.intent.confirmation,c);assert.equal(record.maintenance.status.resumeSameAction,true);assert.deepEqual(await tree(f.dataDir),before);
    await assert.rejects(fs.stat(path.join(f.root,'maintenance',c.actionId,'receipt.json')),e=>e.code==='ENOENT');
    const final=await f.maintenance(purpose,'confirm',{input}),completed=await f.read();check(completed,f);assert.deepEqual(completed.maintenance.status,final);
    assert.equal(completed.status.state,purpose==='restore'?'restored':'purged');assert.deepEqual(completed.status.originalArchiveReceipt,receipt);
    const after=await tree(f.dataDir);assert.deepEqual(await f.read(),completed);assert.deepEqual(await tree(f.dataDir),after);
  }
});
test('record reads reject exact owner/action mismatch and preserve unknown files or altered original intent',async t=>{
  const f=await fixture(t);await f.commit();const before=await tree(f.dataDir);
  for(const options of [{ownerId:randomUUID()},{actionId:randomUUID()},{actionId:'../../world'}])await assert.rejects(f.archive('record',{actionId:f.confirmation.actionId,...options}));
  assert.deepEqual(await tree(f.dataDir),before);
  await fs.writeFile(path.join(f.root,'foreign.txt'),'must remain');const foreign=await tree(f.dataDir);
  await assert.rejects(f.read(),/Unknown original archive action/);assert.deepEqual(await tree(f.dataDir),foreign);
});
test('record GET rejects corrupted archive or maintenance intent without repairing or deleting it',async t=>{
  for(const kind of ['archive','maintenance']){
    const f=await fixture(t);await f.commit();let file=path.join(f.root,'intent.json');
    if(kind==='maintenance'){
      const s=await f.maintenance('restore','snapshot'),c=f.consent(s);
      await assert.rejects(f.maintenance('restore','confirm',{input:Buffer.from(JSON.stringify(c))},{rename(){throw Error('Pause original restore');}}),/Pause/);
      file=path.join(f.root,'maintenance',c.actionId,'intent.json');
    }
    const saved=JSON.parse(await fs.readFile(file));saved.confirmation.accepted=false;
    // Even valid replacement hashes cannot turn historical refusal into consent.
    saved.confirmationHash=hash(saved.confirmation);delete saved.intentHash;saved.intentHash=hash(saved);
    await fs.writeFile(file,JSON.stringify(saved));const before=await tree(f.dataDir);
    await assert.rejects(f.read());assert.deepEqual(await tree(f.dataDir),before);
  }
});
