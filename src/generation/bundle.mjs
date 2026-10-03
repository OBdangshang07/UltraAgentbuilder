import fs from 'node:fs/promises';
import path from 'node:path';
import {hash,LIMITS} from './compiler.mjs';
import {MATERIALS} from './materials.mjs';
import {validateState,validateDoorPairs} from './block-states.mjs';

async function bounded(file,max){if((await fs.stat(file)).size>max)throw new Error('Import file quota exceeded: '+path.basename(file));return fs.readFile(file);}
// Compiler quotas measure data, not indentation. Bound the on-disk allocation
// separately, then enforce the SAME compact JSON quota as the compiler.
async function boundedSource(file){
  const value=JSON.parse((await bounded(file,LIMITS.bytes*8)).toString('utf8'));
  if(Buffer.byteLength(JSON.stringify(value))>LIMITS.bytes)throw new Error('Import source data quota exceeded: '+path.basename(file));
  return value;
}
export async function readNativeBundle(directory){
  if(!path.isAbsolute(directory)||directory.startsWith('\\\\')||directory.startsWith('//'))throw new Error('Choose an absolute local native-bundle directory');
  const manifest=JSON.parse((await bounded(path.join(directory,'manifest.json'),1024*1024)).toString('utf8'));
  const {assetHash,...metadata}=manifest;if(hash(metadata)!==assetHash)throw new Error('Imported manifest hash mismatch');
  if(manifest.diagnosticOnly)throw new Error('Diagnostic-only assets cannot be imported for building');
  if(manifest.quality){const q=manifest.quality;if(q.version!==1||!['verified','unverified','not-requested'].includes(q.navigation)||q.requiresAcknowledgement!==(q.navigation!=='verified')||!Array.isArray(q.issues))throw new Error('Invalid imported quality/acknowledgement metadata');}
  if(manifest.schemaVersion!==1||manifest.minecraft!=='1.20.1'||manifest.dataVersion!==3465||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.id))throw new Error('Unsupported native asset identity/version');
  const {width:w,height:h,length:d}=manifest.dimensions??{};
  if(![w,h,d].every(Number.isInteger)||w<1||h<1||d<1||w>LIMITS.width||h>LIMITS.height||d>LIMITS.length||w*h*d>LIMITS.cells)throw new Error('Asset exceeds native dimensions (256x384x256) or 8,388,608-cell volume; use an explicit partition route, never automatic cropping');
  const palette=manifest.palette;if(!Array.isArray(palette)||palette.length<3||palette.length>256||palette[0]!=='@keep'||palette[1]!=='minecraft:air')throw new Error('Unsupported or unsafe imported palette');try{for(const state of palette.slice(2))validateState(state);}catch(e){throw new Error('Unsupported or unsafe imported palette: '+e.message);}
  const binary=await bounded(path.join(directory,'cells.bin'),LIMITS.cells*2);if(binary.length!==w*h*d*2||hash(binary)!==manifest.cellsHash)throw new Error('Imported cells size/hash mismatch');
  const cells=new Uint16Array(w*h*d);let setCount=0,clearCount=0;
  for(let i=0;i<cells.length;i++){const n=binary.readUInt16LE(i*2);if(n>=palette.length)throw new Error('Invalid imported palette index');cells[i]=n;if(n>=2)setCount++;else if(n===1)clearCount++;}
  if(!setCount||setCount>LIMITS.occupied||setCount!==manifest.setCount||clearCount!==manifest.clearCount)throw new Error('Imported mask/count mismatch');
  validateDoorPairs(cells,palette,manifest.dimensions);
  let spec;try{spec=await boundedSource(path.join(directory,'spec.json'));if(hash(spec)!==manifest.specHash)throw new Error('Imported spec hash mismatch');}catch(e){if(e.code!=='ENOENT')throw e;}
  let scene,designSources,sourceOwners;
  if(manifest.scene){
    scene=await boundedSource(path.join(directory,'scene.json'));
    if(hash(scene)!==manifest.scene.sourceHash)throw new Error('Imported scene source hash mismatch');
    designSources=JSON.parse((await bounded(path.join(directory,'design-sources.json'),8*1024*1024)).toString('utf8'));
    const owners=await bounded(path.join(directory,'source-owners.bin'),LIMITS.cells*2);
    if(hash(designSources)!==manifest.scene.sourcesHash||hash(owners)!==manifest.scene.ownersHash||owners.length!==cells.length*2)throw new Error('Imported scene provenance integrity failed');
    sourceOwners=new Uint16Array(cells.length);for(let i=0;i<cells.length;i++){sourceOwners[i]=owners.readUInt16LE(i*2);if(sourceOwners[i]>=designSources.traceSources.length)throw new Error('Invalid scene provenance index');}
  }
  return {manifest,binary,cells,spec,...(scene?{scene,designSources,sourceOwners}:{})};
}
export async function exportNativeBundle(directory){
  const target=path.join(directory,'shareable-native-bundle');await fs.mkdir(target,{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  for(const name of ['manifest.json','cells.bin','spec.json',...(manifest.scene?['scene.json','design-sources.json','source-owners.bin']:[])])try{await fs.copyFile(path.join(directory,name),path.join(target,name),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST'&&!(e.code==='ENOENT'&&name==='spec.json'))throw e;}
  await readNativeBundle(target);return target;
}
