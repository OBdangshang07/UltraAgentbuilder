import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {assemblyCorrectionInput} from '../src/design/correction-feedback.mjs';
import {safeEvidenceFile,validateModelImageFiles} from './native-evidence.mjs';
import {assemblyInvocationFingerprint} from './assembly-invocation.mjs';
import {codexRequestFingerprint,checkCodexBinding} from './codex-persistent-receipt.mjs';
import {parseModelJson} from './model-json.mjs';
import {readJobReferenceInput} from './reference-generation-binding.mjs';
import {createAssemblyProviderRecovery,stripAssemblyProviderRecovery,assemblyCapacityReceiptIdentity} from './assembly-provider-recovery.mjs';
import {applyAssemblyBlueprint,applyPrototypeRoleEdit} from '../contracts/scene-decomposed-prototypes.mjs';
import {validateAssemblyPlan,applyAssemblyPlanEdit,applyAssemblyPlanRepair} from '../contracts/scene-assembly.schema.mjs';
import {decompositionTailBudget,decompositionRoleCorrectionBudget} from './assembly-decomposed-stages.mjs';
import {decompositionBlueprintBudget,decompositionConfiguration} from './assembly-decomposition-budget.mjs';
import {PROTOTYPE_ROLES} from '../contracts/scene-decomposition-roles.mjs';

const audits=new WeakSet(),digest=/^[a-f0-9]{64}$/;
const check=(ok,label)=>{if(!ok)throw Error('Provider recovery audit: '+label);};
const same=(a,b,label)=>check(hash(a)===hash(b),label);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const isAssemblyProviderRecoveryAudit=value=>audits.has(value);

/** READ ONLY original-task reconstruction. No journal opening/creation, delay,
 * provider/history request, compilation, replacement asset or world access.
 * The execution controller recomputes every marker against the original
 * receipts, but receives only inert journal reads. Its dispatch path is absent.
 * The opaque result, not a caller-supplied callback/boolean, may inform audits. */
export async function auditAssemblyProviderRecovery({directory,root,records,policy,requestHash,runtimeHash,model,effort,summary}){
  const enabled=!!policy?.assembly?.providerRecovery;
  check(Array.isArray(records),'original stage records required');
  if(!enabled){
    check(records.every(r=>r.providerRetryOf===undefined&&r.providerRecoveryHash===undefined&&
      r.capacityReceiptHash===undefined&&r.invocationOutcome!=='completed-empty-capacity'),
      'legacy policy cannot acquire recovery relationships');
    check(summary?.providerRecovery===undefined,'legacy summary invented recovery');return null;
  }
  const tier=policy.assembly;
  check(digest.test(requestHash??'')&&digest.test(runtimeHash??'')&&typeof model==='string'&&model.length&&
    typeof effort==='string'&&effort.length&&records.length<=tier.maximumCalls,'original job identity and budget required');
  directory=path.resolve(directory);root=path.resolve(root);
  check(await fs.realpath(directory)===directory&&await fs.realpath(root)===root&&
    root.startsWith(directory+path.sep)&&path.basename(root)==='assembly','original physical evidence root required');
  const pins=new Map();
  const bytes=async(base,file,limit=16*1024*1024)=>{
    const value=await safeEvidenceFile(base,file,limit),key=path.join(base,file);
    if(pins.has(key))same(hash(value),pins.get(key),'original file changed during audit');
    pins.set(key,hash(value));return value;
  };
  const read=async(base,file,limit)=>JSON.parse((await bytes(base,file,limit)).toString('utf8'));
  const envelope=async file=>{const e=await read(directory,file);check(digest.test(e.sha256??''),'journal digest');
    check(e.value&&typeof e.value==='object'&&!Array.isArray(e.value)&&hash(e.value)===e.sha256,'journal integrity');return e.value;};
  same(await envelope('assembly-journal/identity.json'),{version:1,requestHash,policyHash:hash(policy),runtimeHash,
    maximumCalls:tier.maximumCalls},'original policy, request, runtime or budget changed');
  const journalInventory=async()=>(await fs.readdir(path.join(directory,'assembly-journal'))).filter(n=>/^call-\d+\.json$/.test(n)).sort();
  const observationInventory=async()=>(await fs.readdir(directory)).filter(n=>/^codex-response-[\w-]{1,96}$/.test(n)).sort();
  const names=await journalInventory();
  check(names.length===records.length,'complete original journal/stage count required');
  const calls=[];
  for(const [i,r] of records.entries()){
    check(r.index===i+1,'stage order');const call=await envelope(`assembly-journal/call-${i+1}.json`);
    check(call.index===r.index&&['error','response','pending'].includes(call.state),'call order/state');calls.push(call);
  }
  const dispatched=await envelope('assembly-journal/dispatched.json');
  check(Number.isSafeInteger(dispatched.count)&&dispatched.count>=0&&dispatched.count<=calls.length&&
    calls.length<=dispatched.count+1&&(calls.length===dispatched.count||calls.at(-1)?.state==='pending'),
    'original dispatch/reservation ledger');
  const providerFolders=await observationInventory();
  check(providerFolders.length<=3*tier.maximumCalls,'private observation inventory');
  const observations=[];
  for(const folder of providerFolders){
    let receipt;try{receipt=await read(directory,folder+'/receipt.json');}catch(e){if(e.code!=='ENOENT')throw e;continue;}
    observations.push({folder,receipt});
  }
  const inputs=new Map(),invocations=new Map(),diagnostics=new Map(),recordPins=new Map(),relationships=[],formats=[],turns=new Set();
  const journal={get reserved(){return calls.length;},peek:index=>structuredClone(calls[index-1]??null),snapshot:()=>structuredClone(calls)};
  const controller=createAssemblyProviderRecovery({directory,policy,requestHash,runtimeHash,model,effort,journal,
    signal:new AbortController().signal,onRecovery:async()=>{throw Error('Audit cannot emit execution progress');},
    wait:async()=>{throw Error('Audit cannot wait or authorize a new invocation');}});
  let plan=null,prototypeState=null;const completed=new Set();let formatCount=0;
  for(const record of records){
    recordPins.set(record.index,hash(record));const index=record.index,call=calls[index-1];
    const input=await read(root,`${index}/input.json`),modelInput=await read(root,`${index}/model-input.json`),
      invocation=await read(root,`${index}/invocation.json`),options=invocation.options;
    same(modelInput,assemblyCorrectionInput(input),'canonical/model input differs');
    check(invocation.version===1&&typeof invocation.prompt==='string'&&invocation.prompt.endsWith(JSON.stringify(modelInput))&&
      options?.stageName===record.phase&&options.stageCount===tier.maximumCalls&&Array.isArray(options.images)&&
      options.outputSchema&&typeof options.outputSchema==='object','original private invocation');
    if(input.tier!==undefined)same(input.tier,tier,'stage policy changed');
    inputs.set(index,input);invocations.set(index,invocation);
    let images=options.images,referenceBindingHash;
    if(options.referenceInput!==undefined){
      check(images.length===0,'mixed reference/native attachments');
      const ref=await readJobReferenceInput({directory,input:options.referenceInput,model,runtimeHash});
      same(ref.preparation.policy,policy,'reference policy differs');images=ref.images;referenceBindingHash=ref.binding.bindingHash;
    }else await validateModelImageFiles(images,directory);
    const imageHashes=[];for(const file of images)imageHashes.push(hash(await bytes(directory,path.relative(directory,file),32*1024*1024)));
    const fingerprint=assemblyInvocationFingerprint({prompt:invocation.prompt,index,outputSchema:options.outputSchema,
      stageName:options.stageName,stageCount:options.stageCount,imageHashes:options.referenceInput?[]:imageHashes,
      referenceInput:options.referenceInput});check(fingerprint===call.fingerprint,'original invocation fingerprint changed');
    const providerHash=codexRequestFingerprint({prompt:invocation.prompt,model,effort,outputSchema:options.outputSchema,imageHashes,referenceBindingHash});
    const binding=call.providerBinding;
    if(binding?.turnId){
      checkCodexBinding(binding,providerHash);check(binding.model===model&&binding.effort===effort,'model/effort changed');
      const turnKey=binding.threadId+'/'+binding.turnId;check(!turns.has(turnKey),'provider turn reused by another reservation');turns.add(turnKey);
    }
    let diagnostic=null;
    if(call.state==='error')diagnostic=call.error?.diagnostic;
    else if(call.state==='response'){
      const candidates=observations.filter(o=>o.receipt.provider==='codex'&&o.receipt.reason==='completed'&&
        o.receipt.threadId===binding?.threadId&&o.receipt.turnId===binding?.turnId&&o.receipt.requestHash===providerHash&&o.receipt.failureKind===null);
      check(candidates.length>0,'original completed provider receipt missing');
      for(const candidate of candidates){const raw=await bytes(directory,candidate.folder+'/answer-1.txt',2*1024*1024),parsed=parseModelJson(raw.toString('utf8'));
        check(parsed.facts.valid,'original completed answer is not valid JSON');same(parsed.spec,call.response,'closed original answer differs from journal');}
      diagnostic=candidates.at(-1).receipt;
    }
    if(diagnostic?.responseEvidence?.persisted){
      const evidence=diagnostic.responseEvidence;check(/^codex-response-[\w-]{1,96}$/.test(evidence.directory)&&evidence.file==='answer-1.txt',
        'unsafe original response evidence');
      same(await read(directory,evidence.directory+'/receipt.json'),diagnostic,'private provider receipt changed');
      const raw=await bytes(directory,evidence.directory+'/'+evidence.file,2*1024*1024);
      check(raw.length===diagnostic.receivedTextBytes&&hash(raw)===diagnostic.receivedTextSha256,'raw original answer changed');
      if(binding?.turnId)for(const key of ['threadId','turnId','requestHash'])check(diagnostic[key]===binding[key],'diagnostic turn differs');
      const request=await read(directory,evidence.directory+'/request.json');
      check(request.provider==='codex'&&request.version===1&&request.model===model&&request.effort===effort&&request.requestHash===providerHash,
        'private original request changed');
      await read(directory,evidence.directory+'/thread.json');await read(directory,evidence.directory+'/turn.json');
      if(diagnostic.json){
        same(await read(directory,evidence.directory+'/json-validation.json'),diagnostic.json,'original JSON facts changed');
        const candidate=await bytes(directory,evidence.directory+'/candidate.txt',2*1024*1024);
        check(hash(raw)===diagnostic.json.originalSha256&&hash(candidate)===diagnostic.json.candidateSha256,'original serialization evidence changed');
      }
    }else check(call.state==='pending'||call.state==='error'&&diagnostic?.reason==='not-submitted','closed original response evidence missing');
    diagnostics.set(index,diagnostic);
    if(record.responseReceived){check(call.state==='response','stage invented a response');
      same(await read(root,`${index}/response.json`),call.response,'saved original response replaced');}
    else check(call.state!=='response','journal response omitted from stage');
    if(input.providerRecovery!==undefined||record.providerRetryOf!==undefined||call.providerRetry!==undefined){
      const failed=records[index-2];check(failed&&failed.index===input.providerRetryOf&&record.providerRetryOf===failed.index,
        'recovery lacks its immediate original failure');
      same(options.providerRetry,input.providerRecovery,'invocation recovery marker changed');
      check(record.providerRecoveryHash===hash(input.providerRecovery),'stage recovery marker changed');
      await controller.beforeInvocation({prompt:invocation.prompt,index,options,saved:call});
      check(controller.isVerifiedCapacityRetry(failed,record),'unverified capacity relationship');
      relationships.push({retryIndex:index,failedIndex:failed.index,originIndex:input.providerRecovery.originIndex,
        ordinal:input.providerRecovery.ordinal,receiptHash:input.providerRecovery.receiptHash,markerHash:hash(input.providerRecovery),
        budgetHash:hash(input.providerRecovery.budget)});
    }else check(options.providerRetry===undefined&&record.providerRecoveryHash===undefined,'orphan recovery metadata');
    if(input.formatCorrection&&input.providerRecovery===undefined){
      const originalIndex=input.formatCorrection.stage,original=calls[originalIndex-1],originalRecord=records[originalIndex-1],
        previous=inputs.get(originalIndex),oldInvocation=invocations.get(originalIndex);
      check(originalIndex===index-1&&original?.state==='error'&&original.error?.completedFormat===true&&
        originalRecord.invocationOutcome==='completed-invalid-json','format correction lacks its closed original failure');
      const d=diagnostics.get(originalIndex);check(d?.reason==='completed'&&d.failureKind==='answer-json'&&
        input.formatCorrection.originalText===original.error.responseText&&hash(input.formatCorrection.originalText)===d.receivedTextSha256,
        'format correction changed original text');same(input.formatCorrection.parseFacts,original.error.parseFacts,'format correction changed original facts');
      const {formatCorrection,...current}=stripAssemblyProviderRecovery(input),base=stripAssemblyProviderRecovery(previous);
      if(input.decompositionBudget){
        base.decompositionBudget=decompositionTailBudget(tier,records.slice(0,index-1),base.decompositionBudget.requiredAfterCall);
        if(base.prototypeCorrectionBudget)base.prototypeCorrectionBudget=decompositionRoleCorrectionBudget(tier,records.slice(0,index-1),base.prototypeCorrectionBudget);
        if(['assembly-blueprint','correct-blueprint'].includes(record.phase)){
          base.callBudget=decompositionBlueprintBudget(decompositionConfiguration(tier),{reservedCalls:index-1,
            completedCandidates:tier.prototypes.candidateCount,selectionAccepted:true,...(tier.referenceAnalysis?{completedPrelude:1}:{})});
          check(base.callBudget.maximumPackages===previous.callBudget.maximumPackages,'format correction shrank original packages');
        }
      }
      same(current,base,'format correction changed original prepared scope');same(options.outputSchema,oldInvocation.options.outputSchema,'format correction schema changed');
      same(options.images,oldInvocation.options.images,'format correction changed native images');same(options.referenceInput??null,oldInvocation.options.referenceInput??null,'format correction changed reference input');
      check(++formatCount<=tier.maximumFormatCorrections,'serialization correction limit exceeded');formats.push({originalIndex,correctionIndex:index,originalTextSha256:d.receivedTextSha256});
    }
    if(call.state==='error'){
      const error=Object.assign(Error(call.error.message),{diagnostic:call.error.diagnostic});
      const recovered=await controller.prepare({index,input,modelInput,prompt:invocation.prompt,options,error,
        packageIds:plan?.packages.map(p=>p.id)??[],completedPackages:[...completed],formatCorrectionsUsed:formatCount});
      if(recovered){
        check(record.state==='failed'&&record.invocationOutcome==='completed-empty-capacity'&&record.capacityReceiptHash===recovered.receiptHash,
          'original capacity failure was hidden or rebound');
        const saved=await read(root,`${index}/provider-recovery.json`);
        // existing is a replay observation, not immutable retry authority.
        const {existing:oldExisting,proof:oldProof,...old}=saved,{existing:newExisting,proof:newProof,...fresh}=recovered;
        same(old,fresh,'saved original recovery decision changed');
        check(assemblyCapacityReceiptIdentity(oldProof)===assemblyCapacityReceiptIdentity(newProof)&&
          Number.isSafeInteger(oldProof.reservedCalls)&&oldProof.reservedCalls>=index&&oldProof.reservedCalls<=calls.length&&
          Number.isSafeInteger(oldProof.dispatchedCalls)&&oldProof.dispatchedCalls>=index&&oldProof.dispatchedCalls<=oldProof.reservedCalls,
          'original recovery proof ledger prefix changed');
      }else check(record.invocationOutcome!=='completed-empty-capacity'&&record.capacityReceiptHash===undefined,'ordinary failure claimed capacity proof');
    }
    if(record.state==='accepted'&&record.responseReceived){
      let response=call.response;
      if(['plan','correct-plan','repair-plan','revise-design','correct-design'].includes(record.phase)){
        if(response.format==='ScenePrototypePlan')response=response.plan;
        else if(response.format==='ScenePrototypePlanEdit')response=response.edit;
        else if(response.format==='ScenePrototypePlanRepair')response=response.repair;
        if(response.format==='SceneAssemblyPlan'){validateAssemblyPlan(response,tier);plan=response;}
        else if(response.format==='SceneAssemblyPlanRepair')plan=applyAssemblyPlanRepair(input.priorPlan,response,tier).plan;
        else plan=applyAssemblyPlanEdit(input.priorPlan,response,tier,{designReview:['revise-design','correct-design'].includes(record.phase)}).plan;
      }else if(['assembly-blueprint','correct-blueprint'].includes(record.phase)){
        prototypeState=applyAssemblyBlueprint(input.selectedConcept.selected,response,{...tier,maxPackages:input.callBudget.maximumPackages});
      }else if(['prototype-role','correct-prototype-role'].includes(record.phase)){
        prototypeState=applyPrototypeRoleEdit(prototypeState,response,tier);
        // runSceneAssembly receives the outer plan only after the entire
        // decomposition prelude returns. Role-local package scopes exist
        // earlier, but must not be invented as controller state at a failure.
        if(prototypeState.completedRoles.length===PROTOTYPE_ROLES.length)plan=prototypeState.plan;
      }
      if(['component','correct-component'].includes(record.phase)&&!input.refinement){
        check(plan?.packages.some(p=>p.id===record.task)&&!completed.has(record.task),'invented/duplicate completed package');completed.add(record.task);
      }
    }
  }
  const expectedSummary={version:1,mode:'bounded',provider:'codex',maximumRetries:tier.providerRetries,retriesReserved:relationships.length,
    failedCapacityCalls:records.filter(r=>r.invocationOutcome==='completed-empty-capacity').length,
    allFailedReservationsRetained:true,unknownOutcomeRetries:0,additionalAuthority:false,canAuthorizePlacement:false};
  if(summary){same(summary.providerRecovery,expectedSummary,'final recovery summary changed');
    check(summary.reservedCalls===calls.length&&summary.maximumCalls===tier.maximumCalls,'final budget changed');}
  const stagesHash=hash(records);
  const verifyUnchanged=async()=>{
    same(await journalInventory(),names,'original reservation inventory changed');
    same(await observationInventory(),providerFolders,'original provider observation inventory changed');
    check(hash(records)===stagesHash,'original stage records changed');
    for(const [file,value] of pins)check(hash(await safeEvidenceFile(directory,path.relative(directory,file),32*1024*1024))===value,
      'original evidence changed after recovery audit');
  };
  await verifyUnchanged();
  const reportData={version:1,kind:'read-only-assembly-provider-recovery-audit',requestHash,runtimeHash,policyHash:hash(policy),
    stagesHash,maximumCalls:tier.maximumCalls,reservedCalls:calls.length,dispatchedCalls:dispatched.count,
    allReservedCallsClosed:calls.every(c=>c.state!=='pending')&&dispatched.count===calls.length,
    relationships,formatCorrections:formats,summary:expectedSummary,originalFilesVerified:pins.size,
    additionalModelCalls:0,worldWrites:0,canAuthorizeRetry:false,canAuthorizePlacement:false};
  const result={report:freeze({...reportData,auditHash:hash(reportData)}),
    isVerifiedCapacityRetry:(failed,next)=>recordPins.get(failed?.index)===hash(failed)&&recordPins.get(next?.index)===hash(next)&&controller.isVerifiedCapacityRetry(failed,next),
    preparedStageIndex:record=>{check(recordPins.get(record?.index)===hash(record),'stage differs from audited record');
      return inputs.get(record.index).providerRecovery?.originIndex??record.index;},
    inputVerified:(record,input)=>recordPins.get(record?.index)===hash(record)&&hash(inputs.get(record.index))===hash(input),
    inputAt:index=>{check(inputs.has(index),'unknown audited stage');return structuredClone(inputs.get(index));},
    isProviderRetryIndex:index=>relationships.some(r=>r.retryIndex===index),
    isProviderRetry:record=>recordPins.get(record?.index)===hash(record)&&relationships.some(r=>r.retryIndex===record.index),
    diagnosticFor:index=>structuredClone(diagnostics.get(index)??null),
    verifyUnchanged};
  audits.add(result);return Object.freeze(result);
}
