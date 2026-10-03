import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {hash} from '../src/generation/compiler.mjs';
import {pixelPngs,validateReviewImageFiles} from './visual-review.mjs';

const digest=/^[a-f0-9]{64}$/;
export const NATIVE_RENDERER='minecraft-1.20.1-block-models-v1';
export async function safeEvidenceFile(root,relative,limit){
  if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe evidence path');
  let current=path.resolve(root);
  if((await fs.lstat(current)).isSymbolicLink())throw new Error('Evidence root link forbidden');
  for(const part of relative.split(/[\\/]/)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw new Error('Evidence link forbidden');}
  const stat=await fs.stat(current);if(!stat.isFile()||stat.size>limit)throw new Error('Evidence file quota/type');
  return fs.readFile(current);
}
const jsonFile=async(root,name,limit=1048576)=>JSON.parse((await safeEvidenceFile(root,name,limit)).toString('utf8'));
async function immutable(file,bytes){
  try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==Buffer.byteLength(bytes)||!Buffer.from(bytes).equals(await fs.readFile(file)))throw new Error('Evidence identity conflict: '+path.basename(file));}
}
export function validateEvidenceRequest(request){
  const {requestHash,...data}=request;
  if(request.format!=='NativeEvidenceRequest'||request.version!==1||request.renderer!==NATIVE_RENDERER||hash(data)!==requestHash||!digest.test(request.sourceHash)||!digest.test(request.assetHash)||!digest.test(request.cellsHash)||request.canAuthorizePlacement!==false)throw new Error('Invalid native evidence request identity');
  const d=request.dimensions,extent=[d?.width,d?.height,d?.length];
  if(extent.some((v,i)=>!Number.isSafeInteger(v)||v<1||v>[256,384,256][i])||extent.reduce((a,b)=>a*b,1)>8388608)throw new Error('Invalid evidence dimensions');
  if(!Array.isArray(request.views)||request.views.length<4||request.views.length>8)throw new Error('Invalid native view count');
  const ids=new Set();
  for(const v of request.views){
    if(!/^[a-z][a-z0-9-]{0,31}$/.test(v.id)||ids.has(v.id)||!['exterior','entry','typical-floor','special-floor','section','facade-detail'].includes(v.purpose)||v.width!==512||v.height!==512||!Number.isFinite(v.yaw)||Math.abs(v.yaw)>360||!Number.isFinite(v.pitch)||Math.abs(v.pitch)>90||!Array.isArray(v.min)||!Array.isArray(v.max)||v.min.length!==3||v.max.length!==3||v.min.some((n,i)=>!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(v.max[i])||v.max[i]<=n||v.max[i]>extent[i]))throw new Error('Invalid native view contract');
    ids.add(v.id);
  }
  return request;
}
export async function readNativeRequest(jobDirectory,id){
  if(!digest.test(id))throw new Error('Invalid evidence ID');
  const request=validateEvidenceRequest(await jsonFile(jobDirectory,`native-evidence/${id}/request.json`));
  if(request.requestHash!==id)throw new Error('Native evidence directory mismatch');return request;
}
export async function readNativeEvidence(jobDirectory,id){
  const request=await readNativeRequest(jobDirectory,id),folder=`native-evidence/${id}`;
  const manifest=await jsonFile(jobDirectory,folder+'/evidence.json'),{evidenceHash,...content}=manifest;
  if(hash(content)!==evidenceHash||manifest.format!=='EvidenceManifest'||manifest.version!==1||manifest.requestHash!==id||manifest.sourceHash!==request.sourceHash||manifest.assetHash!==request.assetHash||manifest.cellsHash!==request.cellsHash||manifest.renderer!==NATIVE_RENDERER||manifest.canAuthorizePlacement!==false||manifest.worldCaptured!==false||manifest.views?.length!==request.views.length)throw new Error('Native evidence manifest mismatch');
  const encoded=[],images=[];
  for(const [i,view] of manifest.views.entries()){
    if(view.file!==`view-${i}.png`||hash(view.camera)!==hash(request.views[i])||!Number.isSafeInteger(view.faces)||view.faces<=0||!Number.isSafeInteger(view.draws)||view.draws<1)throw new Error('Native view identity/empty capture');
    const relative=folder+'/'+view.file,bytes=await safeEvidenceFile(jobDirectory,relative,1048576);
    if(hash(bytes)!==view.sha256)throw new Error('Native image hash mismatch');encoded.push(bytes.toString('base64'));images.push(path.join(jobDirectory,relative));
  }
  pixelPngs(encoded,request.views.length);return {evidence:manifest,images};
}
/** Only bytes for a server-issued, hash-bound render request. No paths or URLs. */
export async function acceptNativeEvidence(jobDirectory,id,upload){
  const request=await readNativeRequest(jobDirectory,id);
  if(!upload||Object.keys(upload).some(k=>!['requestHash','renderer','views'].includes(k))||upload.requestHash!==id||upload.renderer!==NATIVE_RENDERER||!Array.isArray(upload.views)||upload.views.length!==request.views.length)throw new Error('Native upload request mismatch');
  const pixels=pixelPngs(upload.views.map(v=>v.png),request.views.length);
  const views=upload.views.map((v,i)=>{
    if(Object.keys(v).some(k=>!['id','png','faces','draws'].includes(k))||v.id!==request.views[i].id||!Number.isSafeInteger(v.faces)||v.faces<1||v.faces>2000000||!Number.isSafeInteger(v.draws)||v.draws!==1)throw new Error('Native upload view mismatch');
    return {file:`view-${i}.png`,sha256:hash(pixels[i]),camera:request.views[i],faces:v.faces,draws:v.draws};
  });
  const content={format:'EvidenceManifest',version:1,kind:'native-asset',mode:'images',requestHash:id,sourceHash:request.sourceHash,assetHash:request.assetHash,cellsHash:request.cellsHash,renderer:NATIVE_RENDERER,
    views,worldCaptured:false,canAuthorizePlacement:false,aestheticQualityVerified:false,
    rendering:{nativeBlockModels:true,textures:true,assetOnly:true,neutralLighting:true,shaderPack:false,worldLightSimulation:false,glassOptics:'preview-alpha-not-physical',resourcePack:'current-client-block-atlas'}};
  const evidence={...content,evidenceHash:hash(content)},root=path.join(jobDirectory,'native-evidence',id);
  for(const [i,bytes] of pixels.entries())await immutable(path.join(root,`view-${i}.png`),bytes);
  // Immutable final receipt is committed last. A repeated upload must be identical.
  await immutable(path.join(root,'evidence.json'),JSON.stringify(evidence));
  return (await readNativeEvidence(jobDirectory,id)).evidence;
}
export async function requestNativeEvidence({jobDirectory,bundleDirectory,sourceHash,assetHash,views,signal,onWaiting=async()=>{},timeoutMs=600000}){
  signal.throwIfAborted();
  const manifest=await jsonFile(bundleDirectory,'manifest.json'),{assetHash:actual,...metadata}=manifest;
  if(actual!==assetHash||hash(metadata)!==assetHash||manifest.scene?.sourceHash!==sourceHash||manifest.diagnosticOnly!==true)throw new Error('Native render subject mismatch');
  const cells=await safeEvidenceFile(bundleDirectory,'cells.bin',16777216);
  if(hash(cells)!==manifest.cellsHash||cells.length!==manifest.dimensions.width*manifest.dimensions.height*manifest.dimensions.length*2)throw new Error('Native render cells mismatch');
  const data={format:'NativeEvidenceRequest',version:1,renderer:NATIVE_RENDERER,sourceHash,assetHash,cellsHash:manifest.cellsHash,dimensions:manifest.dimensions,views,canAuthorizePlacement:false};
  const request=validateEvidenceRequest({...data,requestHash:hash(data)}),id=request.requestHash,root=path.join(jobDirectory,'native-evidence',id);
  await fs.mkdir(root,{recursive:true});
  for(const dir of [path.join(jobDirectory,'native-evidence'),root])if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Native evidence directory link forbidden');
  await immutable(path.join(root,'manifest.json'),JSON.stringify(manifest));await immutable(path.join(root,'cells.bin'),cells);await immutable(path.join(root,'request.json'),JSON.stringify(request));
  const deadline=Date.now()+timeoutMs;let announced=false;
  for(;;){
    signal.throwIfAborted();
    try{const result=await readNativeEvidence(jobDirectory,id);await onWaiting({id,state:'complete',evidenceHash:result.evidence.evidenceHash});return result;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(!announced){
      await onWaiting({id,state:'waiting',request});announced=true;
      // The callback may have committed the exact immutable receipt while
      // announcing/waiting. Recheck it (and cancellation) before testing the
      // original deadline; do not reset the clock or accept partial evidence.
      continue;
    }
    if(Date.now()>=deadline)throw new Error('原生视觉证据等待超时；建筑与请求已保留，没有调用下一轮模型或静默改成文本复核');
    await delay(200,undefined,{signal});
  }
}
/** Adapter allowlist: legacy captures remain four-view; native attachments must
 * resolve to a complete, immutable job-owned EvidenceManifest. */
export async function validateModelImageFiles(images,directory){
  if(!images.length)return;
  const relative=path.relative(path.resolve(directory),images[0]).replaceAll('\\','/');
  const revision=/^native-revisions\/([a-f0-9]{64})\/view-0\.png$/.exec(relative);
  if(revision){
    const expected=await readNativeRevisionComparison(directory,revision[1]);
    if(images.length!==expected.images.length||images.some((file,i)=>!path.isAbsolute(file)||path.resolve(file)!==path.resolve(expected.images[i])))throw new Error('Native revision image selection mismatch');
    return;
  }
  const comparison=/^native-comparisons\/([a-f0-9]{64})\/view-0\.png$/.exec(relative);
  if(comparison){
    const expected=await readNativeComparison(directory,comparison[1]);
    if(images.length!==expected.images.length||images.some((file,i)=>!path.isAbsolute(file)||path.resolve(file)!==path.resolve(expected.images[i])))throw new Error('Native comparison image selection mismatch');
    return;
  }
  const match=/^native-evidence\/([a-f0-9]{64})\/view-0\.png$/.exec(relative);
  if(!match)return validateReviewImageFiles(images,directory);
  const expected=await readNativeEvidence(directory,match[1]);
  if(images.length!==expected.images.length||images.some((file,i)=>!path.isAbsolute(file)||path.resolve(file)!==path.resolve(expected.images[i])))throw new Error('Native model image selection mismatch');
}

/** A comparison is a bounded, immutable selection of verified native captures,
 * never arbitrary attachments or evidence of a completed/placed building. */
export async function readNativeComparison(directory,id){
  if(!digest.test(id))throw new Error('Invalid comparison ID');
  const folder=`native-comparisons/${id}`,manifest=await jsonFile(directory,folder+'/manifest.json'),{evidenceHash,...content}=manifest;
  if(evidenceHash!==id||hash(content)!==id||manifest.format!=='EvidenceManifest'||manifest.version!==1||manifest.kind!=='native-comparison'||manifest.mode!=='images'||manifest.renderer!==NATIVE_RENDERER||!digest.test(manifest.candidateSetHash)||manifest.canAuthorizePlacement!==false||manifest.worldCaptured!==false||manifest.diagnosticOnly!==true||manifest.aestheticQualityVerified!==false||!Array.isArray(manifest.subjects)||manifest.subjects.length<1||manifest.subjects.length>3||!Array.isArray(manifest.views)||manifest.views.length<4||manifest.views.length>8)throw new Error('Native comparison manifest mismatch');
  const originals=new Map(),ids=new Set(),count=manifest.subjects.length===3?2:4;
  if(manifest.views.length!==manifest.subjects.length*count)throw new Error('Native comparison view count mismatch');
  for(const subject of manifest.subjects){
    if(!/^[a-z][a-z0-9-]{0,15}$/.test(subject.id)||ids.has(subject.id))throw new Error('Native comparison subject mismatch');
    ids.add(subject.id);
    const source=await readNativeEvidence(directory,subject.requestHash);
    if(source.evidence.evidenceHash!==subject.evidenceHash||source.evidence.sourceHash!==subject.sourceHash||source.evidence.assetHash!==subject.assetHash||source.evidence.views.length!==4)throw new Error('Native comparison source mismatch');
    originals.set(subject.id,source);
  }
  const images=[];
  for(const [i,view] of manifest.views.entries()){
    const subject=manifest.subjects[Math.floor(i/count)],original=originals.get(subject.id),sourceIndex=i%count,sourceView=original.evidence.views[sourceIndex];
    if(view.subjectId!==subject.id||view.sourceIndex!==sourceIndex||view.file!==`view-${i}.png`||view.sha256!==sourceView.sha256||hash(view.camera)!==hash(sourceView.camera))throw new Error('Native comparison view identity mismatch');
    const bytes=await safeEvidenceFile(directory,folder+'/'+view.file,1048576);
    if(hash(bytes)!==view.sha256)throw new Error('Native comparison image changed');
    images.push(path.join(directory,folder,view.file));
  }
  return {evidence:manifest,images};
}
export async function createNativeComparison(directory,candidateSetHash,subjects){
  if(!digest.test(candidateSetHash)||!Array.isArray(subjects)||subjects.length<1||subjects.length>3||new Set(subjects.map(s=>s.id)).size!==subjects.length)throw new Error('Invalid comparison subjects');
  const count=subjects.length===3?2:4,verified=[],views=[],bytes=[];
  for(const subject of subjects){
    if(!/^[a-z][a-z0-9-]{0,15}$/.test(subject.id))throw new Error('Invalid comparison subject ID');
    const source=await readNativeEvidence(directory,subject.requestHash),e=source.evidence;
    if(e.sourceHash!==subject.sourceHash||e.assetHash!==subject.assetHash||e.views.length!==4)throw new Error('Comparison subject source mismatch');
    verified.push({id:subject.id,requestHash:e.requestHash,evidenceHash:e.evidenceHash,sourceHash:e.sourceHash,assetHash:e.assetHash});
    for(let i=0;i<count;i++){
      const v=e.views[i];views.push({file:`view-${views.length}.png`,sha256:v.sha256,camera:v.camera,subjectId:subject.id,sourceIndex:i});
      bytes.push(await safeEvidenceFile(directory,`native-evidence/${e.requestHash}/${v.file}`,1048576));
    }
  }
  const content={format:'EvidenceManifest',version:1,kind:'native-comparison',mode:'images',candidateSetHash,renderer:NATIVE_RENDERER,subjects:verified,views,diagnosticOnly:true,worldCaptured:false,canAuthorizePlacement:false,aestheticQualityVerified:false};
  const evidence={...content,evidenceHash:hash(content)},parent=path.join(directory,'native-comparisons'),root=path.join(parent,evidence.evidenceHash);
  await fs.mkdir(root,{recursive:true});
  for(const dir of [parent,root])if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Comparison directory link forbidden');
  for(const [i,b] of bytes.entries())await immutable(path.join(root,`view-${i}.png`),b);
  await immutable(path.join(root,'manifest.json'),JSON.stringify(evidence));
  return readNativeComparison(directory,evidence.evidenceHash);
}

/** Paired BEFORE/AFTER evidence. Only identical, already-issued cameras can
 * be paired; a changed crop cannot masquerade as architectural improvement.
 * Up to four pairs fit the existing eight-image provider transport. */
export async function createNativeRevisionComparison(directory,beforeRequestHash,afterRequestHash,viewIds){
  const before=await readNativeEvidence(directory,beforeRequestHash),after=await readNativeEvidence(directory,afterRequestHash);
  if(hash(before.evidence.rendering)!==hash(after.evidence.rendering))throw new Error('Revision render contracts differ');
  const eligible=before.evidence.views.filter(v=>after.evidence.views.some(a=>hash(a.camera)===hash(v.camera)));
  const preferred=['exterior','facade-detail','entry','typical-floor','special-floor','section'];
  const representative=preferred.map(purpose=>eligible.find(v=>v.camera.purpose===purpose)).filter(Boolean);
  const chosen=viewIds??[...representative,...eligible.filter(v=>!representative.includes(v))].slice(0,4).map(v=>v.camera.id);
  if(!Array.isArray(chosen)||chosen.length<2||chosen.length>4||new Set(chosen).size!==chosen.length)throw new Error('Revision requires two to four distinct paired cameras');
  const subjects=[before,after].map((s,i)=>({id:i?'after':'before',requestHash:s.evidence.requestHash,evidenceHash:s.evidence.evidenceHash,sourceHash:s.evidence.sourceHash,assetHash:s.evidence.assetHash,cellsHash:s.evidence.cellsHash}));
  const pairs=[],views=[],bytes=[];
  for(const id of chosen){
    const bi=before.evidence.views.findIndex(v=>v.camera.id===id),ai=after.evidence.views.findIndex(v=>v.camera.id===id);
    if(bi<0||ai<0||hash(before.evidence.views[bi].camera)!==hash(after.evidence.views[ai].camera))throw new Error('Revision cameras differ or are missing: '+id);
    const indices=[];
    for(const [side,sourceIndex] of [[0,bi],[1,ai]]){
      const subject=subjects[side],source=[before,after][side],v=source.evidence.views[sourceIndex];
      indices.push(views.length);views.push({file:`view-${views.length}.png`,sha256:v.sha256,camera:v.camera,subjectId:subject.id,sourceIndex});
      bytes.push(await safeEvidenceFile(directory,`native-evidence/${subject.requestHash}/${v.file}`,1048576));
    }
    pairs.push({id,purpose:before.evidence.views[bi].camera.purpose,beforeView:indices[0],afterView:indices[1],cameraHash:hash(before.evidence.views[bi].camera)});
  }
  const content={format:'EvidenceManifest',version:1,kind:'native-revision',mode:'images',renderer:NATIVE_RENDERER,
    sourceHash:after.evidence.sourceHash,assetHash:after.evidence.assetHash,cellsHash:after.evidence.cellsHash,
    subjects,pairs,views,rendering:after.evidence.rendering,diagnosticOnly:true,worldCaptured:false,canAuthorizePlacement:false,aestheticQualityVerified:false,
    limitations:['Each pair uses the same declared camera and render contract. Unshown areas are not compared.',
      'The current-client atlas is not independently fingerprinted by the v1 capture protocol; identical render declarations alone do not prove resource-pack identity.',
      'Before images are historical evidence, never pictures of the current asset. Equal pixels or changed source hashes do not prove aesthetic improvement.']};
  const evidence={...content,evidenceHash:hash(content)},parent=path.join(directory,'native-revisions'),root=path.join(parent,evidence.evidenceHash);
  await fs.mkdir(root,{recursive:true});
  for(const dir of [parent,root])if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Revision comparison directory link forbidden');
  for(const [i,b] of bytes.entries())await immutable(path.join(root,`view-${i}.png`),b);
  await immutable(path.join(root,'manifest.json'),JSON.stringify(evidence));
  return readNativeRevisionComparison(directory,evidence.evidenceHash);
}

export async function readNativeRevisionComparison(directory,id){
  if(!digest.test(id))throw new Error('Invalid revision comparison ID');
  const folder=`native-revisions/${id}`,manifest=await jsonFile(directory,folder+'/manifest.json'),{evidenceHash,...content}=manifest;
  if(evidenceHash!==id||hash(content)!==id||manifest.format!=='EvidenceManifest'||manifest.version!==1||manifest.kind!=='native-revision'||manifest.mode!=='images'||manifest.renderer!==NATIVE_RENDERER||manifest.canAuthorizePlacement!==false||manifest.worldCaptured!==false||manifest.diagnosticOnly!==true||manifest.aestheticQualityVerified!==false||!Array.isArray(manifest.subjects)||manifest.subjects.length!==2||!Array.isArray(manifest.pairs)||manifest.pairs.length<2||manifest.pairs.length>4||!Array.isArray(manifest.views)||manifest.views.length!==manifest.pairs.length*2)throw new Error('Native revision manifest mismatch');
  const originals=[];
  for(const [i,subject] of manifest.subjects.entries()){
    if(subject.id!==(i?'after':'before'))throw new Error('Revision subject order mismatch');
    const original=await readNativeEvidence(directory,subject.requestHash),e=original.evidence;
    if(subject.evidenceHash!==e.evidenceHash||subject.sourceHash!==e.sourceHash||subject.assetHash!==e.assetHash||subject.cellsHash!==e.cellsHash||hash(manifest.rendering)!==hash(e.rendering))throw new Error('Revision subject identity mismatch');
    originals.push(original);
  }
  const after=manifest.subjects[1];
  if(manifest.sourceHash!==after.sourceHash||manifest.assetHash!==after.assetHash||manifest.cellsHash!==after.cellsHash)throw new Error('Revision current asset identity mismatch');
  const ids=new Set(),images=[];
  for(const [i,pair] of manifest.pairs.entries()){
    if(ids.has(pair.id)||pair.beforeView!==2*i||pair.afterView!==2*i+1)throw new Error('Revision pair order mismatch');ids.add(pair.id);
    let camera;
    for(let side=0;side<2;side++){
      const index=2*i+side,view=manifest.views[index],original=originals[side],source=original.evidence.views[view.sourceIndex];
      if(!source||view.subjectId!==(side?'after':'before')||view.file!==`view-${index}.png`||view.sha256!==source.sha256||hash(view.camera)!==hash(source.camera)||view.camera.id!==pair.id||view.camera.purpose!==pair.purpose||hash(view.camera)!==pair.cameraHash||(camera&&hash(camera)!==hash(view.camera)))throw new Error('Revision view/camera identity mismatch');
      camera=view.camera;const bytes=await safeEvidenceFile(directory,folder+'/'+view.file,1048576);
      if(hash(bytes)!==view.sha256)throw new Error('Revision comparison image changed');images.push(path.join(directory,folder,view.file));
    }
  }
  return {evidence:manifest,images};
}
