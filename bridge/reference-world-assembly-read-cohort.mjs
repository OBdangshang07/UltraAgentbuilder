import {hash} from '../src/generation/compiler.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../contracts/world-assembly-limits.mjs';

// PRIVATE owner/worker transport, never an HTTP input, on-disk certificate or
// world permission. One bounded, short-lived cohort holds only a previously
// fully rebuilt candidate's proof pins. Every warm read still reads/hashes ALL
// original evidence and ALL candidate members; no stat/mtime cache is used.
export const JOINT_READ_COHORT_LIMITS=Object.freeze({entries:1,
  bytes:WORLD_ASSEMBLY_LIMITS.metadataBytes*2,lifetimeMs:5*60*1000});
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export function jointReadCohortKey(operation,id,payload) {
  if(!['metadata','part'].includes(operation))return null;
  try{
    const {referenceInput,preparationHash,candidateHash}=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
    if(!referenceInput||!preparationHash||!candidateHash)return null;
    return hash({id,referenceInput,preparationHash,candidateHash});
  }catch{return null;}
}

/** Only the resource owner's ORIGINAL normally-exited full-verifier worker
 * may seed this state. A caller payload or cached disk file cannot seed it. */
export class JointReadCohort {
  #current=null;
  acquire(key,now=Date.now()) {
    const current=this.#current;
    if(!current)return null;
    if(!Number.isSafeInteger(now)||now<current.at||now-current.at>=JOINT_READ_COHORT_LIMITS.lifetimeMs){this.clear();return null;}
    return key===current.key?current.value:null;
  }
  accept(key,receipt,now=Date.now()) {
    if(!key||receipt?.key!==key||receipt?.kind!=='original-complete-rebuild'
      ||!receipt.candidate||!receipt.patchSet||!Number.isSafeInteger(now)||now<0
      ||Buffer.byteLength(JSON.stringify(receipt))>JOINT_READ_COHORT_LIMITS.bytes)
      throw Error('Exact bounded original full-verifier cohort required');
    const {candidateHash,...candidate}=receipt.candidate;
    const {patchSetHash,...patchSet}=receipt.patchSet;
    if(candidateHash!==hash(candidate)||patchSetHash!==hash(patchSet)
      ||receipt.candidate.patchSetHash!==patchSetHash
      ||receipt.candidate.partCount!==receipt.patchSet.partCount
      ||receipt.candidate.operationCount!==receipt.patchSet.operationCount)
      throw Error('Original full-verifier cohort identities differ');
    // Own the worker receipt before it can be observed/mutated by its caller.
    this.#current={key,at:now,value:freeze(structuredClone(receipt))};
  }
  clear(){this.#current=null;}
}
