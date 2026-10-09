import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {builtinRuntimeIdentity} from '../../bridge/builtin-runtime-identity.mjs';
import {RELEASE_VERSION} from '../../bridge/release.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(suffix = '') {
  const parent = path.join(project, 'build/builtin-identity-tests'); await fs.mkdir(parent, {recursive:true});
  assert.equal(await fs.realpath(parent), parent);
  const root = await fs.mkdtemp(path.join(parent, 'original-'));
  const files = new Map([
    ['runtime/node.exe', Buffer.from('synthetic-node')],
    ['bridge/server.mjs', Buffer.from('synthetic-server' + suffix)],
    ['bridge/builtin-runtime-identity.mjs', Buffer.from('synthetic-module')],
    ['package.json', Buffer.from('{}')],
    ['.agents/skills/voxel-studio/SKILL.md', Buffer.from('synthetic-skill')]
  ]);
  for (const [name, bytes] of files) { const full=path.join(root,name); await fs.mkdir(path.dirname(full),{recursive:true}); await fs.writeFile(full,bytes,{flag:'wx'}); }
  const metadata = {schemaVersion:1,version:RELEASE_VERSION,platform:'windows-x64',files:[...files].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)}))};
  const metadataFile=path.join(root,'bundle-manifest.json'); await fs.writeFile(metadataFile,JSON.stringify(metadata),{flag:'wx'});
  return {root,files,metadata,metadataFile,node:path.join(root,'runtime/node.exe')};
}
const replaceManifest = f => fs.writeFile(f.metadataFile,JSON.stringify(f.metadata));

test('source-only absence is explicit null; unrelated data metadata cannot supply an identity', async()=>{
  const f=await fixture(); const source=path.join(f.root,'source-only'); await fs.mkdir(path.join(source,'data'),{recursive:true});
  await fs.writeFile(path.join(source,'data/bundle-manifest.json'),await fs.readFile(f.metadataFile),{flag:'wx'});
  assert.equal(await builtinRuntimeIdentity(source),null);
});
test('exact identity hashes original metadata bytes and is frozen',async()=>{
  const f=await fixture(), result=await builtinRuntimeIdentity(f.root,f.node);
  assert.deepEqual(result,{manifestSha256:sha(await fs.readFile(f.metadataFile))}); assert.ok(Object.isFrozen(result));
  assert.throws(()=>{result.manifestSha256='changed';});
});
test('same version different bundles retain distinct identities and original files',async()=>{
  const a=await fixture('-a'),b=await fixture('-b');
  assert.equal(a.metadata.version,b.metadata.version);
  assert.notEqual((await builtinRuntimeIdentity(a.root,a.node)).manifestSha256,(await builtinRuntimeIdentity(b.root,b.node)).manifestSha256);
  assert.deepEqual(await fs.readFile(path.join(a.root,'bridge/server.mjs')),a.files.get('bridge/server.mjs'));
});
test('an already-captured identity never changes when later metadata changes',async()=>{
  const f=await fixture(),original=await builtinRuntimeIdentity(f.root,f.node);
  await fs.appendFile(f.metadataFile,'\n'); const next=await builtinRuntimeIdentity(f.root,f.node);
  assert.notEqual(original.manifestSha256,next.manifestSha256);
});
test('present malformed metadata cannot become external/source mode',async()=>{
  const f=await fixture(); await fs.writeFile(f.metadataFile,'not-json'); await assert.rejects(builtinRuntimeIdentity(f.root,f.node));
});
test('wrong version and platform are rejected, not auto-repaired',async()=>{
  for(const [field,value] of [['version','0.4.9-alpha'],['platform','linux-x64']]){
    const f=await fixture(); f.metadata[field]=value; await replaceManifest(f); await assert.rejects(builtinRuntimeIdentity(f.root,f.node));
  }
});
test('missing a required member or duplicate case cannot claim builtin identity',async()=>{
  for(const kind of ['missing','duplicate']){
    const f=await fixture(); if(kind==='missing')f.metadata.files=f.metadata.files.filter(e=>e.path!=='bridge/builtin-runtime-identity.mjs');
    else f.metadata.files.push({...f.metadata.files[0],path:'RUNTIME/NODE.EXE'});
    await replaceManifest(f); await assert.rejects(builtinRuntimeIdentity(f.root,f.node));
  }
});
test('escaped and absolute manifest paths are rejected before outside reads',async()=>{
  for(const invalid of ['../outside','/outside','C:/outside','bridge/../outside','bridge\\outside']){
    const f=await fixture(); f.metadata.files.push({path:invalid,bytes:0,sha256:sha(Buffer.alloc(0))}); await replaceManifest(f);
    await assert.rejects(builtinRuntimeIdentity(f.root,f.node));
  }
});
test('bounded metadata and member quotas fail without allocation proportional to claimed size',async()=>{
  const a=await fixture(); await fs.writeFile(a.metadataFile,Buffer.alloc(1024*1024+1)); await assert.rejects(builtinRuntimeIdentity(a.root,a.node));
  const b=await fixture(); b.metadata.files[0].bytes=128*1024*1024+1; await replaceManifest(b); await assert.rejects(builtinRuntimeIdentity(b.root,b.node));
});
test('same-size corruption and missing members are rejected',async()=>{
  const a=await fixture(); await fs.writeFile(path.join(a.root,'bridge/server.mjs'),Buffer.alloc(a.files.get('bridge/server.mjs').length));
  await assert.rejects(builtinRuntimeIdentity(a.root,a.node));
  const b=await fixture(); await fs.rename(path.join(b.root,'bridge/server.mjs'),path.join(b.root,'bridge/server-retained.mjs'));
  await assert.rejects(builtinRuntimeIdentity(b.root,b.node));
});
test('using another executable cannot masquerade as packaged Node',async()=>{
  const f=await fixture(); await assert.rejects(builtinRuntimeIdentity(f.root,process.execPath));
});
test('hardlinked manifest and member are rejected without altering the originals',async()=>{
  const a=await fixture(); await fs.link(a.metadataFile,path.join(a.root,'retained-metadata-link'));
  await assert.rejects(builtinRuntimeIdentity(a.root,a.node));
  const b=await fixture(); await fs.link(path.join(b.root,'bridge/server.mjs'),path.join(b.root,'retained-server-link'));
  await assert.rejects(builtinRuntimeIdentity(b.root,b.node)); assert.deepEqual(await fs.readFile(path.join(b.root,'retained-server-link')),b.files.get('bridge/server.mjs'));
});
test('a non-link Windows drive-case alias retains exact original build identity',async t=>{
  if(process.platform!=='win32'){t.skip('Windows canonical path alias');return;}
  const f=await fixture(), alias=f.root.replace(/^([A-Z]):/,(_,drive)=>drive.toLowerCase()+':');
  assert.notEqual(alias,f.root);assert.equal((await fs.lstat(alias)).isSymbolicLink(),false);
  assert.equal(await fs.realpath(alias),f.root);
  assert.deepEqual(await builtinRuntimeIdentity(alias,path.join(alias,'runtime/node.exe')),{manifestSha256:sha(await fs.readFile(f.metadataFile))});
});
test('canonical root resolution does not turn a real directory junction into an approved bundle',async t=>{
  if(process.platform!=='win32'){t.skip('Windows directory junction');return;}
  const f=await fixture(), alias=path.join(f.root,'synthetic-root-junction');await fs.symlink(f.root,alias,'junction');
  assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);
  await assert.rejects(builtinRuntimeIdentity(alias,path.join(alias,'runtime/node.exe')));
  assert.deepEqual(await fs.readFile(f.metadataFile),Buffer.from(JSON.stringify(f.metadata)));
});
