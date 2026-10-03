import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {referenceFixture,sendConsent} from './reference-generation-fixture.mjs';
import {referenceArchiveOperation} from '../../bridge/reference-archive.mjs';
import {referenceArchiveMaintenanceOperation} from '../../bridge/reference-archive-maintenance.mjs';
import {referenceGenerationOperation} from '../../bridge/reference-generation-worker.mjs';
import {openAssemblyJournal} from '../../bridge/assembly-durability.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {ReferencePreparationStore} from '../../bridge/reference-preparation.mjs';

const input=v=>Buffer.from(JSON.stringify(v));
const archiveConsent=s=>({format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',actionId:randomUUID(),ownerId:s.ownerId,snapshotHash:s.snapshotHash,accepted:true});
function consent(s,actionId=randomUUID()){
  return {format:'ReferenceArchiveMaintenanceConfirmation',version:1,action:s.purpose==='purge'?'permanently-purge-archived-reference':'restore-archived-reference',
    actionId,archiveActionId:s.archiveActionId,ownerId:s.ownerId,snapshotHash:s.snapshotHash,accepted:true,
    ...(s.purpose==='purge'?{permanentDeletionAccepted:true,retainedCopiesAcknowledged:true}:{})};
}
async function tree(root){const files=[];
  async function walk(relative=''){for(const e of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+e.name:e.name;if(e.isDirectory())await walk(name);else files.push({path:name,sha256:hash(await fs.readFile(path.join(root,name)))});
  }}await walk();return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function fixture(t,{submitted=false}={}){
  const f=await referenceFixture(t,{images:2,version:2});await f.confirm();let originalJob=null;
  if(submitted){
    await fs.mkdir(path.join(f.dataDir,'jobs'));
    const send={format:'ReferenceGenerationJobRequest',version:1,ownerId:f.ownerId,preparationHash:f.preparation.preparationHash,sendConfirmation:sendConsent(f.preparation)};
    const descriptor=await referenceGenerationOperation({dataDir:f.dataDir,operation:'submit',input:input(send),runtimeHash:f.runtimeHash,capability:f.capability});
    const root=path.join(f.dataDir,'jobs',descriptor.jobId),journal=await openAssemblyJournal({directory:root,requestHash:descriptor.requestHash,policy:descriptor.policy,runtimeHash:descriptor.runtimeHash});
    await journal.invoke('Synthetic original complete receipt',1,{outputSchema:{},stageName:'reference-analysis'},async()=>({spec:{format:'SyntheticReceipt'}}));
    const job={id:descriptor.jobId,key:f.ownerId,requestHash:descriptor.requestHash,preflight:descriptor.policy,state:'failed',recoveryEnabled:true,
      assemblyCallsReserved:1,recovery:{reservedCalls:1},referenceGeneration:{version:1,preparationHash:f.preparation.preparationHash,input:descriptor.referenceInput}};
    await fs.writeFile(path.join(root,'job.json'),JSON.stringify(job));originalJob={root,job,descriptor};
  }
  const archive=(operation,options={})=>referenceArchiveOperation({dataDir:f.dataDir,ownerId:f.ownerId,operation:'archive-'+operation,...options});
  const snapshot=await archive('snapshot'),a=archiveConsent(snapshot),receipt=await archive('confirm',{input:input(a)});
  const run=(purpose,operation,options={},hooks)=>referenceArchiveMaintenanceOperation({dataDir:f.dataDir,ownerId:f.ownerId,archiveActionId:a.actionId,
    purpose,operation:operation==='get'?'archive-maintenance-get':`archive-${purpose}-${operation}`,...options},hooks);
  return {...f,a,receipt,originalJob,archive,run,snapshot:purpose=>run(purpose,'snapshot'),commit:(c,hooks)=>run(c.action.startsWith('permanently')?'purge':'restore','confirm',{input:input(c)},hooks),
    get:c=>run(c.action.startsWith('permanently')?'purge':'restore','get',{actionId:c.actionId}),
    source:path.join(f.dataDir,'reference-drafts',f.ownerId),target:path.join(f.dataDir,'reference-archives',a.actionId,f.ownerId),archiveRoot:path.join(f.dataDir,'reference-archives',a.actionId)};
}

test('restore and purge disclosures are read-only, independent and acknowledge retained task/audit copies',async t=>{
  const f=await fixture(t),before=await tree(f.dataDir);
  for(const purpose of ['restore','purge']){const s=await f.snapshot(purpose),{snapshotHash,...content}=s;assert.equal(hash(content),snapshotHash);
    assert.equal(s.purpose,purpose);assert.equal(s.permanentDeletion,purpose==='purge');assert.equal(s.archiveReceiptHash,f.receipt.receiptHash);
    assert.equal(s.retainsJobOriginals,true);assert.equal(s.retainsAuditRecords,true);assert.equal(s.restoresGenerationAuthority,false);assert.equal(s.additionalModelCalls,0);assert.equal(s.worldWrites,0);}
  assert.deepEqual(await tree(f.dataDir),before);
});
test('restore preserves exact bytes, returns no generation authority and permits later explicit edits/rearchive',async t=>{
  const f=await fixture(t),before=await tree(f.target),c=consent(await f.snapshot('restore')),r=await f.commit(c);
  assert.equal(r.state,'restored');assert.equal(r.restoresGenerationAuthority,false);assert.deepEqual(await tree(f.source),before);
  assert.deepEqual(await f.commit(c),r);assert.deepEqual(await f.get(c),r);
  assert.deepEqual(await f.archive('confirm',{input:input(f.a)}),f.receipt,'Old archive POST must never rearchive restored data');
  assert.equal((await f.archive('get',{actionId:f.a.actionId})).state,'restored');assert.deepEqual(await f.prepare(),f.preparation);
  f.request.generation.prompt='Explicit new edited request';await f.prepare();assert.equal((await f.get(c)).state,'restored');
  const next=archiveConsent(await f.archive('snapshot'));assert.notEqual(next.actionId,f.a.actionId);assert.equal((await f.archive('confirm',{input:input(next)})).state,'archived');
  assert.equal((await f.get(c)).state,'restored');
});
test('restore lost reply after move finalizes same action without a second move or overwrite',async t=>{
  const f=await fixture(t),c=consent(await f.snapshot('restore'));let moves=0;
  await assert.rejects(f.commit(c,{async rename(a,b){moves++;await fs.rename(a,b);throw Error('Injected restore lost reply');}}),/lost reply/);
  const before=await tree(f.dataDir),status=await f.get(c);assert.equal(status.state,'restore-moved-awaiting-receipt');assert.deepEqual(await tree(f.dataDir),before);
  const r=await f.commit(c,{rename(){throw Error('Must not repeat move');}});assert.equal(r.state,'restored');assert.equal(moves,1);
});
test('restore quota and active-owner conflicts preserve archived records before writing any maintenance intent',async t=>{
  for(const kind of ['quota','owner']){
    const f=await fixture(t),c=consent(await f.snapshot('restore'));
    if(kind==='quota')for(let i=0;i<64;i++)await fs.mkdir(path.join(f.dataDir,'reference-drafts',randomUUID()));
    else{await fs.mkdir(f.source);await fs.writeFile(path.join(f.source,'preserve.txt'),'later draft');}
    const before=await tree(f.dataDir);await assert.rejects(f.commit(c));assert.deepEqual(await tree(f.dataDir),before);
    await assert.rejects(fs.stat(path.join(f.archiveRoot,'maintenance')),e=>e.code==='ENOENT');
  }
});
test('purge requires both explicit permanent-deletion consent and retained-copy acknowledgement',async t=>{
  const f=await fixture(t),c=consent(await f.snapshot('purge')),before=await tree(f.dataDir);
  for(const change of [{accepted:false},{permanentDeletionAccepted:false},{retainedCopiesAcknowledged:false},{action:'restore-archived-reference'},
    {snapshotHash:'b'.repeat(64)},{ownerId:randomUUID()},{archiveActionId:randomUUID()},{actionId:f.a.actionId},{path:'C:/private'}])await assert.rejects(f.commit({...c,...change}));
  for(const field of ['permanentDeletionAccepted','retainedCopiesAcknowledged']){const wrong={...c};delete wrong[field];await assert.rejects(f.commit(wrong));}
  assert.deepEqual(await tree(f.dataDir),before);await assert.rejects(fs.stat(path.join(f.archiveRoot,'maintenance')),e=>e.code==='ENOENT');
});
test('permanent purge removes only confirmed archived file inventory and retains original archive audits',async t=>{
  const f=await fixture(t),s=await f.snapshot('purge'),c=consent(s),intentBytes=await fs.readFile(path.join(f.archiveRoot,'intent.json')),receiptBytes=await fs.readFile(path.join(f.archiveRoot,'receipt.json'));
  const marker=path.join(f.dataDir,'world-and-source-marker');await fs.writeFile(marker,'preserve all unrelated copies');
  const r=await f.commit(c);assert.equal(r.state,'purged');assert.equal(r.permanentDeletion,true);assert.equal(r.fileCount,s.inventory.files.length);
  await assert.rejects(fs.stat(f.target),e=>e.code==='ENOENT');assert.deepEqual(await fs.readFile(path.join(f.archiveRoot,'intent.json')),intentBytes);
  assert.deepEqual(await fs.readFile(path.join(f.archiveRoot,'receipt.json')),receiptBytes);assert.equal(await fs.readFile(marker,'utf8'),'preserve all unrelated copies');
  assert.equal((await f.archive('get',{actionId:f.a.actionId})).state,'purged');assert.deepEqual(await f.archive('confirm',{input:input(f.a)}),f.receipt);
  assert.deepEqual(await f.get(c),r);assert.deepEqual(await f.commit(c,{unlink(){throw Error('No second deletion');},rmdir(){throw Error('No second directory removal');}}),r);
  await assert.rejects(f.prepare(),/original archive action/);assert.equal((await f.archive('list')).actions[0].state,'purged');
});
test('interruption after unlink before per-file receipt preserves ambiguity and resumes only exact missing/surviving files',async t=>{
  const f=await fixture(t),s=await f.snapshot('purge'),c=consent(s);let deletes=0;
  await assert.rejects(f.commit(c,{async unlink(file){deletes++;await fs.unlink(file);throw Error('Injected unlink reply loss');}}),/reply loss/);
  const status=await f.get(c);assert.equal(status.state,'purge-pending');assert.equal(status.removedFiles,1);
  const r=await f.commit(c,{async unlink(file){deletes++;await fs.unlink(file);}});assert.equal(r.state,'purged');assert.equal(deletes,s.inventory.files.length);
  const first=JSON.parse(await fs.readFile(path.join(f.archiveRoot,'maintenance',c.actionId,'file-0.json')));assert.equal(first.disposition,'absent-after-intent');
});
test('interruption after removing exact empty owner directory completes original final receipt without more deletes',async t=>{
  const f=await fixture(t),c=consent(await f.snapshot('purge'));
  await assert.rejects(f.commit(c,{async rmdir(folder){await fs.rmdir(folder);if(folder===f.target)throw Error('Injected final directory reply loss');}}),/reply loss/);
  assert.equal((await f.get(c)).state,'purged-awaiting-receipt');
  assert.equal((await f.commit(c,{unlink(){throw Error('Never repeat deletion');},rmdir(){throw Error('Never repeat directory removal');}})).state,'purged');
});
test('a surviving file changed after purge intent or any unknown added entry stops all further deletion',async t=>{
  for(const kind of ['changed','unknown','hardlink']){
    const f=await fixture(t),s=await f.snapshot('purge'),c=consent(s);
    await assert.rejects(f.commit(c,{unlink(){throw Error('Injected pre-delete pause');}}),/pause/);
    const file=path.join(f.target,s.inventory.files[0].path);
    if(kind==='changed')await fs.writeFile(file,'later edit');
    if(kind==='unknown')await fs.writeFile(path.join(f.target,'unknown-player-note.txt'),'later edit');
    if(kind==='hardlink')await fs.link(file,path.join(f.dataDir,'outside-hardlink'));
    const before=await tree(f.dataDir);await assert.rejects(f.commit(c));await assert.rejects(f.get(c));assert.deepEqual(await tree(f.dataDir),before);
  }
});
test('replacement of an already removed path is preserved rather than deleted during recovery',async t=>{
  const f=await fixture(t),s=await f.snapshot('purge'),c=consent(s);let seen=0;
  await assert.rejects(f.commit(c,{async unlink(file){if(seen++)throw Error('Pause after first durable removal');await fs.unlink(file);}}),/Pause/);
  const replaced=path.join(f.target,s.inventory.files[0].path);await fs.writeFile(replaced,'later player replacement');
  await assert.rejects(f.commit(c));assert.equal(await fs.readFile(replaced,'utf8'),'later player replacement');
});
test('redirected archive owner or maintenance directories cannot delete or move outside data',async t=>{
  for(const kind of ['owner','maintenance']){
    const f=await fixture(t),c=consent(await f.snapshot('purge')),outside=path.join(f.dataDir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');
    if(kind==='owner'){await fs.rename(f.target,path.join(outside,f.ownerId));await fs.symlink(path.join(outside,f.ownerId),f.target,process.platform==='win32'?'junction':'dir');}
    else await fs.symlink(outside,path.join(f.archiveRoot,'maintenance'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(f.commit(c));assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
  }
});
test('maintenance action/purpose cannot be rebound, cross-owner queried, or replaced by a new action after interruption',async t=>{
  const f=await fixture(t),s=await f.snapshot('restore'),c=consent(s);
  await assert.rejects(f.commit(c,{rename(){throw Error('Pending original restore');}}),/Pending/);
  await assert.rejects(f.commit(consent(s)),/cannot be rebound/);
  await assert.rejects(f.run('purge','get',{actionId:c.actionId}),/purpose missing/);
  await assert.rejects(f.run('restore','get',{actionId:c.actionId,ownerId:randomUUID()}),/not found/);
  await assert.rejects(f.snapshot('purge'),/same original maintenance/);assert.equal((await f.get(c)).state,'restore-pending');
});
test('restore/purge never changes original task, capsule, images, submissions or complete model receipt',async t=>{
  for(const purpose of ['restore','purge']){
    const f=await fixture(t,{submitted:true}),original=await tree(f.originalJob.root),index=await fs.readFile(path.join(f.dataDir,'reference-submissions',f.ownerId+'.json'));
    const r=await f.commit(consent(await f.snapshot(purpose)));assert.equal(r.state,purpose==='purge'?'purged':'restored');
    assert.deepEqual(await tree(f.originalJob.root),original);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'reference-submissions',f.ownerId+'.json')),index);
    const reference=await readJobReferenceInput({directory:f.originalJob.root,input:f.originalJob.descriptor.referenceInput,model:f.capability.id,runtimeHash:f.runtimeHash});
    assert.equal(reference.images.length,2);assert.equal(reference.preparation.preparationHash,f.preparation.preparationHash);
  }
});
test('newly active/unknown original SEND blocks maintenance before intent and after interrupted local operation',async t=>{
  for(const phase of ['before','after']){
    const f=await fixture(t,{submitted:true}),c=consent(await f.snapshot('restore'));
    if(phase==='after')await assert.rejects(f.commit(c,{rename(){throw Error('Pause');}}));
    f.originalJob.job.state='interrupted';await fs.writeFile(path.join(f.originalJob.root,'job.json'),JSON.stringify(f.originalJob.job));
    const before=await tree(f.dataDir);await assert.rejects(f.commit(c),/protected/);assert.deepEqual(await tree(f.dataDir),before);
  }
});
test('single worker lane covers archive restore and purge and rejects concurrent preparation without retry',async t=>{
  for(const purpose of ['restore','purge']){
    const f=await fixture(t),store=new ReferencePreparationStore({dataDir:f.dataDir});t.after(()=>store.close());
    const options={archiveActionId:f.a.actionId},first=store.operation(`archive-${purpose}-snapshot`,f.ownerId,options);
    await assert.rejects(store.operation('get',f.ownerId,{preparationHash:f.preparation.preparationHash}),e=>e.statusCode===429);
    const s=await first,c=consent(s),r=await store.operation(`archive-${purpose}-confirm`,f.ownerId,{...options,input:input(c)});
    assert.equal(r.state,purpose==='purge'?'purged':'restored');assert.deepEqual(await store.operation('archive-maintenance-get',f.ownerId,{...options,actionId:c.actionId,purpose}),r);
  }
});
