import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';

/** Freeze only distributable source, never credentials, jobs or worlds. */
export async function freezeSceneRuntime(project,destination){
 const files=[];
 async function walk(dir){for(const e of await fs.readdir(path.join(project,dir),{withFileTypes:true})){
  if(e.isSymbolicLink())throw new Error('Runtime snapshot excludes links');
  const relative=dir+'/'+e.name;if(e.isDirectory())await walk(relative);else files.push({path:relative,bytes:await fs.readFile(path.join(project,relative))});
 }}
 for(const dir of ['bridge','contracts','prompts','src/core','src/generation','src/design','src/world'])await walk(dir);
 files.sort((a,b)=>a.path.localeCompare(b.path));const manifest=files.map(f=>({path:f.path,hash:hash(f.bytes)})),runtimeHash=hash(manifest),runtime=path.join(destination,runtimeHash);
 await fs.mkdir(runtime,{recursive:true});
 for(const f of files){const target=path.join(runtime,f.path);await fs.mkdir(path.dirname(target),{recursive:true});try{await fs.writeFile(target,f.bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||hash(await fs.readFile(target))!==hash(f.bytes))throw e;}}
 const data=JSON.stringify({hash:runtimeHash,files:manifest},null,2);
 try{await fs.writeFile(path.join(runtime,'snapshot.json'),data,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await fs.readFile(path.join(runtime,'snapshot.json'),'utf8')!==data)throw e;}
 return {runtime,runtimeHash};
}
