import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';

const digest=/^[a-f0-9]{64}$/;
async function readBoundFile(root,relative,maximum=16777216){
 assert.ok(typeof relative==='string'&&!path.isAbsolute(relative)&&relative.split(/[\\/]/).every(p=>p&&p!=='.'&&p!=='..'),'Unsafe inspection path');
 let file=root;assert.equal((await fs.lstat(root)).isSymbolicLink(),false);
 for(const part of relative.split(/[\\/]/)){file=path.join(file,part);assert.equal((await fs.lstat(file)).isSymbolicLink(),false);}
 const stat=await fs.stat(file);assert.ok(stat.isFile()&&stat.size<=maximum,'Inspection file quota/type');return fs.readFile(file);
}
const json=async(root,relative)=>JSON.parse((await readBoundFile(root,relative)).toString('utf8'));

/** An independent concept can be shown before the combined selection stage.
 * Bind the ORIGINAL accepted response, scene, diagnostic cells and native PNGs;
 * never generate a replacement render merely to make progress look visible. */
export async function inspectQualityCandidateImages(ledgerFile,index){
 assert.ok(Number.isSafeInteger(index)&&index>=1&&index<=26,'Explicit candidate stage index required');
 ledgerFile=path.resolve(ledgerFile);const root=path.dirname(ledgerFile),ledger=await json(root,path.basename(ledgerFile));
 assert.equal(ledger.results?.length,1);assert.equal(hash(ledger.protocol),ledger.protocolHash);
 const local=location=>{const full=path.resolve(location),relative=path.relative(root,full);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Candidate inspection escaped ledger');return full;};
 const runtime=local(ledger.runtime),snapshot=await json(runtime,'snapshot.json');
 assert.equal(snapshot.hash,ledger.runtimeHash);assert.equal(hash(snapshot.files),ledger.runtimeHash);
 for(const file of snapshot.files)assert.equal(hash(await readBoundFile(runtime,file.path)),file.hash,'Frozen runtime differs: '+file.path);
 const record=ledger.results[0],directory=local(record.assetDirectory),job=await json(directory,'job.json');
 assert.equal(job.id,record.jobId);assert.ok(Number.isSafeInteger(job.assemblyCallsReserved)&&job.assemblyCallsReserved<=ledger.maximumCalls);
 const stage=job.assemblyStages?.find(s=>s.index===index);assert.ok(stage,'Candidate stage is not reserved');
 assert.ok(['concept-candidate','correct-concept-candidate'].includes(stage.phase)&&stage.state==='accepted','Candidate stage is not an accepted independent concept');
 if(job.recoveryEnabled)assert.match(job.recovery.branch,/^assembly-run-[A-Za-z0-9_-]+$/);
 const prefix=(job.recoveryEnabled?job.recovery.branch+'/':'')+'assembly/'+index;
 const input=await json(directory,prefix+'/input.json'),response=await json(directory,prefix+'/response.json'),result=await json(directory,prefix+'/result.json');
 assert.match(input.candidateId,/^concept-[1-3]$/);assert.equal(input.decompositionStageId,input.candidateId);
 assert.equal(response.format,'SceneConceptSet');assert.equal(response.version,1);assert.equal(response.candidates?.length,1);
 assert.equal(result.accepted,true);assert.equal(result.candidates?.length,1);assert.equal(hash(response),result.candidateSetHash);
 const candidate=response.candidates[0],checked=result.candidates[0];assert.equal(candidate.id,input.candidateId);
 assert.equal(checked.id,candidate.id);assert.equal(checked.eligible,true);assert.equal(hash(candidate.scene),checked.sourceHash);
 const savedScene=await json(directory,prefix+'/'+candidate.id+'/scene.json');assert.equal(hash(savedScene),checked.sourceHash);
 const diagnostic=local(checked.diagnostic),manifest=await json(diagnostic,'manifest.json'),{assetHash,...metadata}=manifest;
 assert.equal(assetHash,checked.assetHash);assert.equal(hash(metadata),assetHash);assert.equal(manifest.scene.sourceHash,checked.sourceHash);
 assert.equal(manifest.diagnosticOnly,true);assert.equal(hash(await readBoundFile(diagnostic,'cells.bin')),manifest.cellsHash);
 const readers=await import(pathToFileURL(path.join(runtime,'bridge/native-evidence.mjs')));let original=null;
 for(const id of await fs.readdir(path.join(directory,'native-evidence'))){
  if(!digest.test(id))continue;
  const request=await readers.readNativeRequest(directory,id);
  if(request.sourceHash!==checked.sourceHash||request.assetHash!==assetHash)continue;
  assert.equal(request.cellsHash,manifest.cellsHash);assert.equal(hash(request.dimensions),hash(manifest.dimensions));
  assert.equal(original,null,'Multiple conflicting candidate captures');original=await readers.readNativeEvidence(directory,id);
 }
 assert.ok(original,'Accepted candidate has no complete original native capture');
 return {type:'read-only-independent-concept-image-inspection',jobId:job.id,savedJobState:job.state,stage:index,phase:stage.phase,
  candidateId:candidate.id,runtimeHash:ledger.runtimeHash,sourceHash:checked.sourceHash,assetHash,
  nativeEvidenceHash:original.evidence.evidenceHash,
  images:original.images.map((file,i)=>({file,sha256:original.evidence.views[i].sha256,camera:original.evidence.views[i].camera,role:'concept-candidate'})),
  imagesVerified:true,additionalModelCalls:0,additionalRenders:0,worldCaptured:false,canAuthorizePlacement:false,
  aestheticQualityVerified:false,terminalTaskAssessment:false,liveObservation:false};
}

/** Read only already-issued stage image evidence, including during a live
 * review. Does NOT compile/render/call models or certify a terminal task.
 * Preserve the enriched input hash separately from its native capture hash. */
export async function inspectQualityStageImages(ledgerFile,index){
 assert.ok(Number.isSafeInteger(index)&&index>=1&&index<=26,'Explicit stage index required');
 ledgerFile=path.resolve(ledgerFile);const root=path.dirname(ledgerFile);
 const ledger=await json(root,path.basename(ledgerFile));assert.equal(ledger.results?.length,1);
 assert.equal(hash(ledger.protocol),ledger.protocolHash);assert.match(ledger.runtimeHash,digest);
 const local=location=>{
  const full=path.resolve(location),relative=path.relative(root,full);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Inspection subject escaped its explicit ledger');return full;
 };
 const runtime=local(ledger.runtime),snapshot=await json(runtime,'snapshot.json');
 assert.equal(snapshot.hash,ledger.runtimeHash);assert.equal(hash(snapshot.files),ledger.runtimeHash);
 for(const file of snapshot.files)assert.equal(hash(await readBoundFile(runtime,file.path)),file.hash,'Frozen runtime differs: '+file.path);
 const record=ledger.results[0],directory=path.resolve(record.assetDirectory);
 if(directory!==root)local(directory);
 const job=await json(directory,'job.json');assert.equal(job.id,record.jobId);
 assert.ok(Number.isSafeInteger(job.assemblyCallsReserved)&&job.assemblyCallsReserved<=ledger.maximumCalls);
 const stage=job.assemblyStages?.find(s=>s.index===index);assert.ok(stage,'Stage is not reserved in the saved job');
 const prefix=job.recoveryEnabled?job.recovery?.branch+'/assembly':'assembly';
 if(job.recoveryEnabled)assert.match(job.recovery.branch,/^assembly-run-[A-Za-z0-9_-]+$/);
 const input=await json(directory,prefix+'/'+index+'/input.json'),declared=input.designEvidence;
 assert.ok(declared?.mode==='images'&&['native-asset','native-comparison','native-revision'].includes(declared.kind),'Stage has no bound native images; do not render or substitute older pictures');
 const {evidenceHash,...enriched}=declared;assert.equal(hash(enriched),evidenceHash,'Enriched stage evidence hash differs');
 const base=structuredClone(enriched);
 for(const key of ['measurements','prototypeEvidence','prototypeExpansion'])delete base[key];
 const readers=await import(pathToFileURL(path.join(runtime,'bridge/native-evidence.mjs')));
 const original=declared.kind==='native-asset'?await readers.readNativeEvidence(directory,declared.requestHash):
  declared.kind==='native-comparison'?await readers.readNativeComparison(directory,hash(base)):
  await readers.readNativeRevisionComparison(directory,hash(base));
 const {evidenceHash:nativeHash,...native}=original.evidence;
 assert.equal(hash(base),hash(native),'Stage image metadata differs from original native evidence');
 if(declared.kind!=='native-comparison'){
  const expansion=declared.prototypeExpansion;
  if(expansion?.version===2){
   assert.equal(expansion.reviewSubject,'expanded');assert.equal(expansion.seedSourceHash,input.sourceHash);
   assert.equal(expansion.expandedSourceHash,declared.sourceHash);assert.equal(expansion.expandedAssetHash,declared.assetHash);
   assert.equal(expansion.seedOnly,false);assert.equal(expansion.expandedPixelsSupplied,true);
  }else assert.equal(input.sourceHash,declared.sourceHash,'Review source differs from image subject');
 }
 assert.equal(declared.worldCaptured,false);assert.equal(declared.canAuthorizePlacement,false);
 const subjects=original.evidence.subjects??[{id:'asset',sourceHash:declared.sourceHash,assetHash:declared.assetHash}];
 const images=original.images.map((file,i)=>{
  const view=original.evidence.views[i],subject=subjects.find(s=>s.id===(view.subjectId??'asset'));assert.ok(subject);
  return {file,index:i,sha256:view.sha256,camera:view.camera,sourceHash:subject.sourceHash,assetHash:subject.assetHash,
   subjectId:subject.id,role:declared.kind==='native-comparison'?'concept-candidate':view.subjectId==='before'?'historical-before':declared.prototypeExpansion?.seedOnly?'seed-only':declared.prototypeExpansion?.version===2?'expanded-prototype':'review-subject'};
 });
 return {type:'read-only-quality-stage-image-inspection',jobId:job.id,savedJobState:job.state,stage:index,phase:stage.phase,stageState:stage.state,
  runtimeHash:ledger.runtimeHash,sourceHash:declared.sourceHash??null,kind:declared.kind,stageEvidenceHash:evidenceHash,nativeEvidenceHash:nativeHash,
  seedOnly:declared.prototypeExpansion?.seedOnly===true,images,imagesVerified:true,additionalModelCalls:0,additionalRenders:0,worldCaptured:false,
  canAuthorizePlacement:false,aestheticQualityVerified:false,terminalTaskAssessment:false,liveObservation:false,
  limitations:['Reads saved stage inputs and native captures; process/job liveness must be observed separately.','A valid image hash is not architectural quality, whole-floor functionality or navigation certification.','Historical BEFORE and diagnostic seed images are not current completed-building previews.',...(original.evidence.limitations??[])]};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [ledger,index,...extra]=process.argv.slice(2);assert.ok(ledger&&/^\d+$/.test(index??'')&&!extra.length,'Usage: quality-stage-images.mjs LEDGER STAGE');
 console.log(JSON.stringify(await inspectQualityStageImages(ledger,Number(index)),null,2));
}
