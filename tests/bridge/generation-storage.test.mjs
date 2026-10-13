import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assertCodexStorageReserve,generationStorageReserveBytes} from '../../bridge/generation-storage.mjs';

const base=path.resolve('synthetic-base'),home=path.join(base,'profile'),cwd=path.join(base,'job');
function fixture({env={},sqliteHome,inspectSqlite=true,space}={}){
  const reads=[];
  const options={env,home,base,sqliteHome,inspectSqlite,realpath:async target=>target,
    statfs:async (target,options)=>{reads.push(target);assert.deepEqual(options,{bigint:true});
      return space?.(target)??{bavail:generationStorageReserveBytes,bsize:1n};}};
  return {reads,options,check:()=>assertCodexStorageReserve(cwd,options)};
}
test('default and explicit original Codex roots are checked without account files or path disclosure',async()=>{
  const f=fixture(),checked=await f.check();assert.deepEqual(f.reads,[path.join(home,'.codex'),cwd,path.join(home,'.codex')]);
  assert.deepEqual(checked.map(r=>r.role),['provider','evidence','sqlite']);assert.ok(!JSON.stringify(checked).includes(home));
  const g=fixture({env:{CODEX_HOME:path.join(base,'original-state')}});await g.check();assert.equal(g.reads[0],path.join(base,'original-state'));
});
test('effective SQLite config wins over its environment override without mutating either',async()=>{
  const env={CODEX_HOME:path.join(base,'account'),CODEX_SQLITE_HOME:'unused-state'},before={...env},sqliteHome=path.join(base,'configured-sqlite');
  const f=fixture({env,sqliteHome});await f.check();assert.equal(f.reads.at(-1),sqliteHome);assert.deepEqual(env,before);
  const g=fixture({env});await g.check();assert.equal(g.reads.at(-1),path.join(base,'unused-state'));
});
test('initial check does not guess an effective SQLite config before config/read',async()=>{
  const f=fixture({inspectSqlite:false,sqliteHome:'unresolved',env:{CODEX_SQLITE_HOME:'possibly-overridden'}});
  assert.equal((await f.check()).length,2);assert.equal(f.reads.length,2);
});
for(const role of ['provider','evidence','sqlite'])test('insufficient '+role+' space stops rather than falling back to another disk',async()=>{
  const account=path.join(base,'account'),sqliteHome=path.join(base,'sqlite'),targets={provider:account,evidence:cwd,sqlite:sqliteHome};
  const f=fixture({env:{CODEX_HOME:account},sqliteHome,space:target=>({bsize:1n,bavail:target===targets[role]?generationStorageReserveBytes-1n:generationStorageReserveBytes})});
  await assert.rejects(f.check(),e=>e.code==='ENOSPC'&&/没有提交模型/.test(e.message)&&!e.message.includes(base));
  assert.equal(f.reads.length,['provider','evidence','sqlite'].indexOf(role)+1);
});
test('unavailable or malformed quota stays unknown with sanitized errors, not a low-space guess',async()=>{
  for(const failure of [Object.assign(Error('PRIVATE/account/token'),{code:'EACCES'}),Error('PRIVATE/account/token')]){
    const f=fixture();f.options.statfs=async()=>{throw failure;};
    await assert.rejects(f.check(),e=>/无法核验/.test(e.message)&&!e.message.includes('PRIVATE')&&!e.cause);
  }
  for(const value of [{bsize:0n,bavail:1n},{bsize:1n,bavail:-1n},{bsize:1,bavail:1024**3}]){
    const f=fixture({space:()=>value});await assert.rejects(f.check(),e=>e.code==='EIO'&&/无法核验/.test(e.message));
  }
});
test('unresolved relative effective config and invalid directories cannot silently choose another disk',async()=>{
  const f=fixture({sqliteHome:'relative-layer-state'});await assert.rejects(f.check(),e=>e.code==='EIO');assert.deepEqual(f.reads,[]);
  for(const bad of [undefined,'',{},'bad\0path'])await assert.rejects(assertCodexStorageReserve(bad,fixture().options),e=>e.code==='EIO');
});
test('canonical storage is probed on its actual target volume, not the alias parent',async()=>{
  const f=fixture({inspectSqlite:false}),physical=path.join(base,'different-volume');f.options.realpath=async()=>physical;
  await f.check();assert.deepEqual(f.reads,[physical,physical]);
});
test('callers cannot waive the fixed minimum reserve through an option',async()=>{
  const f=fixture({space:()=>({bsize:1n,bavail:0n})});f.options.minimumBytes=0n;
  await assert.rejects(f.check(),e=>e.code==='ENOSPC');
});
