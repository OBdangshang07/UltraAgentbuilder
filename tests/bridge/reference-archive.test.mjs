import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../../src/generation/compiler.mjs';
import {referenceFixture,sendConsent} from './reference-generation-fixture.mjs';
import {referenceArchiveOperation as operation} from '../../bridge/reference-archive.mjs';
import {referencePreparationOperation} from '../../bridge/reference-preparation-worker.mjs';
import {ReferencePreparationStore} from '../../bridge/reference-preparation.mjs';
import {referenceGenerationOperation} from '../../bridge/reference-generation-worker.mjs';
import {openAssemblyJournal} from '../../bridge/assembly-durability.mjs';
import {readJobReferenceInput} from '../../bridge/reference-generation-binding.mjs';
import {referenceArchiveCapabilities} from '../../contracts/reference-archive.mjs';

const input=value=>Buffer.from(JSON.stringify(value));
function confirmation(snapshot,actionId=randomUUID()){
  return {format:'ReferenceDraftArchiveConfirmation',version:1,action:'archive-reference-draft',actionId,
    ownerId:snapshot.ownerId,snapshotHash:snapshot.snapshotHash,accepted:true};
}
async function fixture(t){
  const f=await referenceFixture(t,{images:2,version:2});await f.confirm();
  const run=(kind,options={},hooks)=>operation({dataDir:f.dataDir,ownerId:f.ownerId,operation:'archive-'+kind,...options},hooks);
  return {...f,run,draft:path.join(f.dataDir,'reference-drafts',f.ownerId),snapshot:()=>run('snapshot'),
    commit:(c,hooks)=>run('confirm',{input:input(c)},hooks),get:c=>run('get',{actionId:c.actionId})};
}
async function tree(root){
  const result=[];async function visit(relative){for(const name of (await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const next=relative?relative+'/'+name.name:name.name;
    if(name.isDirectory())await visit(next);else result.push({path:next,sha256:hash(await fs.readFile(path.join(root,next)))});
  }}await visit('');return result;
}
async function submitted(f,{state='failed',outcome='response'}={}){
  await fs.mkdir(path.join(f.dataDir,'jobs'));
  const submission={format:'ReferenceGenerationJobRequest',version:1,ownerId:f.ownerId,preparationHash:f.preparation.preparationHash,sendConfirmation:sendConsent(f.preparation)};
  const saved=await referenceGenerationOperation({dataDir:f.dataDir,operation:'submit',input:input(submission),runtimeHash:f.runtimeHash,capability:f.capability});
  const root=path.join(f.dataDir,'jobs',saved.jobId),journal=await openAssemblyJournal({directory:root,requestHash:saved.requestHash,policy:saved.policy,runtimeHash:saved.runtimeHash});
  const invoke=async(_p,_i,options)=>{
    if(outcome==='response')return {spec:{format:'SyntheticCompleteResponse'},usage:{totalTokens:0}};
    if(outcome==='pending')await options.onProviderBinding({version:1,provider:'codex',storage:'persistent-single-turn',threadId:'fixture-thread',turnId:'fixture-turn',model:f.capability.id,effort:'max',requestHash:'b'.repeat(64)});
    const error=Error('Injected original fixture failure');if(outcome==='known-error')error.diagnostic={reason:'not-submitted'};throw error;
  };
  try{await journal.invoke('Free original archive fixture',1,{outputSchema:{},stageName:'reference-analysis'},invoke);}catch{}
  const job={id:saved.jobId,key:f.ownerId,requestHash:saved.requestHash,preflight:saved.policy,state,recoveryEnabled:true,
    assemblyCallsReserved:1,recovery:{reservedCalls:1},referenceGeneration:{version:1,preparationHash:f.preparation.preparationHash,input:saved.referenceInput}};
  await fs.writeFile(path.join(root,'job.json'),JSON.stringify(job));return {saved,root,job};
}

test('archive capability v3 separates original read-only records, preserving move, independent restore/purge and placement',()=>{
  const c=referenceArchiveCapabilities();assert.equal(c.implemented,true);assert.equal(c.explicitExactConfirmation,true);
  assert.equal(c.version,3);assert.equal(c.originalRecordVersion,1);assert.equal(c.originalRecordReadOnly,true);assert.equal(c.freesActiveDraftQuota,true);assert.equal(c.permanentDeletionImplemented,true);assert.equal(c.restoreImplemented,true);
  assert.equal(c.jobOriginalsAndAuditRetained,true);assert.equal(c.restoreTransfersGenerationAuthority,false);
  assert.equal(c.unknownOutcomesProtected,true);assert.equal(c.additionalModelCalls,0);assert.equal(c.worldWrites,0);assert.equal(c.canAuthorizePlacement,false);
});
test('listing and exact snapshot are read-only, preserve bytes and reserve zero calls',async t=>{
  const f=await fixture(t),before=await tree(f.dataDir),listed=await f.run('list'),s=await f.snapshot();
  assert.equal(listed.drafts.length,1);assert.equal(listed.drafts[0].archiveAllowed,true);assert.equal(listed.drafts[0].snapshotHash,s.snapshotHash);
  assert.deepEqual(s.submissionProtection,{state:'unsubmitted'});const {snapshotHash,...content}=s;assert.equal(hash(content),snapshotHash);
  assert.equal(s.files.length,5);assert.deepEqual(await tree(f.dataDir),before);assert.equal(s.additionalModelCalls,0);
});
test('explicit archive releases only exact owner quota and preserves every byte and unrelated files',async t=>{
  const f=await fixture(t),s=await f.snapshot(),c=confirmation(s),draft=await tree(f.draft);
  const unrelated=path.join(f.dataDir,'formal-world-marker');await fs.writeFile(unrelated,'not in archive scope');
  const r=await f.commit(c);assert.equal(r.state,'archived');assert.equal(r.activeQuotaReleased,true);assert.equal(r.permanentlyDeleted,false);
  const {receiptHash,...content}=r;assert.equal(hash(content),receiptHash);
  await assert.rejects(fs.stat(f.draft),e=>e.code==='ENOENT');
  assert.deepEqual(await tree(path.join(f.dataDir,'reference-archives',c.actionId,f.ownerId)),draft);
  assert.equal(await fs.readFile(unrelated,'utf8'),'not in archive scope');assert.equal((await f.run('list')).drafts.length,0);
  assert.deepEqual(await f.get(c),r);assert.deepEqual(await f.commit(c),r);
  await assert.rejects(f.prepare(),/original archive action/);assert.equal(r.additionalModelCalls,0);assert.equal(r.worldWrites,0);
});
test('lost reply after original successful move recovers same receipt without a second rename',async t=>{
  const f=await fixture(t),c=confirmation(await f.snapshot());await f.commit(c);const before=await tree(f.dataDir);
  const r=await f.commit(c,{rename(){throw Error('A second move is forbidden');}});
  assert.equal(r.state,'archived');assert.deepEqual(await f.get(c),r);assert.deepEqual(await tree(f.dataDir),before);
});
test('interruption after atomic move before receipt queries and finalizes original action without another move',async t=>{
  const f=await fixture(t),c=confirmation(await f.snapshot());let moves=0;
  await assert.rejects(f.commit(c,{async rename(a,b){moves++;await fs.rename(a,b);throw Error('Injected post-move interruption');}}),/post-move interruption/);
  const before=await tree(f.dataDir),status=await f.get(c);assert.equal(status.state,'moved-awaiting-receipt');assert.equal(status.resumeSameAction,true);
  assert.deepEqual(await tree(f.dataDir),before,'GET must not create a recovery receipt');
  const r=await f.commit(c,{rename(){throw Error('Do not repeat ambiguous move');}});assert.equal(r.state,'archived');assert.equal(moves,1);
});
test('pre-move failure retains original intent/source and only same confirmed action can continue',async t=>{
  const f=await fixture(t),s=await f.snapshot(),c=confirmation(s),before=await tree(f.draft);
  await assert.rejects(f.commit(c,{rename(){throw Error('Injected pre-move failure');}}),/pre-move failure/);
  assert.equal((await f.get(c)).state,'pending');assert.deepEqual(await tree(f.draft),before);
  await assert.rejects(f.commit(confirmation(s)),/same original archive action/);
  await assert.rejects(f.prepare(),/original archive action/);
  assert.equal((await f.commit(c)).state,'archived');
});
test('changed snapshot and all unconfirmed/malformed requests fail before creating any archive intent',async t=>{
  const f=await fixture(t),s=await f.snapshot(),c=confirmation(s);
  for(const change of [{accepted:false},{ownerId:randomUUID()},{snapshotHash:'b'.repeat(64)},{action:'delete'},{path:'C:/private'},{actionId:'../owner'}])
    await assert.rejects(f.commit({...c,...change}));
  for(const bytes of [Buffer.from([255]),Buffer.alloc(0),Buffer.alloc(4097)])await assert.rejects(f.run('confirm',{input:bytes}));
  await assert.rejects(fs.stat(path.join(f.dataDir,'reference-archives')),e=>e.code==='ENOENT');
  f.request.generation.prompt='A changed exact generation';await f.prepare();
  await assert.rejects(f.commit(c),/stale/);await assert.rejects(fs.stat(path.join(f.dataDir,'reference-archives')),e=>e.code==='ENOENT');
});
test('action ID/owner cannot be rebound and conflicting source/target is never guessed or overwritten',async t=>{
  const f=await fixture(t),c=confirmation(await f.snapshot());await f.commit(c);
  await assert.rejects(f.run('get',{ownerId:randomUUID(),actionId:c.actionId}),/exact original|Exact original/);
  await assert.rejects(f.commit({...c,snapshotHash:'b'.repeat(64)}),/cannot be rebound/);
  await fs.mkdir(f.draft);await fs.writeFile(path.join(f.draft,'preserve.txt'),'later owner');
  await assert.rejects(f.get(c),/ambiguous/);await assert.rejects(f.commit(c),/ambiguous/);
  assert.equal(await fs.readFile(path.join(f.draft,'preserve.txt'),'utf8'),'later owner');
});
test('unknown files, corrupted pixels and rehashed policy semantics are rejected without cleanup',async t=>{
  for(const kind of ['unknown-root','unknown-set','pixel','policy']){
    const f=await fixture(t),p=f.preparation;
    if(kind==='unknown-root')await fs.writeFile(path.join(f.draft,'unknown.txt'),'preserve');
    if(kind==='unknown-set')await fs.writeFile(path.join(f.draft,'reference-sets',p.referenceSetHash,'unknown.txt'),'preserve');
    if(kind==='pixel')await fs.writeFile(path.join(f.draft,'reference-sets',p.referenceSetHash,'image-0.png'),Buffer.from([1,2,3]));
    if(kind==='policy'){
      const {preparationHash,...content}=structuredClone(p);content.policy.maximumCalls=999;const forgedHash=hash(content);
      const folder=path.join(f.draft,'preparations',forgedHash);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'preparation.json'),JSON.stringify({...content,preparationHash:forgedHash}));
    }
    const before=await tree(f.dataDir);await assert.rejects(f.snapshot());assert.equal((await f.run('list')).drafts[0].archiveAllowed,false);
    assert.deepEqual(await tree(f.dataDir),before);
  }
});
test('linked owner, hard-linked file and redirected archive parent cannot escape validated paths',async t=>{
  for(const kind of ['owner','hardlink','archive-parent']){
    const f=await fixture(t),c=confirmation(await f.snapshot()),outside=path.join(f.dataDir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');
    if(kind==='owner'){await fs.rename(f.draft,path.join(outside,f.ownerId));await fs.symlink(path.join(outside,f.ownerId),f.draft,process.platform==='win32'?'junction':'dir');}
    if(kind==='hardlink')await fs.link(path.join(f.draft,'reference-sets',f.preparation.referenceSetHash,'image-0.png'),path.join(outside,'original-hardlink.png'));
    if(kind==='archive-parent')await fs.symlink(outside,path.join(f.dataDir,'reference-archives'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(f.commit(c));assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
    assert.ok((await fs.readdir(outside)).every(n=>!n.endsWith('.json')));
  }
});
test('known terminal submitted owner archives while every original capsule/response remains unchanged and readable',async t=>{
  for(const outcome of ['response','known-error']){
    const f=await fixture(t),job=await submitted(f,{outcome}),before=await tree(job.root),s=await f.snapshot();
    assert.equal(s.submissionProtection.state,'known-terminal');assert.equal(s.submissionProtection.knownCalls,1);
    await f.commit(confirmation(s));assert.deepEqual(await tree(job.root),before);
    const r=await readJobReferenceInput({directory:job.root,input:job.saved.referenceInput,model:f.capability.id,runtimeHash:f.runtimeHash});
    assert.equal(r.preparation.preparationHash,f.preparation.preparationHash);assert.equal(r.images.length,2);
    assert.equal((await referenceGenerationOperation({dataDir:f.dataDir,operation:'recover',jobId:job.saved.jobId,runtimeHash:f.runtimeHash})).jobId,job.saved.jobId);
  }
});
test('active, interrupted, pending and uncertain error originals stay protected despite nominal terminal job states',async t=>{
  for(const options of [{state:'generating'},{state:'interrupted'},{state:'failed',outcome:'pending'},{state:'cancelled',outcome:'unknown-error'}]){
    const f=await fixture(t);await submitted(f,options);const before=await tree(f.dataDir);
    await assert.rejects(f.snapshot());assert.equal((await f.run('list')).drafts[0].archiveAllowed,false);
    assert.deepEqual(await tree(f.dataDir),before);await assert.rejects(fs.stat(path.join(f.dataDir,'reference-archives')),e=>e.code==='ENOENT');
  }
});
test('SEND intent missing publication/capsule and published capsule missing SEND intent are both protected',async t=>{
  for(const kind of ['job-missing','capsule-missing','intent-missing','reservation-mismatch']){
    const f=await fixture(t),j=await submitted(f);
    if(kind==='job-missing')await fs.rename(path.join(j.root,'job.json'),path.join(j.root,'retained-job.json'));
    if(kind==='capsule-missing')await fs.rename(path.join(j.root,'reference-recovery-request.json'),path.join(j.root,'retained-recovery.json'));
    if(kind==='intent-missing')await fs.rename(path.join(f.dataDir,'reference-submissions',f.ownerId+'.json'),path.join(f.dataDir,'retained-intent.json'));
    if(kind==='reservation-mismatch'){j.job.assemblyCallsReserved=2;await fs.writeFile(path.join(j.root,'job.json'),JSON.stringify(j.job));}
    const before=await tree(f.dataDir);await assert.rejects(f.snapshot());assert.deepEqual(await tree(f.dataDir),before);
  }
});
test('SEND protection changing after confirmation invalidates archive before creating an intent',async t=>{
  const f=await fixture(t),j=await submitted(f),c=confirmation(await f.snapshot());j.job.state='interrupted';
  await fs.writeFile(path.join(j.root,'job.json'),JSON.stringify(j.job));await assert.rejects(f.commit(c),/protected/);
  await assert.rejects(fs.stat(path.join(f.dataDir,'reference-archives')),e=>e.code==='ENOENT');assert.ok(await fs.stat(f.draft));
});
test('archive uses the same single off-thread preparation lane and cannot race upload or confirmation',async t=>{
  const f=await fixture(t),store=new ReferencePreparationStore({dataDir:f.dataDir});t.after(()=>store.close());
  const first=store.operation('archive-snapshot',f.ownerId);assert.equal(store.busy(),true);
  await assert.rejects(store.operation('get',f.ownerId,{preparationHash:f.preparation.preparationHash}),e=>e.statusCode===429);
  const s=await first,c=confirmation(s);assert.equal(store.busy(),false);
  const r=await store.operation('archive-confirm',f.ownerId,{input:input(c)});assert.equal(r.state,'archived');
  assert.deepEqual(await store.operation('archive-get',f.ownerId,{actionId:c.actionId}),r);
});
test('archiving a full preparation owner enables a new owner without changing submission/original quota records',async t=>{
  const f=await fixture(t);for(let i=1;i<8;i++){f.request.generation.prompt='Version '+i;await f.prepare();}
  f.request.generation.prompt='Ninth version';await assert.rejects(f.prepare(),/preparation quota/);
  const c=confirmation(await f.snapshot());await f.commit(c);const ownerId=randomUUID(),request=structuredClone(f.request);request.generation.key=ownerId;
  const p=await referencePreparationOperation({dataDir:f.dataDir,ownerId,operation:'prepare',runtimeHash:f.runtimeHash,capability:f.capability,input:input(request)});
  assert.equal(p.ownerId,ownerId);assert.deepEqual(await fs.readdir(path.join(f.dataDir,'reference-drafts')),[ownerId]);
  const list=await f.run('list');assert.equal(list.actions.length,1);assert.equal(list.drafts.length,1);
});
