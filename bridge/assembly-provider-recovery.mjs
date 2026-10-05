import {setTimeout as delay} from 'node:timers/promises';
import {hash} from '../src/generation/compiler.mjs';
import {validateAssemblyProviderRecoveryPolicy} from '../contracts/assembly-provider-recovery.mjs';
import {verifyAssemblyCapacityReceipt} from './assembly-capacity-receipt.mjs';
import {assemblyProviderRecoveryBudget} from './assembly-provider-budget.mjs';

const controllers=new WeakSet(),digest=/^[a-f0-9]{64}$/;
const check=(ok,message)=>{if(!ok)throw Error('Bounded capacity recovery: '+message);};
export const isAssemblyProviderRecovery=value=>controllers.has(value);
export function stripAssemblyProviderRecovery(input){
  const {providerRetryOf,providerRecovery,...original}=input;return original;
}
// A later replay can contain more reservations than the original proof. Its
// immutable receipt identity still binds the original error, provider request,
// actual answer/images, model and job. The verifier ALWAYS checks the current
// complete ledger as well; this normalization does not waive that check.
export function assemblyCapacityReceiptIdentity(proof){
  const {proofHash,...content}=proof??{};
  check(digest.test(proofHash??'')&&hash(content)===proofHash&&proof.originalReceiptVerified===true&&
    proof.canAuthorizeRetry===false&&proof.canAuthorizePlacement===false&&proof.additionalModelCalls===0,
    'invalid read-only receipt proof');
  const {reservedCalls,dispatchedCalls,...immutable}=content;return hash(immutable);
}

/** Internal durable-stage execution controller. No HTTP fields, inferred
 * authority, alternate model or world writes. prepare() alone cannot dispatch;
 * a new call must complete the cancellable wait AND pass beforeInvocation()
 * immediately before its durable reservation. Existing calls are only read. */
export function createAssemblyProviderRecovery({directory,requestHash,runtimeHash,policy,model,effort,journal,
  signal,onRecovery=async()=>{},wait=delay}){
  if(!policy?.assembly?.providerRecovery)return null;
  const tier=policy.assembly,recovery=validateAssemblyProviderRecoveryPolicy(tier.providerRecovery);
  check(tier.workflow==='components'&&tier.recovery?.mode==='safe'&&tier.providerRetries===recovery.maximumRetries&&
    digest.test(requestHash??'')&&digest.test(runtimeHash??'')&&typeof model==='string'&&model.length>0&&
    typeof effort==='string'&&effort.length>0&&typeof journal?.peek==='function'&&typeof journal?.snapshot==='function'&&
    typeof signal?.throwIfAborted==='function'&&typeof onRecovery==='function'&&typeof wait==='function',
    'explicit durable new-task identity, selected model and effort required');
  const approvals=new Map(),validated=new Map();
  const verify=async a=>{
    const proof=await verifyAssemblyCapacityReceipt({directory,requestHash,runtimeHash,policy,model,effort,
      index:a.failedIndex,prompt:a.failedPrompt,options:a.failedOptions,error:a.error});
    check(proof&&assemblyCapacityReceiptIdentity(proof)===a.receiptHash,'original receipt changed before recovery');
    return proof;
  };
  const controller={
    async prepare({index,input,modelInput,prompt,options,error,packageIds,completedPackages,formatCorrectionsUsed}){
      signal.throwIfAborted();
      const proof=await verifyAssemblyCapacityReceipt({directory,index,prompt,options,requestHash,policy,runtimeHash,error,model,effort});
      if(!proof)return null;
      const snapshot=journal.snapshot();
      check(Number.isSafeInteger(index)&&index>=1&&snapshot[index-1]?.state==='error'&&
        snapshot.slice(0,index).every(r=>r.state!=='pending'),'unclosed prior invocation');
      const used=snapshot.slice(0,index).filter(r=>r.providerRetry!==undefined);
      check(used.every(r=>hash(r.providerRetry)===hash(validated.get(r.index)??null)),
        'prior recovery invocations have not been reconstructed and verified');
      const previous=input.providerRecovery,baseInput=stripAssemblyProviderRecovery(input),baseModel=stripAssemblyProviderRecovery(modelInput);
      check(previous===undefined||hash(previous)===hash(validated.get(index)??null),'unverified preceding recovery input');
      const originIndex=previous?.originIndex??index,originalFormats=previous?.originalFormatCorrectionsUsed??formatCorrectionsUsed;
      // Serialization of a plan/design edit retains its prepared callBudget,
      // including staged design corrections. Blueprint/role stages separately
      // recalculate their tails and must not borrow this exception. Derive the
      // origin from the CLOSED original format
      // receipt, never infer it from a remaining counter or refund a call.
      let originalBudgetCallIndex=previous?.budget.originalBudgetCallIndex??originIndex;
      const retainsPreparedBudget=tier.prototypes?.mode!=='staged'||['revise-design','correct-design'].includes(options.stageName);
      if(!previous&&retainsPreparedBudget&&baseInput.callBudget&&baseInput.formatCorrection){
        const formatIndex=baseInput.formatCorrection.stage,formatCall=snapshot[formatIndex-1];
        check(Number.isSafeInteger(formatIndex)&&formatIndex>=1&&formatIndex<index&&
          formatCall?.state==='error'&&formatCall.error?.completedFormat===true,
          'prepared format budget lacks its closed original serialization receipt');
        if(formatCall.providerRetry)check(hash(formatCall.providerRetry)===hash(validated.get(formatIndex)??null),
          'format correction refers to an unverified provider recovery');
        originalBudgetCallIndex=formatCall.providerRetry?.originIndex??formatIndex;
      }
      const modelText=JSON.stringify(modelInput);check(typeof prompt==='string'&&prompt.endsWith(modelText),'original model input suffix');
      const prefix=prompt.slice(0,-modelText.length),receiptHash=assemblyCapacityReceiptIdentity(proof);
      const budget=assemblyProviderRecoveryBudget({tier,phase:options.stageName,input:baseInput,reservedCalls:index,
        originalCallIndex:originIndex,originalBudgetCallIndex,providerRetriesUsed:used.length,formatCorrectionsUsed,
        originalFormatCorrectionsUsed:originalFormats,packageIds,completedPackages});
      if(previous)check(previous.originalInputHash===hash(baseInput)&&previous.originalModelInputHash===hash(baseModel)&&
        previous.promptPrefixHash===hash(prefix)&&previous.schemaHash===hash(options.outputSchema),
        'repeated recovery changed original stage semantics');
      const existing=journal.peek(index+1);
      if(!budget.canStart){
        check(!existing,'saved recovery violates the original protected-path budget');
        return {proof,budget,receiptHash,canContinue:false,additionalModelCalls:0,canAuthorizePlacement:false};
      }
      const marker={version:1,kind:'bounded-empty-codex-capacity',failedIndex:index,originIndex,ordinal:used.length+1,
        originalInputHash:hash(baseInput),originalModelInputHash:hash(baseModel),originalFormatCorrectionsUsed:originalFormats,
        promptPrefixHash:hash(prefix),schemaHash:hash(options.outputSchema),receiptHash,budget,
        waitMs:recovery.waitMs[used.length],canAuthorizePlacement:false};
      if(existing)check(hash(existing.providerRetry??null)===hash(marker),'saved recovery relationship changed');
      else check(journal.reserved===index&&proof.reservedCalls===index,'new recovery cannot skip existing reservations');
      const a={failedIndex:index,failedPrompt:prompt,failedOptions:structuredClone(options),error,
        receiptHash,marker,prefix,baseModel,existing:!!existing,waitCompleted:!!existing};
      approvals.set(index+1,a);
      return {proof,budget,receiptHash,marker,canContinue:true,existing:!!existing,
        input:{...baseInput,providerRetryOf:index,providerRecovery:marker},additionalModelCalls:0,canAuthorizePlacement:false};
    },
    async waitForRetry(index){
      const a=approvals.get(index);check(a,'recovery was not prepared');signal.throwIfAborted();
      await onRecovery({version:1,state:a.existing?'provider-capacity-replay':'provider-capacity-wait',
        failedIndex:a.failedIndex,nextIndex:index,ordinal:a.marker.ordinal,waitMs:a.existing?0:a.marker.waitMs,
        reservedCalls:journal.reserved,maximumCalls:tier.maximumCalls,additionalModelCalls:0,canAuthorizePlacement:false});
      if(!a.existing)await wait(a.marker.waitMs,undefined,{signal});
      signal.throwIfAborted();await verify(a);a.waitCompleted=true;
    },
    async beforeInvocation({prompt,index,options,saved}){
      signal.throwIfAborted();const a=approvals.get(index);
      check(a&&a.waitCompleted&&hash(options.providerRetry??null)===hash(a.marker),'missing completed recovery authorization');
      check(prompt===a.prefix+JSON.stringify({...a.baseModel,providerRetryOf:a.failedIndex,providerRecovery:a.marker})&&
        hash(options.outputSchema)===a.marker.schemaHash&&options.stageName===a.failedOptions.stageName&&
        options.stageCount===a.failedOptions.stageCount&&hash(options.images??[])===hash(a.failedOptions.images??[])&&
        hash(options.referenceInput??null)===hash(a.failedOptions.referenceInput??null),
        'recovery prompt, schema, phase or attachments changed');
      await verify(a);
      if(saved)check(hash(saved.providerRetry??null)===hash(a.marker),'original saved recovery metadata changed');
      else{
        check(!a.existing&&journal.reserved===a.failedIndex,'new recovery reservation count changed');
        check(a.marker.ordinal<=recovery.maximumRetries&&a.marker.budget.canStart===true&&
          a.marker.budget.reservedCalls===journal.reserved&&a.marker.budget.maximumCalls===tier.maximumCalls,
          'new recovery exceeded original budget or retry ceiling');
      }
      validated.set(index,structuredClone(a.marker));
    },
    isVerifiedCapacityRetry(failed,next){
      const marker=validated.get(next?.index);
      return !!marker&&failed?.index===marker.failedIndex&&failed.state==='failed'&&
        failed.invocationOutcome==='completed-empty-capacity'&&failed.capacityReceiptHash===marker.receiptHash&&
        next.providerRetryOf===failed.index&&next.providerRecoveryHash===hash(marker);
    }
  };
  controllers.add(controller);return controller;
}
