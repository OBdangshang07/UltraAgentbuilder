import {hash} from '../src/generation/compiler.mjs';

// Explicit NEW-task scheduling only. Never upgrade saved policies or derive
// additional model authority from a failed task, a receipt or a UI counter.
const policy=Object.freeze({version:1,mode:'design-correction-v1',designCorrections:1,
 newTaskOnly:true,increaseCallLimit:false,shrinkRequiredScope:false,canAuthorizePlacement:false});
export const assemblyCompletionReservePolicy=()=>structuredClone(policy);
export function stagedDesignCorrectionReserve(tier){
 if(tier?.completionReserve===undefined)return 0;
 const value=tier.completionReserve;
 if(!value||typeof value!=='object'||Array.isArray(value)||
  ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).length!==Object.keys(policy).length)throw Error('Invalid staged completion reserve');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(const key of Object.keys(policy))if(!descriptors[key]?.enumerable||!Object.hasOwn(descriptors[key],'value')||descriptors[key].value!==policy[key])throw Error('Invalid staged completion reserve');
 if(hash(value)!==hash(policy)||tier.id!=='ultra'||tier.prototypes?.mode!=='staged'||
  ![5,6].includes(tier.prototypes.version)||tier.recovery?.mode!=='safe'||tier.quality?.version!==4||tier.designReview?.mode!=='native'||
  tier.prototypes.roleCorrections?.version!==2||tier.prototypes.roleCorrections.mode!=='tail-funded-through-review'||
  tier.prototypes.roleCorrections.reservedTailCorrections!==2)throw Error('Invalid staged completion reserve');
 return policy.designCorrections;
}
