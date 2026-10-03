import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {replaceSyncedJournalFile} from '../../bridge/assembly-durability.mjs';

async function fixture(t){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-journal-replace-'))),file=path.join(dir,'call-1.json'),temp=file+'.owned.tmp';
  await fs.writeFile(file,'pending');await fs.writeFile(temp,'response');
  t.after(async()=>{assert.equal(await fs.realpath(dir),dir);assert.match(path.basename(dir),/^voxel-journal-replace-/);await fs.rm(dir,{recursive:true});});return {dir,file,temp};
}
for(const code of ['EPERM','EBUSY','EACCES'])test('bounded '+code+' rename retry replaces only the same completed local receipt',async t=>{
  const f=await fixture(t);let attempts=0;const waits=[];
  await replaceSyncedJournalFile(f.temp,f.file,{rename:async(source,target)=>{assert.equal(source,f.temp);assert.equal(target,f.file);if(++attempts<3)throw Object.assign(new Error('transient'),{code});await fs.rename(source,target);},wait:async ms=>waits.push(ms)});
  assert.equal(attempts,3);assert.deepEqual(waits,[25,50]);assert.equal(await fs.readFile(f.file,'utf8'),'response');await assert.rejects(fs.stat(f.temp),{code:'ENOENT'});
});
test('permanent lock failure preserves pending and complete temporary receipt',async t=>{
  const f=await fixture(t);let attempts=0,waits=0;
  await assert.rejects(replaceSyncedJournalFile(f.temp,f.file,{rename:async()=>{attempts++;throw Object.assign(new Error('locked'),{code:'EPERM'});},wait:async()=>{waits++;}}),{code:'EPERM'});
  assert.equal(attempts,8);assert.equal(waits,7);assert.equal(await fs.readFile(f.file,'utf8'),'pending');assert.equal(await fs.readFile(f.temp,'utf8'),'response');
});
test('disk errors, cross-directory targets and changed targets never enter a rename loop',async t=>{
  const f=await fixture(t);let attempts=0,waits=0;
  await assert.rejects(replaceSyncedJournalFile(f.temp,f.file,{rename:async()=>{attempts++;throw Object.assign(new Error('full'),{code:'ENOSPC'});},wait:async()=>{waits++;}}),{code:'ENOSPC'});
  assert.equal(attempts,1);assert.equal(waits,0);await assert.rejects(replaceSyncedJournalFile(f.temp,path.join(f.dir,'other','call-1.json')),/same-directory/);
  await fs.unlink(f.file);await fs.mkdir(f.file);
  await assert.rejects(replaceSyncedJournalFile(f.temp,f.file,{rename:async()=>{throw Object.assign(new Error('locked'),{code:'EPERM'});},wait:async()=>{waits++;}}),/target changed/);
  assert.equal(waits,0);assert.equal(await fs.readFile(f.temp,'utf8'),'response');
});
