import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {getAssetConfig,createAssetContext,loadAdapter,loadMapping,resolveDataVersion} from './project-config.mjs';
import {resolveProject,relativeProject,ensureDir} from './paths.mjs';
import {hashFile} from './hash.mjs';
import {hashPath} from './path-hash.mjs';
import {verifySchematic} from './schematic-verifier.mjs';
import {writePreviewBundle} from './preview-bundle.mjs';
import {capturePreview} from './visual-runner.mjs';
import {validateLayout,collectionHash} from './partition-layout.mjs';

function variantConfig(id,options){
 const parent=getAssetConfig(id),variant=parent.partitions?.[options.partition];
 if(!variant)throw new Error(`Unknown partition variant ${id}/${options.partition}`);
 return {parent,variant,config:{...parent,...variant,options:{tileWidth:variant.tileWidth,tileLength:variant.tileLength}}};
}
export async function inspectPartitionedAsset(id,options){
 const {config}=variantConfig(id,options),context=createAssetContext(config),adapter=await loadAdapter(config);
 return adapter.inspect(context);
}

export async function buildPartitionedAsset(id,options={}){
 const began=performance.now(),{parent,variant,config}=variantConfig(id,options),context=createAssetContext(config),adapter=await loadAdapter(config);
 if(typeof adapter.plan!=='function')throw new Error('Partition adapter must expose plan(context)');
 const plan=await adapter.plan(context),coverage=validateLayout(plan.parts,plan.dimensions);
 const {file:mappingFile,mapping,review}=loadMapping({...parent,id:variant.id}),dataVersion=resolveDataVersion(options),origin=variant.recommendedOrigin;
 const directory=path.resolve(options.outputDir??resolveProject('build','schematics'),variant.directory),reportDir=path.resolve(options.reportDir??resolveProject('reports',variant.id));
 ensureDir(directory);ensureDir(path.join(reportDir,'parts'));
 const sourceSha256=await hashPath(context.sourcePath),mappingSha256=await hashFile(mappingFile),adapterFile=resolveProject('src','adapters',variant.adapter);
 const pipelineHashes=await Promise.all(['schematic-writer.mjs','schematic-verifier.mjs','partition-worker.mjs','partition-layout.mjs'].map(f=>hashFile(resolveProject('src','core',f))));
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({sourceSha256,mappingSha256,adapter:await hashFile(adapterFile),pipelineHashes,variant,dataVersion})).digest('hex');
 const workers=Math.min(4,Math.max(1,Number(options.workers)||4),plan.parts.length),results=[],samples=[],pool=[];
 let next=0,completed=0;
 console.log(`1:1 partition build: ${plan.parts.length} parts, ${workers} workers; no geometric downsampling.`);
 try{
  await new Promise((resolve,reject)=>{
   let failed=false;const fail=error=>{if(!failed){failed=true;reject(error);}};
   const dispatch=worker=>{if(!failed&&next<plan.parts.length)worker.postMessage(plan.parts[next++]);};
   for(let i=0;i<workers;i++){
    const worker=new Worker(new URL('./partition-worker.mjs',import.meta.url),{workerData:{adapterFile,context,mapping,dataVersion,directory,reportDir,origin,fingerprint}});pool.push(worker);
    worker.on('error',fail);worker.on('exit',code=>{if(code!==0&&!failed&&completed<plan.parts.length)fail(new Error(`Partition worker exited: ${code}`));});
    worker.on('message',message=>{
     if(failed)return;if(message.error){fail(new Error(message.error));return;}
     const {record}=message;results.push(record);samples.push({record,data:message.samples});completed++;
     if(completed%8===0||completed===plan.parts.length){console.log(`Verified ${completed}/${plan.parts.length}: ${record.key}; ${Math.round(performance.now()-began)/1000}s`);fs.writeFileSync(path.join(reportDir,'progress.json'),JSON.stringify({completed,total:plan.parts.length,last:record.key,elapsedMs:Math.round(performance.now()-began),status:completed===plan.parts.length?'parts-complete':'building'}));}
     if(completed===plan.parts.length)resolve();else dispatch(worker);
    });dispatch(worker);
   }
  });
 }finally{await Promise.all(pool.map(w=>w.terminate()));}
 results.sort((a,b)=>a.key.localeCompare(b.key));samples.sort((a,b)=>a.record.key.localeCompare(b.record.key));
 const nonAir=results.reduce((s,p)=>s+p.nonAir,0),encodedVolume=results.reduce((s,p)=>s+p.volume,0),semanticSha256=collectionHash(plan.dimensions,results);
 const histogram={},used=new Set();for(const p of results){for(const [m,n] of Object.entries(p.blockHistogram))histogram[m]=(histogram[m]||0)+n;for(const m of p.usedSourceTypes)used.add(m);}
 const manifest={schemaVersion:1,kind:'verified-sponge-partition-set',asset:variant.id,releaseStatus:'candidate-pending-real-game-import',generatedAt:new Date().toISOString(),sourceSha256,fingerprint,format:{kind:'Sponge Schematic',version:2,dataVersion},fullDimensions:plan.dimensions,sourceEnvelopeVolume:plan.dimensions.width*plan.dimensions.height*plan.dimensions.length,encodedVolume,nonAir,semanticSha256,semanticHashDefinition:'SHA-256 of full dimensions plus sorted [key, offset, dimensions, per-file semantic SHA-256] records. Not the hash of a monolithic schematic.',recommendedMinecraftOrigin:origin,transforms:plan.transforms,coverage,tiles:results};
 const outputFile=path.join(directory,'placement-manifest.json');fs.writeFileSync(outputFile,JSON.stringify(manifest,null,2));
 // Reuse the normal preview writer with bounded samples of true 1:1 placements.
 const palette=['minecraft:air'],paletteIds=new Map([[palette[0],0]]),points=[];
 for(const {record,data} of samples){const {width,length}=record.dimensions;for(let i=0;i<data.length;i+=2){const index=data[i],state=record.palette[data[i+1]];if(!paletteIds.has(state)){paletteIds.set(state,palette.length);palette.push(state);}
  const x=index%width+record.offset.x,z=Math.floor(index/width)%length+record.offset.z,y=Math.floor(index/(width*length));points.push([x+z*plan.dimensions.width+y*plan.dimensions.width*plan.dimensions.length,paletteIds.get(state)]);
 }}
 const preview=await writePreviewBundle(`${variant.id} · sampled preview / full ${nonAir.toLocaleString('en-US')} blocks`,{asset:{dimensions:plan.dimensions},palette,placements:points},reportDir),screenshots=options.visual?await capturePreview(preview,{browserPath:options.browserPath}):[];
 const report={schemaVersion:1,status:'passed',generatedAt:new Date().toISOString(),asset:{id:variant.id,parent:id,source:relativeProject(context.sourcePath),sourceSha256,adapter:variant.adapter},mapping:{file:relativeProject(mappingFile),sha256:mappingSha256,review,usedTypes:[...used].sort(),coverage:1},format:manifest.format,output:{file:relativeProject(outputFile),sha256:await hashFile(outputFile),semanticSha256,compressedBytes:results.reduce((s,p)=>s+p.compressedBytes,0)},dimensions:plan.dimensions,volume:manifest.sourceEnvelopeVolume,encodedVolume,nonAir,blockHistogram:histogram,sourceStats:plan.sourceStats,transforms:plan.transforms,coverage,tiles:{count:results.length,directory:relativeProject(directory),manifest:relativeProject(outputFile),totalNonAir:nonAir,status:'verified'},baseline:{enforced:false,reason:'New exact-scale partition variant; not a regression-equivalent 1:4 baseline.',realGameImport:'not-performed'},visual:{status:options.visual?'captured':'preview-ready',sampling:'Preview only: highest block at 4-metre grid points plus <=4096 uniform volume points per partition. Stored coordinates and ALL schematic blocks stay 1:1.',sampleCount:points.length,preview:relativeProject(preview.htmlFile),screenshots:screenshots.map(s=>({...s,file:relativeProject(s.file)}))},timingMs:{total:Math.round(performance.now()-began)}};
 const reportFile=path.join(reportDir,'build-report.json');fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 return {report,reportFile,outputFile};
}

export async function verifyPartitionedSet(file){
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.kind!=='verified-sponge-partition-set')throw new Error('Not a partition manifest');
 validateLayout(manifest.tiles,manifest.fullDimensions);
 let nonAir=0,encodedVolume=0;const directory=path.dirname(path.resolve(file));
 for(let i=0;i<manifest.tiles.length;i++){
  const tile=manifest.tiles[i],target=path.resolve(directory,tile.file);if(path.dirname(target)!==directory)throw new Error('Unsafe partition filename');
  const result=await verifySchematic(target,{expected:{...tile.dimensions,nonAir:tile.nonAir,semanticSha256:tile.semanticSha256}});
  if(result.sha256!==tile.sha256||result.dataVersion!==manifest.format.dataVersion)throw new Error(`Partition hash/version mismatch ${tile.key}`);
  nonAir+=result.nonAir;encodedVolume+=result.volume;if((i+1)%40===0)console.log(`Re-parsed ${i+1}/${manifest.tiles.length}`);
 }
 if(nonAir!==manifest.nonAir||encodedVolume!==manifest.encodedVolume||collectionHash(manifest.fullDimensions,manifest.tiles)!==manifest.semanticSha256)throw new Error('Partition totals or collection hash mismatch');
 return {status:'passed',parts:manifest.tiles.length,dimensions:manifest.fullDimensions,nonAir,encodedVolume,semanticSha256:manifest.semanticSha256,realGameImport:'not-performed'};
}
