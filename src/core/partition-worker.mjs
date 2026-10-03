import fs from 'node:fs';
import path from 'node:path';
import {parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {writeSchematic,prepareAsset} from './schematic-writer.mjs';
import {verifySchematic} from './schematic-verifier.mjs';
import {hashFile} from './hash.mjs';

const adapter=await import(pathToFileURL(workerData.adapterFile).href);
parentPort.on('message',async part=>{
 try{
  const started=performance.now(),asset=await adapter.extract({...workerData.context,options:{...workerData.context.options,partition:part}});
  const file=path.join(workerData.directory,`${part.key}.schem`),recordFile=path.join(workerData.reportDir,'parts',`${part.key}.json`);
  let previous=null;try{previous=JSON.parse(fs.readFileSync(recordFile,'utf8'));}catch{}
  let prepared,resumed=false;
  if(previous?.fingerprint===workerData.fingerprint&&fs.existsSync(file)&&(await hashFile(file))===previous.sha256){prepared=prepareAsset(asset,workerData.mapping);resumed=true;}
  else prepared=await writeSchematic(asset,workerData.mapping,file,{dataVersion:workerData.dataVersion});
  const verified=await verifySchematic(file,{expected:{...asset.dimensions,nonAir:asset.voxelCount,...(resumed?{semanticSha256:previous.semanticSha256}:{})}});
  // Preview-only samples from the actual exported placements. Coordinates are never rescaled.
  // Highest block per four-metre XY-map grid plus uniformly selected volume points.
  const {indices,paletteIds}=prepared.placements,top=new Int32Array(asset.dimensions.width*asset.dimensions.length);top.fill(-1);
  for(let i=0;i<indices.length;i++)top[indices[i]%top.length]=i;
  const chosen=new Set();
  for(let z=0;z<asset.dimensions.length;z+=4)for(let x=0;x<asset.dimensions.width;x+=4){const i=top[x+z*asset.dimensions.width];if(i>=0)chosen.add(i);}
  const stride=Math.max(1,Math.ceil(indices.length/4096));for(let i=0;i<indices.length;i+=stride)chosen.add(i);
  const samples=new Uint32Array(chosen.size*2);let cursor=0;for(const i of chosen){samples[cursor++]=indices[i];samples[cursor++]=paletteIds[i];}
  const o=part.offset,d=asset.dimensions,origin=workerData.origin;
  const record={...part,file:`${part.key}.schem`,fingerprint:workerData.fingerprint,status:'verified',nonAir:verified.nonAir,volume:verified.volume,sha256:verified.sha256,semanticSha256:verified.semanticSha256,compressedBytes:verified.compressedBytes,uncompressedBytes:verified.uncompressedBytes,palette:verified.palette,blockHistogram:verified.blockHistogram,usedSourceTypes:prepared.metrics.usedSourceTypes,duplicates:prepared.metrics.duplicates,
   recommendedMinimumCorner:{x:origin.x+o.x,y:origin.y,z:origin.z+o.z},recommendedAxiomAnchor:{x:origin.x+o.x+Math.floor(d.width/2),y:origin.y+Math.floor(d.height/2),z:origin.z+o.z+Math.floor(d.length/2)},timingMs:Math.round(performance.now()-started),resumed};
  fs.writeFileSync(recordFile,JSON.stringify(record,null,2));
  parentPort.postMessage({record,samples},[samples.buffer]);
 }catch(error){parentPort.postMessage({error:error.stack,key:part.key});}
});
