import {readFileSync} from 'node:fs';
import {exactKeys} from './world-selection.mjs';
import {contextHash} from '../src/world/context-snapshot.mjs';
import {supportedBlockStateCatalog} from '../src/generation/block-states.mjs';

const fixed=JSON.parse(readFileSync(new URL('./assembly-coupling-policy.json',import.meta.url),'utf8'));
exactKeys(fixed,['format','version','policy','beforePolicy','doorTargets','excludedTargetKinds','fullUpperFaceIds','partialUpperFaces','trapdoorSupport','coordinateTransform','canAuthorizePlacement'],'coupled policy');
if(fixed.format!=='AssemblyCouplingPolicy'||fixed.version!==1||fixed.policy!=='whole-native-new-special-blocks-v1'
  ||fixed.beforePolicy!=='legacy-static-protection-v1'||fixed.doorTargets!=='explicit-new-matching-pairs-only'
  ||JSON.stringify(fixed.excludedTargetKinds)!=='["leaves","light"]'||fixed.trapdoorSupport!=='no-attachment-requirement-vanilla-1.20.1'
  ||fixed.coordinateTransform!=='translate-only-original-W-min'||fixed.canAuthorizePlacement!==false)
  throw Error('Unsupported fixed coupled policy; no silent broadening');
exactKeys(fixed.partialUpperFaces,['stairs','slab'],'coupled upper-face policy');
if(JSON.stringify(fixed.partialUpperFaces.stairs)!=='["top"]'||JSON.stringify(fixed.partialUpperFaces.slab)!=='["top","double"]')throw Error('Unsupported coupled partial UP-face policy');
const catalog=new Set(supportedBlockStateCatalog().map(s=>s.id));
if(!Array.isArray(fixed.fullUpperFaceIds)||!fixed.fullUpperFaceIds.length||fixed.fullUpperFaceIds.length>4096
  ||fixed.fullUpperFaceIds.some((id,i)=>!catalog.has(id)||/(?:_door|_trapdoor|_leaves|_slab|_stairs)$/.test(id)||id==='minecraft:light'||i&&id<=fixed.fullUpperFaceIds[i-1]))
  throw Error('Fixed coupled UP-face IDs must be sorted, unique approved full-block candidates');
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const ASSEMBLY_COUPLING_POLICY=freeze(fixed);
export const ASSEMBLY_COUPLING_POLICY_HASH=contextHash(fixed);
