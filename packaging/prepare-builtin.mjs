import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {RELEASE_VERSION} from '../bridge/release.mjs';
import {worldPatchDesignReviewProtocol} from '../src/world/world-patch-design-input.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=process.argv[2];
if(!/^\d+\.\d+\.\d+-alpha$/.test(version??''))throw new Error('Explicit alpha version required');
if(version!==RELEASE_VERSION)throw new Error(`Mod/Bridge version mismatch: ${version} / ${RELEASE_VERSION}`);
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('The bundled release requires Windows x64 Node');
// Java reads this fixed resource while the Bridge derives its policy from
// code. Refuse to package mismatched rules/catalogs instead of producing a
// JAR whose client rejects the actual model input or ordinary ground facts.
const patchProtocol=JSON.parse(await fs.readFile(path.join(project,'contracts/world-patch-design-review-protocol.json'),'utf8'));
if(!isDeepStrictEqual(patchProtocol,worldPatchDesignReviewProtocol()))throw new Error('World patch review resource is stale; synchronize it with the authoritative rules and material catalog before packaging');
const output=path.join(project,'mod/build/generated/studio-bundle/voxelstudio-bundle');
await fs.mkdir(output,{recursive:true});
const entries=[];
async function copyFile(source,relative){
  if((await fs.lstat(source)).isSymbolicLink())throw new Error('Bundle links forbidden');
  const bytes=await fs.readFile(source),target=path.join(output,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
  entries.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
async function walk(relative){for(const entry of (await fs.readdir(path.join(project,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.isSymbolicLink())throw new Error('Bundle links forbidden');
  const next=relative+'/'+entry.name;
  if(entry.isDirectory())await walk(next);else await copyFile(path.join(project,next),next);
}}
for(const dir of ['bridge','contracts','prompts','src/core','src/generation','src/design','src/world','.agents/skills/voxel-studio'])await walk(dir);
await copyFile(process.execPath,'runtime/node.exe');
await copyFile(path.join(path.dirname(process.execPath),'LICENSE'),'runtime/NODE-LICENSE.txt');
const packageBytes=Buffer.from(JSON.stringify({name:'voxel-studio-companion',version,private:true,type:'module',engines:{node:'>=22.12'}},null,2));
await fs.writeFile(path.join(output,'package.json'),packageBytes);
entries.push({path:'package.json',bytes:packageBytes.length,sha256:createHash('sha256').update(packageBytes).digest('hex')});
entries.sort((a,b)=>a.path.localeCompare(b.path));
// Remove only stale generated files from this exact build output, never project inputs or game data.
const expected=new Set(entries.map(e=>e.path).concat('manifest.json'));
async function prune(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Unexpected generated bundle link');
  if(entry.isDirectory())await prune(full);else if(!expected.has(path.relative(output,full).replaceAll('\\','/')))await fs.unlink(full);
}}
await prune(output);
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({schemaVersion:1,version,platform:'windows-x64',node:process.version,files:entries},null,2));
console.log(`Prepared builtin companion: ${version}, ${entries.length} files, ${entries.reduce((n,e)=>n+e.bytes,0)} bytes`);
