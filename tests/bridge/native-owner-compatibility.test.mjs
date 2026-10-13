import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import * as bridge from '../../bridge/world-patch-owner-observation.mjs';
import {observeCimOwnerControl} from '../fixtures/windows-cim-owner-control.mjs';
import {hash} from '../../src/generation/compiler.mjs';

async function sourceLabel(label,operation){try{return await operation();}catch(error){error.message=label+': '+error.message;throw error;}}

test('native self facts exactly match independent legacy CIM facts without changing v1 precision', {skip:process.platform!=='win32'},async()=>{
  const native=await sourceLabel('production-native-query',()=>bridge.observeWindowsOwnerProcess(process.pid));
  const original=await sourceLabel('independent-legacy-CIM-control',()=>observeCimOwnerControl(process.pid));
  assert.deepEqual(native.process,original.process);assert.equal(native.machineHash,original.machineHash);assert.equal(native.bootUtc,original.bootUtc);
  assert.match(native.process.startedUtc,/\.\d{6}0Z$/);
});

test('a synthetic legacy v1 lock bound to actual independent CIM facts remains the same process under native inspection', {skip:process.platform!=='win32'},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-owner-compatibility-'));
  t.after(async()=>{assert.equal(await fs.realpath(directory),directory);assert.equal(path.dirname(directory),await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('native-owner-compatibility-'));await fs.rm(directory,{recursive:true,force:false});});
  const observation=await sourceLabel('independent-legacy-CIM-control',()=>observeCimOwnerControl(process.pid)),owner={pid:process.pid,id:randomUUID()};
  const file=path.join(directory,'_owner.json'),before=Buffer.from(JSON.stringify({value:owner,sha256:hash(owner)}));
  const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(before);await handle.sync();}finally{await handle.close();}
  const reference={format:'WorldPatchOwnerReference',version:1,directory,owner,ownerFileSha256:hash(before),observation};
  const observed=await sourceLabel('production-native-inspector',()=>bridge.inspectWorldPatchOwnerProcess({directory,reference,expectedReferenceHash:hash(reference)}));
  assert.equal(observed.state,'same-process');assert.equal(observed.exactOriginalProcessExitedAtObservation,false);
  assert.equal(observed.ownershipRecovered,false);assert.equal(observed.canAuthorizePlacement,false);
  assert.equal(observed.additionalModelCalls,0);assert.deepEqual(await fs.readFile(file),before);
});

test('native lookup handles an absent PID but rejects malformed IDs before spawning any query', {skip:process.platform!=='win32'},async()=>{
  const observed=await bridge.observeWindowsOwnerProcess(2147483647);assert.equal(observed.queriedPid,2147483647);assert.equal(observed.process,null);
  for(const pid of [null,1,-1,'2',2.5,NaN,0x100000000])await assert.rejects(bridge.observeWindowsOwnerProcess(pid),/Invalid Windows owner PID/);
});
