import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {readAssemblyBaseline} from '../src/design/assembly-scope.mjs';
import {representativeFloorCameras} from '../src/design/representative-floor-cameras.mjs';
import {representativeEvidenceEnabled} from '../contracts/assembly-evidence-policy.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';

async function savedSubject(directory,scene,assetHash,savedScene){
 if(await fs.realpath(directory)!==directory)throw Error('Representative bundle links forbidden');
 for(const [name,limit] of [['manifest.json',1048576],['design-sources.json',16777216],['cells.bin',16777216],['source-owners.bin',16777216]])
  await safeEvidenceFile(directory,name,limit);
 const saved=JSON.parse(savedScene.toString('utf8'));
 if(hash(saved)!==hash(scene))throw Error('Representative scene differs from saved native bundle');
 return readAssemblyBaseline(directory,assetHash);
}
/** One immutable, job-relative basis. Later edits reuse its cameras without
 * pretending its original geometry is the current building. No model/write. */
export async function createAssemblyCameraBasis({directory,bundleDirectory,scene,assetHash,tier,representatives}){
 if(!representativeEvidenceEnabled(tier))throw Error('Representative camera policy was not selected');
 directory=path.resolve(directory);bundleDirectory=path.resolve(bundleDirectory);
 if(await fs.realpath(directory)!==directory)throw Error('Representative job links forbidden');
 const originalBundle=path.relative(directory,bundleDirectory).replaceAll('\\','/');
 if(!originalBundle||path.isAbsolute(originalBundle)||originalBundle.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Representative bundle must belong to this exact job');
 // Checkpoints save the exact source beside diagnostic/, not inside that
 // bundle. Derive its one authoritative path; do not accept a caller substitute.
 const originalSceneFile=path.relative(directory,path.join(path.dirname(bundleDirectory),'scene.json')).replaceAll('\\','/');
 const sceneBytes=await safeEvidenceFile(directory,originalSceneFile,1048576);
 const actual=await savedSubject(bundleDirectory,scene,assetHash,sceneBytes);
 const basis=calculateBasis(scene,assetHash,tier,actual,representatives);
 // Durable replay builds another local branch. Keep the FIRST saved subject
 // as an immutable exact-byte copy at a deterministic job-owned identity;
 // branch path changes cannot change already-dispatched model inputs.
 const parent=path.join(directory,'assembly-camera-bases'),root=path.dirname(path.join(directory,basis.bundle)),diagnostic=path.join(directory,basis.bundle);
 for(const folder of [parent,root,diagnostic]){
  try{await fs.mkdir(folder);}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(folder)!==folder)throw Error('Camera basis store links forbidden');
 }
 await immutable(path.join(root,'scene.json'),sceneBytes);
 for(const name of ['manifest.json','cells.bin','source-owners.bin','design-sources.json'])
  await immutable(path.join(diagnostic,name),await safeEvidenceFile(bundleDirectory,name,16777216));
 // Independently re-read the exact copied subject before committing a receipt.
 const copied=await savedSubject(diagnostic,scene,assetHash,await safeEvidenceFile(directory,basis.sceneFile,1048576));
 if(hash(calculateBasis(scene,assetHash,tier,copied,representatives))!==hash(basis))throw Error('Camera subject changed during immutable copy');
 await immutable(path.join(root,'basis.json'),Buffer.from(JSON.stringify(basis)));
 return basis;
}
async function immutable(file,bytes){
 try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==bytes.length||!bytes.equals(await fs.readFile(file)))throw Error('Immutable camera subject conflict');}
}
function calculateBasis(scene,assetHash,tier,actual,representatives){
 const sourceHash=hash(scene),representativesHash=hash(representatives);
 const subject=hash({version:1,policy:tier.cameraEvidence,sourceHash,assetHash,representativesHash});
 const root='assembly-camera-bases/'+subject;
 const data={version:1,policy:structuredClone(tier.cameraEvidence),bundle:root+'/diagnostic',sceneFile:root+'/scene.json',sourceHash,assetHash,
  cellsHash:actual.manifest.cellsHash,ownersHash:actual.manifest.scene.ownersHash,provenanceHash:actual.manifest.scene.sourcesHash,
  representatives:structuredClone(representatives),representativesHash,...representativeFloorCameras(scene,tier.id,actual,representatives),
  fixedAcrossRevisions:true,canAuthorizePlacement:false,aestheticQualityVerified:false};
 return {...data,basisHash:hash(data)};
}
/** Independent read-only reconstruction from ORIGINAL saved cells, owners and
 * staged responsibilities. Re-hashing invented metadata alone cannot pass. */
export async function verifyAssemblyCameraBasis({directory,basis,tier,representatives,views}){
 if(!basis||!representativeEvidenceEnabled(tier))throw Error('Missing selected representative camera basis');
 const {basisHash,...data}=basis;
 if(hash(data)!==basisHash||hash(basis.policy)!==hash(tier.cameraEvidence)||
  hash(basis.representatives)!==hash(representatives)||basis.representativesHash!==hash(representatives))throw Error('Representative camera basis identity/responsibilities changed');
 // safeEvidenceFile traverses every job-relative segment and rejects links.
 const scene=JSON.parse((await safeEvidenceFile(directory,basis.sceneFile,1048576)).toString('utf8'));
 const compiled=await savedSubject(path.resolve(directory,basis.bundle),scene,basis.assetHash,
  await safeEvidenceFile(directory,basis.sceneFile,1048576));
 const actual=calculateBasis(scene,basis.assetHash,tier,compiled,representatives);
 const stored=JSON.parse((await safeEvidenceFile(directory,path.posix.dirname(basis.sceneFile)+'/basis.json',1048576)).toString('utf8'));
 if(hash(actual)!==hash(basis)||hash(stored)!==hash(basis))throw Error('Representative camera basis differs from original saved geometry');
 if(!Array.isArray(views)||!views.length||views.some(v=>!basis.views.some(camera=>hash(camera)===hash(v.camera??v))))
  throw Error('Representative comparison cameras changed from the initial basis');
 return {basisHash,status:basis.selection.status,sourceHash:basis.sourceHash,canAuthorizePlacement:false};
}
