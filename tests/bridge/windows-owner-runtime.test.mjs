import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ownerRuntimeSource,resolveWindowsOwnerRuntime,readWindowsOwnerRuntime,readOwnerRuntimeBytes,WINDOWS_OWNER_HELPER_FILES} from '../../bridge/windows-owner-runtime.mjs';
import {buildWindowsOwnerHelper} from '../../packaging/build-windows-owner-helper.mjs';
import {collectWindowsOwnerQuery} from '../../bridge/windows-owner-query.mjs';
import {observeWindowsOwnerProcess,validateWindowsOwnerObservation} from '../../bridge/world-patch-owner-observation.mjs';
import {observeCimOwnerControl} from '../fixtures/windows-cim-owner-control.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const realSource=await ownerRuntimeSource();
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owner-runtime-'));
 t.after(async()=>{assert.equal(await fs.realpath(root),root);assert.equal(path.dirname(root),await fs.realpath(os.tmpdir()));
  assert.match(path.basename(root),/^owner-runtime-/);await fs.rm(root,{recursive:true,force:false});});
 await fs.mkdir(path.join(root,'bridge'));await fs.writeFile(path.join(root,'bridge/windows-owner-observation.cs'),realSource.bytes);
 return root;
}
async function fakeRuntime(root,{bundled=false}={}){
 const directory=bundled?path.join(root,'runtime'):path.join(root,'build/windows-owner-helpers',realSource.sourceHash);
 await fs.mkdir(directory,{recursive:true});const bytes=Buffer.from('synthetic nonexecutable data, NEVER spawned');
 const manifest={format:'WindowsOwnerHelperBuild',version:1,platform:'windows-x64-netfx4',sourceHash:realSource.sourceHash,helperHash:sha(bytes),helperBytes:bytes.length,compilerHash:'b'.repeat(64)};
 const executable=path.join(directory,WINDOWS_OWNER_HELPER_FILES.executable),file=path.join(directory,WINDOWS_OWNER_HELPER_FILES.manifest);
 await fs.writeFile(executable,bytes);await fs.writeFile(file,JSON.stringify(manifest));return {directory,manifest,bytes,executable,file};
}
test('unprepared source may choose legacy BEFORE dispatch; packaged or partial runtimes never fall back',async t=>{
 const root=await fixture(t);assert.equal(await resolveWindowsOwnerRuntime({project:root}),null);
 for(const name of ['bundle-manifest.json','manifest.json']){
  await fs.writeFile(path.join(root,name),'{}');await assert.rejects(resolveWindowsOwnerRuntime({project:root}));await fs.unlink(path.join(root,name));
 }
 const partial=path.join(root,'build/windows-owner-helpers',realSource.sourceHash);await fs.mkdir(partial,{recursive:true});
 await assert.rejects(resolveWindowsOwnerRuntime({project:root}));assert.deepEqual(await fs.readdir(partial),[]);
 if(process.platform==='win32'&&process.arch==='x64')await assert.rejects(buildWindowsOwnerHelper({project:root}));
 assert.deepEqual(await fs.readdir(partial),[],'Unknown cache is neither rebuilt nor repaired');
});
test('exact bundle takes precedence over an unrelated developer cache without spawning either synthetic file',async t=>{
 const root=await fixture(t),development=await fakeRuntime(root),bundled=await fakeRuntime(root,{bundled:true});
 const chosen=await resolveWindowsOwnerRuntime({project:root});assert.equal(chosen.kind,'bundled');assert.equal(chosen.executable,bundled.executable);
 assert.deepEqual(chosen.manifest,bundled.manifest);assert.notEqual(chosen.executable,development.executable);
 await fs.unlink(bundled.file);await assert.rejects(resolveWindowsOwnerRuntime({project:root}));
 assert.deepEqual(await fs.readFile(development.executable),development.bytes);
});
test('tampered binary, source, helper metadata, extra authority and hardlinks are rejected without repair',async t=>{
 const root=await fixture(t),f=await fakeRuntime(root),sourceFile=path.join(root,'bridge/windows-owner-observation.cs');
 for(const change of [m=>delete m.helperHash,m=>m.sourceHash='c'.repeat(64),m=>m.helperBytes++,m=>m.platform='other',
  m=>m.version=2,m=>m.compilerHash='not-a-hash',m=>m.canAuthorizePlacement=true,m=>m.helperBytes=4*1024*1024+1]){
  const bad=structuredClone(f.manifest);change(bad);await fs.writeFile(f.file,JSON.stringify(bad));await assert.rejects(resolveWindowsOwnerRuntime({project:root}));
 }
 await fs.writeFile(f.file,JSON.stringify(f.manifest));await fs.writeFile(f.executable,Buffer.from('tampered'));await assert.rejects(resolveWindowsOwnerRuntime({project:root}));
 await fs.writeFile(f.executable,f.bytes);await fs.writeFile(sourceFile,Buffer.from('changed source'));
 assert.equal(await resolveWindowsOwnerRuntime({project:root}),null,'A new unprepared source has a different cache identity');
 await fs.writeFile(sourceFile,realSource.bytes);await fs.link(f.executable,path.join(root,'same-file-link'));
 await assert.rejects(resolveWindowsOwnerRuntime({project:root}),/Invalid Windows owner runtime file/);
 assert.deepEqual(await fs.readFile(f.executable),f.bytes);
});
test('a packaged source/binary mismatch cannot switch to an unprepared legacy query',async t=>{
 const root=await fixture(t),f=await fakeRuntime(root,{bundled:true});
 await fs.writeFile(path.join(root,'bridge/windows-owner-observation.cs'),'changed source');
 await assert.rejects(resolveWindowsOwnerRuntime({project:root}),/Invalid Windows owner runtime manifest/);
 assert.deepEqual(await fs.readFile(f.executable),f.bytes);
});
test('runtime reads retain bounded single-link exact files and source provenance',async t=>{
 const root=await fixture(t),f=await fakeRuntime(root);const source=await ownerRuntimeSource(root);
 assert.equal(source.sourceHash,realSource.sourceHash);assert.deepEqual(source.bytes,realSource.bytes);
 await assert.rejects(readOwnerRuntimeBytes(f.executable,1),/Invalid Windows owner runtime file/);
 const runtime=await readWindowsOwnerRuntime(f.directory,source.sourceHash);assert.equal(runtime.executable,f.executable);
 await fs.writeFile(f.file,Buffer.alloc(4097));await assert.rejects(readWindowsOwnerRuntime(f.directory,source.sourceHash));
});
test('compiled helper preserves live/absent facts exactly against production and independent legacy CIM', {skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
 const prepared=await buildWindowsOwnerHelper(),before=await fs.readFile(prepared.manifestFile);
 assert.equal(prepared.manifest.sourceHash,realSource.sourceHash);
 const resolved=await resolveWindowsOwnerRuntime();assert.ok(resolved);assert.equal(resolved.executable,prepared.executable);
 const native=await observeWindowsOwnerProcess(process.pid),control=await observeCimOwnerControl(process.pid);
 assert.deepEqual(native.process,control.process);assert.equal(native.machineHash,control.machineHash);assert.equal(native.bootUtc,control.bootUtc);
 assert.match(native.process.startedUtc,/\.\d{6}0Z$/);assert.deepEqual(validateWindowsOwnerObservation(native),native);
 const absent=await observeWindowsOwnerProcess(2147483647);assert.equal(absent.process,null);
 const reused=await buildWindowsOwnerHelper();assert.equal(reused.executable,prepared.executable);assert.deepEqual(await fs.readFile(prepared.manifestFile),before);
});
test('actual compiled helper rejects malformed arguments with a closed failure, not an alternate query', {skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
 const prepared=await buildWindowsOwnerHelper();
 for(const args of [[],['0'],['1'],['-1'],['not-a-pid'],['4294967295']]){
  const helper=spawn(prepared.executable,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  await assert.rejects(collectWindowsOwnerQuery(helper),error=>error.code==='WINDOWS_OWNER_QUERY_FAILED'&&error.observationDiagnostic.helperClosed===true
   &&error.observationDiagnostic.helperExitCode===2&&error.observationDiagnostic.ownershipRecovered===false&&error.observationDiagnostic.canAuthorizePlacement===false);
  assert.equal(helper.exitCode,2);assert.equal(helper.signalCode,null);
 }
});
test('source/build/test wiring keeps the one-query contract, fixed deadlines, both boot reads and safe output',async()=>{
 const product=await fs.readFile(new URL('../../bridge/world-patch-owner-observation.mjs',import.meta.url),'utf8');
 const observation=product.slice(product.indexOf('export async function observeWindowsOwnerProcess'),product.indexOf('async function originalLock'));
 assert.equal((observation.match(/\bspawn\(/g)??[]).length,1);assert.match(observation,/await resolveWindowsOwnerRuntime\(\)/);
 assert.match(observation,/const args = native \? \[String\(processId\)\]/);assert.match(observation,/await collectWindowsOwnerQuery\(child\)/);
 assert.match(observation,/hash\(after\.manifest\) !== hash\(native\.manifest\)/);assert.doesNotMatch(observation,/catch[^\n]*PowerShell|buildWindowsOwnerHelper|while\s*\(/);
 const native=realSource.bytes.toString('utf8');assert.match(native,/var before = Boot\(\)/);assert.match(native,/var after = Boot\(\)/);
 for(const snippet of ['started.Ticks - started.Ticks % 10','StringComparison.Ordinal','process.HasExited','Path.GetFullPath(executable).ToLowerInvariant()','catch { return 3; }'])assert.ok(native.includes(snippet));
 assert.doesNotMatch(native,/Process\.Start|Kill\(|Environment\.|RegistryKey\.Create|WriteAll|File\.Write|Http|WebClient|Console\.Error\.WriteLine\([^\n]*Exception/);
 const build=await fs.readFile(new URL('../../packaging/prepare-builtin.mjs',import.meta.url),'utf8');
 assert.match(build,/buildWindowsOwnerHelper\(\{project\}\)/);assert.match(build,/runtime\/windows-owner-helper\.exe/);assert.match(build,/runtime\/windows-owner-helper\.json/);
 const runner=await fs.readFile(new URL('../../scripts/studio-tests.mjs',import.meta.url),'utf8');assert.ok(runner.indexOf('await buildWindowsOwnerHelper')<runner.indexOf("spawn(process.execPath,['--test'"));
});
