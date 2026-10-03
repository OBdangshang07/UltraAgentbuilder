import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {validateAssemblyPlan,applyPackageEdit} from '../contracts/scene-assembly.schema.mjs';
import {packageRepairBase,applyPackageRepair} from '../contracts/scene-package-repair.mjs';
import {readAssemblyBaseline,checkPackageGeometry} from '../src/design/assembly-scope.mjs';
import {validateConceptReview} from './assembly-design-review.mjs';
import {componentCorrectionBudget} from './assembly-budget.mjs';
import {validateRequestedHeight} from './generation-policy.mjs';
import {safeEvidenceFile,readNativeEvidence} from './native-evidence.mjs';

const fail=m=>{throw Error('Design continuation: '+m);};
const equal=(a,b,m)=>{if(hash(a)!==hash(b))fail(m);};
const read=async(root,file)=>JSON.parse((await safeEvidenceFile(root,file,16*1024*1024)).toString('utf8'));

/** Explicit engineering continuation only, not automatic retry. Fully received
 * rejected component answers only; no uncertain outcome, plan/refinement restart
 * or ancestor chain. The caller must separately audit the frozen parent runtime.
 * Original files/records are copied, never relabelled or used as native imports. */
export async function prepareDesignContinuation(resume,policy){
 const {sourceDirectory,jobHash,assetHash,authorizedNewCalls,continuationConfirmed}=resume;
 if(resume.kind!=='design-component-v1'||continuationConfirmed!==true||!path.isAbsolute(sourceDirectory)||sourceDirectory.startsWith('\\\\')||sourceDirectory.startsWith('//'))fail('explicit local continuation confirmation required');
 if(!/^[a-f0-9]{64}$/.test(jobHash??'')||!/^[a-f0-9]{64}$/.test(assetHash??''))fail('explicit job/asset identities required');
 const job=await read(sourceDirectory,'job.json'),tier=policy.assembly;
 equal(hash(job),jobHash,'source job changed');equal(job.preflight,policy,'policy/budget changed');
 if(job.state!=='failed'||job.manifest||job.assemblySummary||job.resumedFrom||!job.recoveryEnabled||!/^assembly-run-[\w-]+$/.test(job.recovery?.branch??''))fail('requires original failed durable component task');
 if(tier?.quality?.version!==2||tier.designReview?.version!==2||!['text','native'].includes(tier.designReview.mode)||tier.recovery?.mode!=='safe')fail('unsupported design policy');
 const records=structuredClone(job.assemblyStages),last=records?.at(-1);
 if(!records?.length||records.length!==job.assemblyCallsReserved||records.some((s,i)=>s.index!==i+1||!['accepted','rejected'].includes(s.state)||!s.responseReceived||s.invocationOutcome!=='response-received'))fail('unknown/incomplete invocation history');
 if(!Number.isSafeInteger(authorizedNewCalls)||authorizedNewCalls<1||authorizedNewCalls!==tier.maximumCalls-records.length)fail('explicit remaining-call authorization required; no reset');
 if(last.state!=='rejected'||!['component','correct-component'].includes(last.phase))fail('only a rejected required component may continue');
 const assemblyRelative=job.recovery.branch+'/assembly',ar=path.join(sourceDirectory,assemblyRelative);
 const identity=await read(sourceDirectory,'assembly-journal/identity.json'),dispatched=await read(sourceDirectory,'assembly-journal/dispatched.json');
 if(hash(identity.value)!==identity.sha256||identity.value.requestHash!==job.requestHash||identity.value.policyHash!==hash(policy)||identity.value.maximumCalls!==tier.maximumCalls||hash(dispatched.value)!==dispatched.sha256||dispatched.value.count!==records.length)fail('invocation identity/budget mismatch');
 const names=(await fs.readdir(path.join(sourceDirectory,'assembly-journal'))).filter(n=>/^call-\d+\.json$/.test(n));if(names.length!==records.length)fail('invocation ledger count mismatch');
 for(const s of records){
  const e=await read(sourceDirectory,`assembly-journal/call-${s.index}.json`);
  if(hash(e.value)!==e.sha256||e.value.index!==s.index||e.value.state!=='response')fail('unknown/corrupt invocation receipt');
  equal(e.value.response,await read(ar,`${s.index}/response.json`),'response differs from durable receipt');
 }
 const plan=await read(ar,'plan.json'),ordered=validateAssemblyPlan(plan,tier),frozen=await read(ar,'interfaces.json');
 if(frozen.interfacesFrozen!==true||frozen.canAuthorizePlacement!==false)fail('missing frozen authority');
 equal(frozen.planHash,hash(plan),'frozen plan changed');equal(frozen.sourceHash,hash(plan.scene),'frozen source changed');equal(frozen.packages,plan.packages,'frozen packages changed');equal(frozen.constraints,plan.scene.constraints,'frozen constraints changed');
 const first=records.findIndex(s=>['component','correct-component'].includes(s.phase));if(first<1)fail('no component prefix');
 const conceptStage=records[first-1],conceptInput=await read(ar,`${conceptStage.index}/input.json`),conceptResponse=await read(ar,`${conceptStage.index}/response.json`),conceptReview=await read(ar,'concept-review.json');
 if(!['concept-review','correct-concept-review'].includes(conceptStage.phase)||conceptStage.state!=='accepted'||conceptResponse.verdict!=='accept')fail('concept not accepted before freeze');
 equal(conceptInput.proposal,plan,'concept plan mismatch');equal(conceptResponse.sourceHash,hash(plan.scene),'concept source mismatch');validateConceptReview(conceptResponse,plan,conceptInput.designEvidence);
 for(const [key,value]of Object.entries(conceptResponse))equal(conceptReview[key],value,'saved concept decision mismatch');
 if(tier.designReview.mode==='native'){
  const actual=await readNativeEvidence(sourceDirectory,conceptInput.designEvidence.requestHash);
  equal(actual.evidence.sourceHash,hash(plan.scene),'concept images target another source');
  if(conceptStage.imageCount!==actual.images.length||conceptStage.imageEvidenceHash!==conceptInput.designEvidence.evidenceHash)fail('concept image attachment mismatch');
 }
 const initial=[...records.slice(0,first)].reverse().find(s=>s.state==='accepted'&&['plan','correct-plan','repair-plan','revise-design','correct-design'].includes(s.phase));if(!initial)fail('no frozen geometry');
 equal(await read(ar,`${initial.index}/plan.json`),plan,'frozen geometry plan mismatch');
 let scene=plan.scene,feedback,baseline,baselineStage,critique=null;const completed=[];let rejectedHashes=[];
 async function accept(s,candidate,task){
  const saved=await read(ar,`${s.index}/scene.json`),report=await read(ar,`${s.index}/feedback.json`),result=await read(ar,`${s.index}/result.json`);
  equal(saved,candidate,'accepted response/source mismatch');equal(s.sourceHash,hash(saved),'accepted ledger source mismatch');equal(result.feedback,report,'accepted feedback mismatch');
  if(!report.geometryPassed||report.canAuthorizePlacement!==false||report.sourceHash!==hash(saved)||!result.accepted)fail('unapproved checkpoint');
  const next=await readAssemblyBaseline(path.join(ar,String(s.index),'diagnostic'),report.diagnosticAssetHash);validateRequestedHeight(next,policy);
  equal(next.manifest.scene.sourceHash,hash(saved),'baseline source differs');if(task)checkPackageGeometry(baseline,next,task,feedback,report);
  scene=saved;feedback=report;baseline=next;baselineStage=s.index;
 }
 await accept(initial,scene);
 for(const s of records.slice(first)){
  const task=ordered[completed.length];if(!task||s.task!==task.id||!['component','correct-component'].includes(s.phase)||task.dependsOn.some(id=>!completed.includes(id)))fail('package order changed');
  const input=await read(ar,`${s.index}/input.json`),response=await read(ar,`${s.index}/response.json`),result=await read(ar,`${s.index}/result.json`);
  equal(input.previousDraft,scene,'input accepted source changed');equal(input.sourceHash,hash(scene),'input source hash changed');equal(s.baseSourceHash,hash(scene),'record source changed');equal(input.task,task,'package permission changed');equal(input.tier,tier,'tier changed');equal(input.completedPackages,completed,'completed package prefix changed');
  let candidate,effectiveEdit=response;
  if(response.format==='ScenePackageRepair'){
   const base=packageRepairBase(scene,critique,task);if(!base)fail('missing rejected repair base');equal(base,input.repairBase,'repair base changed');
   const applied=applyPackageRepair(scene,base,response,task);candidate=applied.scene;effectiveEdit=applied.effectiveEdit;equal(effectiveEdit,await read(ar,`${s.index}/effective-edit.json`),'effective repair changed');
  }else candidate=applyPackageEdit(scene,response,task).scene;
  equal(candidate,await read(ar,`${s.index}/scene.json`),'candidate source changed');
  if(s.state==='accepted'){await accept(s,candidate,task);completed.push(task.id);critique=null;rejectedHashes=[];}
  else{if(result.accepted||result.feedback?.geometryPassed||result.feedback?.canAuthorizePlacement!==false)fail('rejected result relabelled');critique={rejectedSource:candidate,rejectedEdit:effectiveEdit,feedback:result.feedback};rejectedHashes.push(hash(candidate));}
 }
 equal(baseline.manifest.assetHash,assetHash,'last accepted asset changed');
 const task=ordered[completed.length];if(!task||task.id!==last.task)fail('no pending package');
 const correctionsUsed=records.filter(s=>s.task===task.id&&s.phase==='correct-component'&&!s.formatCorrectionOf).length;
 const pendingPackages=ordered.length-completed.length-1,minimumCalls=1+pendingPackages+1;
 if(authorizedNewCalls<minimumCalls)fail('remaining calls cannot fund required packages and final review');
 const automaticPolicy=componentCorrectionBudget(tier,records,{correctionsUsed,pendingPackages});
 const firstBudget={...automaticPolicy,automaticPolicy,canStart:true,stopReason:null,
  explicitlyAuthorizedContinuation:true,oneNewAttempt:true,authorizedNewCalls,minimumCalls,
  remainingAfterMandatory:authorizedNewCalls-minimumCalls,previousCorrectionsRetained:correctionsUsed,
  interpretation:'One explicitly authorized engineering continuation attempt. Historical corrections and failures remain counted. It may use spare recovery headroom, never calls reserved for every pending package and final review. No scope, geometry, token limit or total-call limit changes.'};
 return {sourceDirectory,assemblyRelative,job,plan,ordered,records,completed,scene,feedback,baselineStage,pendingTask:task.id,critique,rejectedHashes,correctionsUsed,formatCorrections:records.filter(s=>s.formatCorrectionOf).length,conceptReview,designContinuation:true,firstBudget,
  provenance:{version:1,kind:'design-component-v1',sourceJobId:job.id,sourceJobHash:jobHash,sourceAssetHash:assetHash,sourceHash:hash(scene),planHash:hash(plan),scopeHash:hash(frozen),acceptedStage:baselineStage,priorCalls:records.length,maximumCalls:tier.maximumCalls,remainingCalls:authorizedNewCalls,pendingTask:task.id,canAuthorizePlacement:false,firstBudget}};
}

export async function copyDesignContinuationEvidence(state,destination){
 const files=[];
 async function copy(relative,target){
  const from=path.join(state.sourceDirectory,relative),stat=await fs.lstat(from);if(stat.isSymbolicLink())fail('evidence links forbidden');
  if(stat.isDirectory()){await fs.mkdir(path.join(destination,target),{recursive:true});for(const n of await fs.readdir(from))await copy(relative+'/'+n,target+'/'+n);return;}
  if(!stat.isFile()||stat.size>64*1024*1024)fail('evidence file quota');
  const bytes=await safeEvidenceFile(state.sourceDirectory,relative,64*1024*1024);await fs.mkdir(path.dirname(path.join(destination,target)),{recursive:true});await fs.writeFile(path.join(destination,target),bytes,{flag:'wx'});files.push({path:target,sourcePath:relative,sha256:hash(bytes),bytes:bytes.length});
 }
 await copy(state.assemblyRelative,'assembly');await copy('assembly-journal','inherited-assembly-journal');
 for(const n of await fs.readdir(state.sourceDirectory))if(n==='native-evidence'||/^(?:codex|claude|deepseek)-response-[\w-]+$/.test(n))await copy(n,n);
 equal(await read(state.sourceDirectory,'job.json'),state.job,'original job changed during copy');return files;
}
