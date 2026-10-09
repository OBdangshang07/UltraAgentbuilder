import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveBridgeDataRoot} from '../../bridge/data-root.mjs';

test('new explicit data directory gets a canonical spelling without changing its files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-root-')),requested=path.join(root,'中文 data'),canonical=await resolveBridgeDataRoot(requested);
  assert.equal(canonical,await fs.realpath(requested));await fs.writeFile(path.join(requested,'synthetic-evidence'),'original',{flag:'wx'});
  assert.equal(await resolveBridgeDataRoot(requested),canonical);assert.equal(await fs.readFile(path.join(canonical,'synthetic-evidence'),'utf8'),'original');
});
test('missing nested directory is created only under its explicitly requested root',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-root-'));const requested=path.join(root,'one','two','data');
  assert.equal(await resolveBridgeDataRoot(requested),await fs.realpath(requested));assert.deepEqual(await fs.readdir(root),['one']);assert.deepEqual(await fs.readdir(requested),[]);
});
test('existing regular file cannot become a data directory or be overwritten',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-root-')),requested=path.join(root,'not-directory');await fs.writeFile(requested,'preserved',{flag:'wx'});
  await assert.rejects(resolveBridgeDataRoot(requested),/link\/type/);assert.equal(await fs.readFile(requested,'utf8'),'preserved');
});
test('redirected data ancestor is rejected before creating files through it',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-root-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-outside-')),alias=path.join(root,'alias');
  await fs.symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(resolveBridgeDataRoot(path.join(alias,'data')),/link\/type/);assert.deepEqual(await fs.readdir(outside),[]);
});
test('existing final directory junction is not adopted as a store',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-root-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'uab-data-outside-')),alias=path.join(root,'data');
  await fs.writeFile(path.join(outside,'evidence'),'unchanged',{flag:'wx'});await fs.symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(resolveBridgeDataRoot(alias),/link\/type/);assert.deepEqual(await fs.readdir(outside),['evidence']);
});
test('missing or non-string directory is rejected before any path resolution',async()=>{
  for(const input of [undefined,null,'',42,{},[]])await assert.rejects(resolveBridgeDataRoot(input),/dataDir is required/);
});
