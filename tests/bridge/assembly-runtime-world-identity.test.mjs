import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assemblyRuntimeIdentity} from '../../bridge/assembly-durability.mjs';

const directories=['bridge','contracts','src/core','src/design','src/generation','src/world','prompts'];
test('world-only edits, nested files and non-text runtime data change the new identity',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-runtime-world-'));
 for(const dir of directories)await fs.mkdir(path.join(directory,dir),{recursive:true});
 const root=pathToFileURL(directory+path.sep);
 const initial=await assemblyRuntimeIdentity(root);
 await fs.writeFile(path.join(directory,'src/world/capture.mjs'),'world-fixture-1');
 const first=await assemblyRuntimeIdentity(root);assert.notEqual(first,initial);
 await fs.writeFile(path.join(directory,'src/world/capture.mjs'),'world-fixture-2');
 const second=await assemblyRuntimeIdentity(root);assert.notEqual(second,first);
 await fs.mkdir(path.join(directory,'src/world/nested'));
 await fs.writeFile(path.join(directory,'src/world/nested/mask.bin'),Buffer.from([0,1,2]));
 const third=await assemblyRuntimeIdentity(root);assert.notEqual(third,second);
 await fs.mkdir(path.join(directory,'data'));
 await fs.writeFile(path.join(directory,'data/private.json'),'not-part-of-runtime');
 assert.equal(await assemblyRuntimeIdentity(root),third);
 await fs.writeFile(path.join(directory,'src/world/nested/mask.bin'),Buffer.from([0,2,2]));
 assert.notEqual(await assemblyRuntimeIdentity(root),third);
});
test('runtime symlinks are rejected rather than omitted from recovery identity',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-runtime-link-'));
 for(const dir of directories)await fs.mkdir(path.join(directory,dir),{recursive:true});
 await fs.mkdir(path.join(directory,'outside'));
 await fs.symlink(path.join(directory,'outside'),path.join(directory,'src/world/untracked'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(assemblyRuntimeIdentity(pathToFileURL(directory+path.sep)),/excludes links/);
});
