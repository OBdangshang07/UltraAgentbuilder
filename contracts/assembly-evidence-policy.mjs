import {hash} from '../src/generation/compiler.mjs';

// NEW request opt-in, separate from the unchanged quality V2/V3/V4 contract.
// The first expanded asset chooses cameras; later revisions never change them.
const policy=Object.freeze({version:1,mode:'representative-v1',
 floorBasis:'saved-staged-geometry',comparisonCameras:'fixed-first-expanded',
 missingRepresentative:'disclose',canAuthorizePlacement:false});
export const assemblyEvidencePolicy=()=>structuredClone(policy);
export function representativeEvidenceEnabled(tier){
 if(tier?.cameraEvidence===undefined)return false;
 if(hash(tier.cameraEvidence)!==hash(policy)||tier.id!=='ultra'||tier.prototypes?.mode!=='staged'||tier.prototypes.version!==5||
  tier.quality?.version!==4||tier.designReview?.mode!=='native'||tier.recovery?.mode!=='safe')
  throw Error('Representative evidence requires the exact new staged native v4 policy');
 return true;
}
