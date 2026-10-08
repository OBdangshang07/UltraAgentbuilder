import {parentPort,workerData} from 'node:worker_threads';
import {exactKeys} from '../contracts/world-selection.mjs';
import {readReferenceWorldAssemblyCandidate,readReferenceWorldAssemblyCandidatePart} from './reference-world-assembly.mjs';

// This worker receives paths ONLY from a prospective internal job owner.
// Never accept workerData or directories directly from an HTTP request.
try {
  const {operation,...input}=workerData;
  if (!['metadata','part'].includes(operation)) throw Error('Unknown read-only joint result operation');
  exactKeys(input,['directory','referenceInput','preparationHash','candidateHash',...(operation==='part'?['partIndex']:[])],'internal original joint result read');
  if (operation==='part') parentPort.postMessage({ok:true,result:await readReferenceWorldAssemblyCandidatePart(input)});
  else {
    const result=await readReferenceWorldAssemblyCandidate(input);
    parentPort.postMessage({ok:true,result:{candidate:result.candidate,patchSet:result.patchSet,
      originalCompleteSetReverified:true,additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false}});
  }
} catch {
  parentPort.postMessage({ok:false,error:'Original complete joint candidate failed read-only verification; no retry, model call or world write'});
}
