import {hash} from '../src/generation/compiler.mjs';

// Separately opted-in NEW task policy. Never upgrade a frozen v2-v5 journal.
const policy=Object.freeze({version:1,mode:'expanded-routes-v1',
 seed:'cells-and-owners',expanded:'cells-owners-and-established-routes',
 noRecipes:'cells-owners-and-established-routes',canAuthorizePlacement:false});
export const prototypeValidationPolicy=()=>structuredClone(policy);
export function expandedPrototypeRoutesEnabled(tier){
 const p=tier?.prototypes;
 if(p?.version!==6){
  if(p?.validation!==undefined)throw Error('Legacy prototype policy cannot acquire expanded-route validation');
  return false;
 }
 if(p.mode!=='staged'||tier.id!=='ultra'||tier.quality?.version!==4||tier.designReview?.mode!=='native'||
  tier.recovery?.mode!=='safe'||hash(p.validation??null)!==hash(policy))throw Error('Invalid expanded-route prototype policy');
 return true;
}
export const PROTOTYPE_SEED_SCOPE_INSPECTION='prototype-seed-scope-v1';
export const EXPANDED_PROTOTYPE_ROUTE_RULES=`PROTOTYPE VALIDATION V6: the seed is an intermediate, unplaceable study. With explicit recipes its actual cells, bounds, owners, reservations and package regions are checked BEFORE full expansion; established whole-building passage/stair routes are compared only AFTER ALL recipes expand, against the previous checked FULL building. This permits converting a task-owned repeated opening to one real seed plus a matching explicit recipe without wrongly treating the temporary seed as the finished whole building. Every previously checked route must still survive the full expansion. A missing/short/wrong recipe is not permission to remove upper-floor access; preserve the original floors, openings, support and interfaces in the expanded result. Nonrepeated features need no recipe and retain normal full package checks when no recipes exist. Other roles' recipes and owners remain frozen. Neither seed acceptance nor expansion is visual approval, world authority or a call-budget increase.`;
