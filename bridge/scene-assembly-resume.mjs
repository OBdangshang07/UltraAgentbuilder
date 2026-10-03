import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {validateAssemblyPlan,applyPackageEdit} from '../contracts/scene-assembly.schema.mjs';
import {readAssemblyBaseline,checkPackageGeometry} from '../src/design/assembly-scope.mjs';
import {validateRequestedHeight} from './generation-policy.mjs';

const fail=message=>{throw new Error('Assembly resume: '+message);};
const equal=(a,b,message)=>{if(hash(a)!==hash(b))fail(message);};
async function read(directory,relative){
 const file=path.join(directory,relative),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)fail('unsafe/oversized evidence file');
 return JSON.parse(await fs.readFile(file,'utf8'));
}
/** Read-only, explicit recovery of an interrupted component phase, never a
 * replacement for native import. All earlier calls, including unknowns, count.
 * No plan/review resume or implicit runtime migration is attempted here. */
export async function prepareAssemblyResume({sourceDirectory,jobHash,assetHash,replayResponseHash},policy){
 if(!path.isAbsolute(sourceDirectory)||sourceDirectory.startsWith('\\\\')||sourceDirectory.startsWith('//')||!(await fs.lstat(sourceDirectory)).isDirectory()||(await fs.lstat(sourceDirectory)).isSymbolicLink())fail('choose a regular local source directory');
 if(!/^[a-f0-9]{64}$/.test(jobHash??'')||!/^[a-f0-9]{64}$/.test(assetHash??''))fail('explicit source job and asset identities required');
 const job=await read(sourceDirectory,'job.json');equal(jobHash,hash(job),'source job changed');
 if(job.recoveryEnabled)fail('durable assembly requires its verified same-runtime invocation journal, not legacy source migration');
 if(!['failed','interrupted','cancelled'].includes(job.state)||job.manifest||job.assemblySummary)fail('source is not an unfinished component task');
 equal(job.preflight,policy,'policy/budget cannot change');
 const records=structuredClone(job.assemblyStages),tier=policy.assembly;
 if(!tier||!Array.isArray(records)||!records.length||records.length!==job.assemblyCallsReserved||records.length>=tier.maximumCalls||records.some((s,i)=>s.index!==i+1||!['accepted','rejected','failed','cancelled','interrupted'].includes(s.state)))fail('invalid/exhausted call ledger');
 const last=records.at(-1);
 const replay=typeof replayResponseHash==='string';
 if(!['component','correct-component'].includes(last.phase)||!['failed','cancelled','interrupted'].includes(last.state))fail('only an unfinished component response can resume');
 if(replay){
  if(!/^[a-f0-9]{64}$/.test(replayResponseHash)||!last.responseReceived||last.invocationOutcome!=='response-received')fail('completed response identity required for local replay');
  equal(hash(await read(sourceDirectory,'assembly/'+last.index+'/response.json')),replayResponseHash,'completed response changed');
  for(const name of ['scene.json','feedback.json','result.json','engineering-replay.json'])try{await fs.access(path.join(sourceDirectory,'assembly',String(last.index),name));fail('completed response already inspected; no ambiguous replay');}catch(error){if(error.code!=='ENOENT')throw error;}
 }else if(last.responseReceived||!['unknown','not-started'].includes(last.invocationOutcome))fail('only an explicitly interrupted, unreceived component response can resume');
 let inherited=null;
 if(job.resumedFrom){
  const proof=await read(sourceDirectory,'assembly/resume.json');
  if(!path.isAbsolute(proof.sourceDirectory)||proof.sourceDirectory.startsWith('\\\\')||proof.sourceDirectory.startsWith('//'))fail('unsafe ancestor directory');
  const ancestor=await read(proof.sourceDirectory,'job.json');
  equal(hash(ancestor),proof.sourceJobHash,'ancestor job changed');equal(proof.sourceJobHash,job.resumedFrom.sourceJobHash,'ancestor identity mismatch');
  if(proof.priorCalls!==ancestor.assemblyCallsReserved||proof.priorCalls>=records.length)fail('invalid ancestor call prefix');
  inherited={proof,ancestor};
 }
 const plan=await read(sourceDirectory,'assembly/plan.json'),ordered=validateAssemblyPlan(plan,tier),interfaces=await read(sourceDirectory,'assembly/interfaces.json');
 if(interfaces.interfacesFrozen!==true||interfaces.canAuthorizePlacement!==false)fail('interfaces not frozen');
 equal(interfaces.planHash,hash(plan),'plan identity mismatch');equal(interfaces.sourceHash,hash(plan.scene),'initial source mismatch');equal(interfaces.constraints,plan.scene.constraints,'constraints changed');equal(interfaces.packages,plan.packages,'package scopes changed');
 const planStages=records.filter(s=>['plan','correct-plan','repair-plan'].includes(s.phase)&&s.state==='accepted');
 if(planStages.length!==1)fail('exactly one approved skeleton required');
 const initial=planStages[0],completed=[];let scene=plan.scene,feedback,baseline,baselineStage=initial.index,critique=null;
 const accepted=async(stage,candidate,previous)=>{
  const prefix='assembly/'+stage.index;
  const saved=await read(sourceDirectory,prefix+'/scene.json'),report=await read(sourceDirectory,prefix+'/feedback.json'),result=await read(sourceDirectory,prefix+'/result.json');
  equal(saved,candidate,'accepted source does not match original response');equal(stage.sourceHash,hash(saved),'accepted ledger source mismatch');
  if(!report.geometryPassed||report.canAuthorizePlacement!==false||report.sourceHash!==hash(saved)||!result.accepted)fail('accepted checkpoint is not verified');
  equal(result.feedback,report,'accepted feedback mismatch');
  const compiled=await readAssemblyBaseline(path.join(sourceDirectory,prefix,'diagnostic'),report.diagnosticAssetHash);
  equal(compiled.manifest.scene.sourceHash,hash(saved),'baseline provenance source mismatch');validateRequestedHeight(compiled,policy);
  if(previous)checkPackageGeometry(baseline,compiled,previous,feedback,report);
  scene=saved;feedback=report;baseline=compiled;baselineStage=stage.index;
 };
 equal(await read(sourceDirectory,'assembly/'+initial.index+'/plan.json'),plan,'approved plan changed');
 await accepted(initial,scene);
 for(const stage of records.slice(initial.index)){
  const task=ordered[completed.length];
  if(!task||!['component','correct-component'].includes(stage.phase)||stage.task!==task.id||task.dependsOn.some(id=>!completed.includes(id)))fail('package order/dependency mismatch');
  const prefix='assembly/'+stage.index,input=await read(sourceDirectory,prefix+'/input.json');
  equal(stage.baseSourceHash,hash(scene),'stage does not target last accepted source');equal(input.sourceHash,hash(scene),'input source hash mismatch');equal(input.previousDraft,scene,'input baseline mismatch');equal(input.task,task,'input expanded package scope');equal(input.tier,tier,'input changed tier');equal(input.completedPackages,completed,'completed prefix mismatch');
  if(stage.state==='accepted'){
   const response=await read(sourceDirectory,prefix+'/response.json');
   await accepted(stage,applyPackageEdit(scene,response,task).scene,task);completed.push(task.id);critique=null;
  }else if(stage.state==='rejected'){
   const response=await read(sourceDirectory,prefix+'/response.json'),result=await read(sourceDirectory,prefix+'/result.json');
   if(result.accepted||result.feedback?.geometryPassed||result.feedback?.canAuthorizePlacement!==false)fail('rejected candidate relabelled');
   equal(response.sourceHash,hash(scene),'rejected edit targets another source');
   let rejectedSource=null;try{rejectedSource=await read(sourceDirectory,prefix+'/scene.json');equal(rejectedSource,applyPackageEdit(scene,response,task).scene,'rejected source mismatch');}catch(e){if(e.code!=='ENOENT')throw e;}
   critique={rejectedSource,rejectedEdit:response,feedback:result.feedback};
  }else{
   if(stage!==last){
    if(!inherited||stage.index>inherited.proof.priorCalls||stage.responseReceived||!['unknown','not-started'].includes(stage.invocationOutcome))fail('nonterminal unknown stage');
    equal(stage,inherited.ancestor.assemblyStages[stage.index-1],'inherited unknown record changed');
    equal(input,await read(inherited.proof.sourceDirectory,prefix+'/input.json'),'inherited unknown input changed');
   }
   if(stage.phase==='correct-component'){if(!critique)fail('missing rejected candidate for interrupted correction');equal(input.critique,critique,'interrupted correction context changed');}
  }
 }
 const task=ordered[completed.length];if(!task||last.task!==task.id)fail('no unfinished package');
 const correctionsUsed=records.filter(s=>s.task===task.id&&s.phase==='correct-component'&&!s.formatCorrectionOf).length;
 if(correctionsUsed>=tier.maximumComponentCorrections&&!replay)fail('component correction budget exhausted; no reset');
 if(records.length+(ordered.length-completed.length)+1>tier.maximumCalls)fail('insufficient remaining calls for packages and review');
 equal(baseline.manifest.assetHash,assetHash,'last accepted asset changed');
 const formatCorrections=records.filter(s=>s.formatCorrectionOf).length;
 if(formatCorrections>(tier.maximumFormatCorrections??0))fail('format correction budget exceeded');
 return {sourceDirectory,job,plan,ordered,records,completed,scene,feedback,baselineStage,pendingTask:task.id,critique,correctionsUsed,formatCorrections,
  replayResponse:replay?await read(sourceDirectory,'assembly/'+last.index+'/response.json'):null,
  provenance:{version:1,sourceJobId:job.id,sourceJobHash:jobHash,sourceAssetHash:assetHash,sourceHash:hash(scene),acceptedStage:baselineStage,priorCalls:records.length,maximumCalls:tier.maximumCalls,remainingCalls:tier.maximumCalls-records.length,pendingTask:task.id,canAuthorizePlacement:false,...(replay?{replayResponseHash}: {})}};
}

/** Copy only assembly/response evidence, never user configuration or Harness
 * sessions. Each target is exclusive; original files remain read-only. */
export async function copyAssemblyResumeEvidence(state,destination){
 const proof=[];
 const copy=async relative=>{
  const from=path.join(state.sourceDirectory,relative),stat=await fs.lstat(from);
  if(stat.isSymbolicLink())fail('evidence links forbidden');
  if(stat.isDirectory()){await fs.mkdir(path.join(destination,relative),{recursive:true});for(const entry of await fs.readdir(from))await copy(relative+'/'+entry);return;}
  if(!stat.isFile()||stat.size>64*1024*1024)fail('unsafe evidence file');
  const targetRelative=relative==='assembly/resume.json'?'assembly/resume-history/'+state.job.id+'.json':relative;
  const bytes=await fs.readFile(from);await fs.mkdir(path.dirname(path.join(destination,targetRelative)),{recursive:true});await fs.writeFile(path.join(destination,targetRelative),bytes,{flag:'wx'});proof.push({path:targetRelative,...(relative!==targetRelative?{sourcePath:relative}:{}),bytes:bytes.length,sha256:hash(bytes)});
 };
 await copy('assembly');
 for(const entry of await fs.readdir(state.sourceDirectory))if(/^(?:deepseek|codex|claude)-response-[\w-]+$/.test(entry))await copy(entry);
 equal(await read(state.sourceDirectory,'job.json'),state.job,'source job changed during copy');
 return proof;
}
