import {hash} from '../src/generation/compiler.mjs';

// A new explicit authority contract, not a migration of existing task policies.
// It is not yet exposed by preflight/UI. Defining it does not dispatch retries.
const policy=Object.freeze({version:1,mode:'bounded',provider:'codex',maximumRetries:2,
  waitMs:Object.freeze([10000,30000]),unknownOutcomeRetries:0,partialOutputRetries:0,
  increaseCallLimit:false,changeModel:false,refundFailedCalls:false,shrinkRequiredScope:false});
export function assemblyProviderRecoveryPolicy(){return structuredClone(policy);}
export function validateAssemblyProviderRecoveryPolicy(value){
  // Reject non-JSON authority as well as different values. Hash equality alone
  // does not reject extra array properties, symbols or inherited options.
  const fields=Object.keys(policy),plain=value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const keys=plain?Reflect.ownKeys(value):[];
  const ownData=plain&&keys.length===fields.length&&keys.every(key=>fields.includes(key)&&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')&&Object.getOwnPropertyDescriptor(value,key).enumerable);
  if(!ownData)throw Error('Unsupported explicit assembly provider recovery policy');
  const wait=value.waitMs,waitKeys=Array.isArray(wait)?Reflect.ownKeys(wait):[];
  const exactWait=Array.isArray(wait)&&Object.getPrototypeOf(wait)===Array.prototype&&waitKeys.length===3&&
    waitKeys.every(key=>['0','1','length'].includes(key))&&['0','1'].every(key=>{
      const descriptor=Object.getOwnPropertyDescriptor(wait,key);return descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.enumerable;
    });
  if(!exactWait||fields.some(key=>key!=='waitMs'&&value[key]!==policy[key])||hash(value)!==hash(policy))
    throw Error('Unsupported explicit assembly provider recovery policy');
  return structuredClone(policy);
}
