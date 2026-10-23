import {supportedBlockStateCatalog} from '../generation/block-states.mjs';
import {validateContextSnapshot,contextHash} from './context-snapshot.mjs';
import {prepareAssemblyWorldContext,assemblyWorldContextData,WORLD_ASSEMBLY_RULES} from './assembly-context.mjs';
import {compileCoupledAssemblyPlan} from './assembly-coupled-plan.mjs';
import {ASSEMBLY_COUPLING_POLICY,ASSEMBLY_COUPLING_POLICY_HASH} from '../../contracts/assembly-coupling-policy.mjs';

// An explicitly different opaque design context. It does not upgrade old SEND,
// candidate, preview, native lease or placement rights. No HTTP caller can
// switch modes by copying these fields into a legacy JSON document.
const originals=new WeakMap();
const freeze=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};
const staticRule='The current static patch policy rejects unsupported coupled/dynamic states or unsafe neighbors; separate new-building special-block support does not waive it.';
const coupledRule='This EXPLICIT whole-native coupling policy permits only the supplied targetCatalog and fixed couplingPolicy. New doors must have both matching lower/upper halves at the same x/z and exactly adjacent y, inside W, with identical facing, hinge, open and powered properties. The lower needs a complete final UP support face from an admitted full block, top/double slab or top stair. A door or trapdoor is not a door support. Keep all targets dry and unpowered. Trapdoors have no invented attachment requirement in this 1.20.1 policy. Stair shape/facing/half and slab type must remain explicit canonical states. Leaves and light targets remain excluded. Existing coupled BEFORE blocks and unsafe original six-neighbors remain protected; this is NOT general editing of existing doors. ALL native groups are checked as a whole before any provisional part is usable. A part, one half, preview or model approval is never an independent apply scope or world-write permission. Do not omit requested design/functions to evade these rules; report an unresolved constraint honestly.';
export const COUPLED_ASSEMBLY_GENERATION_RULES=WORLD_ASSEMBLY_RULES.replace(staticRule,coupledRule);
const catalog=freeze(supportedBlockStateCatalog().filter(row=>!row.id.endsWith('_leaves')&&!['minecraft:light','minecraft:air'].includes(row.id)));
export const COUPLED_ASSEMBLY_GENERATION_PROTOCOL_HASH=contextHash({format:'CoupledAssemblyGenerationProtocol',version:1,
  rules:COUPLED_ASSEMBLY_GENERATION_RULES,targetCatalog:catalog,couplingPolicyHash:ASSEMBLY_COUPLING_POLICY_HASH});

export function prepareCoupledAssemblyWorldContext(snapshotValue,{signal}={}){
  // A future rule edit must fail THIS new mode's preparation, not prevent an
  // unchanged legacy task from loading the common generation module.
  if(!WORLD_ASSEMBLY_RULES.includes(staticRule))throw Error('Explicit coupled generation rule must be reviewed when legacy common rules change');
  signal?.throwIfAborted();const snapshot=validateContextSnapshot(snapshotValue),base=assemblyWorldContextData(prepareAssemblyWorldContext(snapshot,{signal}));
  const {format,version,worldContextHash,targetCatalog,protocolHash,...evidence}=base;
  const content={format:'CoupledAssemblyWorldContext',version:1,...evidence,
    baselineEvidenceProtocolHash:protocolHash,targetCatalog:catalog,protocolHash:COUPLED_ASSEMBLY_GENERATION_PROTOCOL_HASH,
    couplingPolicy:structuredClone(ASSEMBLY_COUPLING_POLICY),couplingPolicyHash:ASSEMBLY_COUPLING_POLICY_HASH,
    candidateProtocol:'new-complete-coupled-native-only',legacyConsentTransferable:false};
  if(Buffer.byteLength(JSON.stringify(content))>8*1024**2)throw Error('Complete coupled context byte quota; no baseline truncation');
  signal?.throwIfAborted();const result=freeze({...content,worldContextHash:contextHash(content)});originals.set(result,snapshot);return result;
}
export function coupledAssemblyWorldContextData(context){
  if(!originals.has(context))throw Error('Original opaque coupled design context required');return structuredClone(context);
}
/** The common generation lane selects rules by the actual original brand,
 * never an HTTP flag, JSON format string, downloaded hash or target palette. */
export function assemblyGenerationContext(context){
  return originals.has(context)?{data:coupledAssemblyWorldContextData(context),rules:COUPLED_ASSEMBLY_GENERATION_RULES}
    :{data:assemblyWorldContextData(context),rules:WORLD_ASSEMBLY_RULES};
}
export function compileCoupledAssemblyContextPlan(context,native,options){
  const snapshot=originals.get(context);if(!snapshot)throw Error('Original coupled design context required before whole lowering');
  return compileCoupledAssemblyPlan(snapshot,native,options);
}
