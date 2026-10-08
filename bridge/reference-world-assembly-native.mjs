import path from 'node:path';
import fs from 'node:fs/promises';
import {exactKeys} from '../contracts/world-selection.mjs';
import {hash} from '../src/generation/compiler.mjs';
import {readReferenceWorldAssemblyJobRecord,jointAssemblyJobBytes} from './reference-world-assembly-job-data.mjs';
import {jointInvocationDirectory} from './reference-world-patch-invocation-data.mjs';
import {validateEvidenceRequest,acceptNativeEvidence} from './native-evidence.mjs';

// Only server-issued original render requests under the SAME full-task root.
// No external paths, images, URLs, world captures or renderer substitutions.
async function original(options) {
  const saved=await readReferenceWorldAssemblyJobRecord(options);
  if(!saved||!saved.dispatchClaim)throw Error('Original full-task render ownership required');
  return saved;
}
async function subject(options) {
  const saved=await original(options),id=options.evidenceId;
  if(!/^[a-f0-9]{64}$/.test(id??''))throw Error('Exact original native request ID required');
  const parent=path.join(saved.directory,'native-evidence'),root=path.join(parent,id);
  await jointInvocationDirectory(parent);await jointInvocationDirectory(root);
  const json=async(name,limit)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await jointAssemblyJobBytes(path.join(root,name),limit)));
  const request=validateEvidenceRequest(await json('request.json',1048576));
  if(request.requestHash!==id)throw Error('Original native request directory differs');
  const manifest=await json('manifest.json',1048576),{assetHash,...content}=manifest;
  if(assetHash!==request.assetHash||hash(content)!==assetHash||manifest.diagnosticOnly!==true
    ||manifest.scene?.sourceHash!==request.sourceHash||manifest.cellsHash!==request.cellsHash
    ||hash(manifest.dimensions)!==hash(request.dimensions))throw Error('Original native render subject changed');
  const cells=await jointAssemblyJobBytes(path.join(root,'cells.bin'),16777216);
  if(hash(cells)!==request.cellsHash||cells.length!==request.dimensions.width*request.dimensions.height*request.dimensions.length*2)
    throw Error('Original native cells changed');
  return {saved,root,request,manifest,cells};
}
export async function readReferenceWorldAssemblyNative(options) {
  exactKeys(options,['dataDir','id','expectedRequestHash','evidenceId','member'],'original full-task render member');
  if(!['request','manifest','cells'].includes(options.member))throw Error('Exact original native member required');
  const source=await subject(options);
  return options.member==='request'?source.request:options.member==='manifest'?source.manifest:
    {encoding:'base64',sha256:source.request.cellsHash,bytes:source.cells.length,data:source.cells.toString('base64')};
}
export async function uploadReferenceWorldAssemblyNative(options) {
  exactKeys(options,['dataDir','id','expectedRequestHash','evidenceId','upload'],'original full-task render upload');
  const source=await subject(options);
  for(const file of [...source.request.views.map((_,i)=>`view-${i}.png`),'evidence.json']) {
    const name=path.join(source.root,file);
    try{await fs.lstat(name);await jointAssemblyJobBytes(name,1048576);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const evidence=await acceptNativeEvidence(source.saved.directory,options.evidenceId,options.upload);
  // Validate existing immutable upload files too; hardlinks and growth cannot
  // become a native receipt merely because a client repeats the same upload.
  for(const file of [...evidence.views.map(v=>v.file),'evidence.json'])
    await jointAssemblyJobBytes(path.join(source.root,file),1048576);
  return {accepted:true,requestHash:options.evidenceId,evidenceHash:evidence.evidenceHash,
    worldCaptured:false,canAuthorizePlacement:false};
}
