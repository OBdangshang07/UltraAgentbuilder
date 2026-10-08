import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('fresh synthetic checkout without locked NBT reader fails BEFORE TEMP creation, test launch or any model work',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'voxel-test-preflight-'))),scripts=path.join(root,'scripts');
  t.after(async()=>{assert.equal(await fs.realpath(root),root);assert.equal(path.dirname(root),await fs.realpath(os.tmpdir()));await fs.rm(root,{recursive:true,force:false});});
  await fs.mkdir(scripts);const file=path.join(scripts,'studio-tests.mjs');
  await fs.copyFile(new URL('../../scripts/studio-tests.mjs',import.meta.url),file);
  // The workspace-local TEMP may have an ancestor with installed packages.
  // This synthetic child-only loader hides exactly the NBT reader, leaving
  // real module resolution and the copied production entry unchanged.
  const loader=path.join(root,'fixture-missing-nbt-loader.mjs');
  await fs.writeFile(loader,`export async function resolve(specifier,context,nextResolve) {
    if(specifier==='prismarine-nbt') {
      const error=new Error('Synthetic fixture intentionally hides the locked NBT reader');
      error.code='ERR_MODULE_NOT_FOUND';throw error;
    }
    return nextResolve(specifier,context);
  }\n`,{flag:'wx'});
  const child=spawn(process.execPath,['--experimental-loader',pathToFileURL(loader).href,file],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,1);assert.match(stderr,/Studio test dependencies unavailable: run npm ci --ignore-scripts/);
  assert.doesNotMatch(stdout,/Isolated test TEMP|TAP version|Subtest/);
  assert.deepEqual((await fs.readdir(root)).sort(),['fixture-missing-nbt-loader.mjs','scripts']);
  assert.deepEqual(await fs.readdir(scripts),['studio-tests.mjs']);
});
