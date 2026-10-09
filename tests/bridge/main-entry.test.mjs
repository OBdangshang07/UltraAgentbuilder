import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {isDirectEntrypoint} from '../../bridge/main-entry.mjs';

test('both logical spellings must resolve to the same physical entry file',async()=>{
  const argument=path.resolve('synthetic-logical/bridge/server.mjs'),module=pathToFileURL(path.resolve('synthetic-module/bridge/server.mjs'));const calls=[];
  assert.equal(await isDirectEntrypoint(argument,module,async file=>{calls.push(file);return '/synthetic-physical/bridge/server.mjs';}),true);
  assert.deepEqual(calls,[argument,path.resolve('synthetic-module/bridge/server.mjs')]);
});
test('same basename or matching logical strings cannot override different physical files',async()=>{
  const file=path.resolve('synthetic/bridge/server.mjs');let index=0;
  assert.equal(await isDirectEntrypoint(file,pathToFileURL(file),async()=>'/different-'+index+++'/server.mjs'),false);
});
test('an imported module without an entry argument performs no filesystem lookup',async()=>{
  for(const argument of [undefined,null,'',42])assert.equal(await isDirectEntrypoint(argument,import.meta.url,()=>assert.fail('Imported helper must not start or resolve a CLI')),false);
});
test('missing entry or missing module fails closed and never falls back to path text',async()=>{
  const file=path.resolve('synthetic/bridge/server.mjs');
  for(const failure of [0,1]){let index=0;assert.equal(await isDirectEntrypoint(file,pathToFileURL(file),async()=>{if(index++===failure)throw Object.assign(Error('synthetic missing'),{code:'ENOENT'});return '/physical/server.mjs';}),false);}
});
test('invalid or non-file module URL cannot dispatch or resolve any entry file',async()=>{
  for(const url of ['https://example.invalid/server.mjs','not a URL','file:///invalid%2Fseparator'])assert.equal(await isDirectEntrypoint('server.mjs',url,()=>assert.fail('Invalid URL must not resolve a CLI')),false);
});
test('actual independent files remain distinct and exact own file is accepted',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uab-main-entry-'));const file=path.join(root,'server.mjs'),other=path.join(root,'other-server.mjs');
  await fs.writeFile(file,'// synthetic only',{flag:'wx'});await fs.writeFile(other,'// synthetic only',{flag:'wx'});
  assert.equal(await isDirectEntrypoint(file,pathToFileURL(file)),true);assert.equal(await isDirectEntrypoint(other,pathToFileURL(file)),false);
});
test('normal server uses physical entry identity without enabling complete joint SEND',async()=>{
  const source=await fs.readFile(new URL('../../bridge/server.mjs',import.meta.url),'utf8');
  assert.match(source,/if \(await isDirectEntrypoint\(process\.argv\[1\],import\.meta\.url\)\)/);
  const cli=source.slice(source.indexOf('if (await isDirectEntrypoint'));
  assert.doesNotMatch(cli,/referenceWorldAssemblySending\s*:\s*true|providerRetries|resume\(/);
});
