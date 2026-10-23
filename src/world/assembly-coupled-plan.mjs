import {LIMITS} from '../generation/compiler.mjs';
import {analyzeAssemblyCoupling} from './assembly-coupling.mjs';
import {validateContextSnapshot, readSnapshotCell, readSnapshotBlockFact, contextHash} from './context-snapshot.mjs';
import {comparePatchPoints} from '../../contracts/world-patch.mjs';
import {WORLD_ASSEMBLY_LIMITS} from '../../contracts/world-assembly-limits.mjs';
import {ASSEMBLY_COUPLING_POLICY,ASSEMBLY_COUPLING_POLICY_HASH} from '../../contracts/assembly-coupling-policy.mjs';

// New whole-plan protocol. A legacy patch/part, JSON report or matching hashes
// cannot construct the private compiler input or obtain application authority.
export const COUPLED_ASSEMBLY_POLICY = ASSEMBLY_COUPLING_POLICY.policy;
export const COUPLED_EXECUTION_ORDER = 'native-order-promote-matching-upper-after-lower';
const originals = new WeakMap();
const partOwners = new WeakMap();
const directions = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
const air = state => ['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(state);
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
function original(plan) {
  const input = originals.get(plan);
  if (!input) throw Error('Original complete coupled plan required; JSON/part/hash cannot grant scope');
  return input;
}
function* changes(input, signal) {
  const {snapshot,bytes,manifest} = input, {width:w,height:h,length:d} = manifest.dimensions, origin = snapshot.selection.edit.min;
  for (let i=0;i<w*h*d;i++) {
    if (!(i%1024)) signal?.throwIfAborted();
    const n=bytes.readUInt16LE(i*2); if (!n) continue;
    const position=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d].map((n,axis)=>n+origin[axis]);
    const before=readSnapshotCell(snapshot,position),after=manifest.palette[n];
    // The original complete analysis already verified known W-P and all six
    // neighbors. Re-read only owned, immutable source data, never a new capture.
    if(before.coverage!=='known')throw Error('Original coupled native change lost known BEFORE');
    if(before.state===after||n===1&&air(before.state))continue;
    yield {nativeIndex:i,position,before:before.state,after,action:n===1?'clear':'set',
      difference:air(before.state)?'added':air(after)?'removed':'replaced'};
  }
}

/** Compile complete pairing, sparse execution order and original identity.
 * Keep O(door-pairs), not O(volume) scheduling data. Provisional transport parts
 * never validate alone, and the schedule is not permission to write a world. */
export function compileCoupledAssemblyPlan(snapshotValue,native,{signal}={}) {
  signal?.throwIfAborted();
  const snapshot=validateContextSnapshot(snapshotValue);
  if(!(native?.binary instanceof Uint8Array))throw Error('Original native bytes required');
  const {width:w,height:h,length:d}=native.manifest?.dimensions??{};
  if(![w,h,d].every(n=>Number.isSafeInteger(n)&&n>0)||w>LIMITS.width||h>LIMITS.height||d>LIMITS.length
    ||w*h*d>LIMITS.cells||native.binary.byteLength!==w*h*d*2)throw Error('Bounded exact native dimensions required before coupled allocation');
  // Analyze an OWNED snapshot of the caller's bytes/manifest. The analysis
  // enforces native dimension/allocation, palette, scope and support quotas.
  const manifest=structuredClone(native.manifest),bytes=Buffer.from(native.binary);
  const analysis=analyzeAssemblyCoupling(snapshot,{manifest,binary:bytes},{signal});
  const input={snapshot,manifest,bytes},wanted=new Map(),ranks=new Map();
  for(const group of analysis.groups)for(const index of group.indices)wanted.set(index,group);
  let count=0;
  for(const write of changes(input,signal)){if(wanted.has(write.nativeIndex))ranks.set(write.nativeIndex,count);count++;}
  if(count!==analysis.operationCount)throw Error('Complete coupled operation count changed');
  const pairs=[];
  for(const group of analysis.groups){
    const indices=group.indices.map(index=>ranks.get(index));
    if(indices.every(index=>index===undefined))continue; // An unchanged original pair is KEEP, never an edit.
    if(indices.some(index=>index===undefined)||indices[0]>=indices[1])throw Error('A changed door must remain one complete ordered pair');
    pairs.push({nativeIndices:[...group.indices],operationIndices:indices,positions:structuredClone(group.positions),
      states:[...group.states],support:structuredClone(group.support)});
  }
  const schedule={rule:COUPLED_EXECUTION_ORDER,operationCount:count,pairs:pairs.map(pair=>pair.operationIndices)};
  const content={format:'AssemblyCoupledPlan',version:1,policy:COUPLED_ASSEMBLY_POLICY,policyHash:ASSEMBLY_COUPLING_POLICY_HASH,
    snapshotHash:snapshot.snapshotHash,selectionHash:snapshot.selectionHash,assetHash:manifest.assetHash,cellsHash:manifest.cellsHash,
    analysisHash:analysis.analysisHash,origin:[...snapshot.selection.edit.min],dimensions:structuredClone(manifest.dimensions),
    operationCount:count,pairCount:pairs.length,pairs,scheduleHash:contextHash(schedule),executionOrder:COUPLED_EXECUTION_ORDER,
    partScope:'transport-only-complete-plan-required',omittedCells:'keep',existingCoupledBeforeWritesAllowed:false,
    serverBaselineVerified:false,physicsVerified:false,canAuthorizePlacement:false,worldWrites:0};
  if(Buffer.byteLength(JSON.stringify(content))+128>WORLD_ASSEMBLY_LIMITS.metadataBytes)throw Error('Complete coupled plan metadata quota; no truncated pair list');
  signal?.throwIfAborted();
  const plan=freeze({...content,planHash:contextHash(content)});originals.set(plan,input);return plan;
}

export function coupledAssemblyPlanData(plan) {original(plan);return structuredClone(plan);}
/** Internal read-only preview source, not a server attestation or consent. */
export function coupledAssemblyPreviewBinding(plan){
  const {snapshot}=original(plan);
  return freeze({world:structuredClone(snapshot.selection.world),selectionRevision:snapshot.selection.revision,
    contextRevision:snapshot.fence.end,couplingPlanHash:plan.planHash,couplingPolicyHash:plan.policyHash});
}
export function checkedCoupledAssemblyPart(plan,value){
  original(plan);
  if(partOwners.get(value)!==plan)throw Error('Original complete-plan part required; JSON/hash is not a verified part');
  return value;
}
export function validateCoupledAssemblyPlan(snapshot,native,value,options) {
  const rebuilt=compileCoupledAssemblyPlan(snapshot,native,options);
  if(contextHash(rebuilt)!==contextHash(value))throw Error('Saved coupled plan differs from complete original native/source');
  return rebuilt;
}

/** Groups reference original native-order operation indices, NOT part offsets.
 * An executor/journal must keep a pair in ONE synchronous, durably-intended
 * group, including cancellation, failure and inverse/undo. This generator does
 * not itself implement an executor or prove that a server follows that rule. */
export function* coupledAssemblyExecutionGroups(plan,{signal}={}) {
  original(plan);
  const lower=new Map(plan.pairs.map(pair=>[pair.operationIndices[0],pair.operationIndices]));
  const upper=new Set(plan.pairs.map(pair=>pair.operationIndices[1]));let offset=0;
  for(let i=0;i<plan.operationCount;i++){
    if(!(i%1024))signal?.throwIfAborted();
    if(upper.has(i))continue;
    const indices=lower.get(i)??[i];
    yield freeze({offset,kind:indices.length===2?'door-pair':'single',operationIndices:[...indices],canAuthorizePlacement:false});
    offset+=indices.length;
  }
  signal?.throwIfAborted();
  if(offset!==plan.operationCount)throw Error('Complete coupled schedule omitted operations');
}

function part(input,plan,writes,index,offset,signal) {
  const guards=new Map();
  function guard(position,role){
    const key=position.join(','),prior=guards.get(key);
    if(prior){if(!prior.roles.includes(role))prior.roles.push(role);return;}
    const fact=readSnapshotBlockFact(input.snapshot,position);
    if(fact.coverage!=='known')throw Error('Complete coupled part lost known original neighbor');
    guards.set(key,{position:[...position],before:fact.state,blockEntity:fact.blockEntity,roles:[role]});
  }
  for(let i=0;i<writes.length;i++){
    if(!(i%1024))signal?.throwIfAborted();
    const write=writes[i];guard(write.position,'write');
    for(const direction of directions)guard(write.position.map((n,axis)=>n+direction[axis]),'neighbor');
  }
  const sorted=[...guards.values()].sort((a,b)=>comparePatchPoints(a.position,b.position));for(const item of sorted)item.roles.sort();
  const content={format:'AssemblyCoupledPart',version:1,policy:COUPLED_ASSEMBLY_POLICY,planHash:plan.planHash,
    snapshotHash:plan.snapshotHash,selectionHash:plan.selectionHash,assetHash:plan.assetHash,cellsHash:plan.cellsHash,
    index,offset,totalWrites:plan.operationCount,writes,guards:sorted,
    provisional:true,partIsApplyScope:false,completePlanRequired:true,canAuthorizePlacement:false,worldWrites:0};
  if(Buffer.byteLength(JSON.stringify(content))+128>WORLD_ASSEMBLY_LIMITS.partBytes)throw Error('Coupled transport part byte quota');
  const value=freeze({...content,partHash:contextHash(content)});partOwners.set(value,plan);return value;
}

/** ALL complete-native coupling/support/scope checks precede even part zero.
 * Parts are finite transport data; the explicit new format is rejected by old
 * WorldPatch v1 routes. Metadata commits only after every sink acknowledges. */
export async function streamCoupledAssemblyParts(plan,{onPart,signal}={}) {
  const input=original(plan);if(typeof onPart!=='function')throw Error('Original provisional coupled-part sink required');
  const hashes=[];let writes=[],offset=0,accounted=4096;
  async function flush(){
    signal?.throwIfAborted();const value=part(input,plan,writes,hashes.length,offset,signal);
    accounted+=Buffer.byteLength(JSON.stringify(value));if(accounted>WORLD_ASSEMBLY_LIMITS.patchBytes)throw Error('Whole coupled part-set byte quota; no partial publication');
    await onPart(value);signal?.throwIfAborted();hashes.push(value.partHash);offset+=writes.length;writes=[];
  }
  for(const write of changes(input,signal)){
    writes.push(write);if(writes.length===WORLD_ASSEMBLY_LIMITS.operationsPerPart)await flush();
  }
  if(writes.length)await flush();
  if(offset!==plan.operationCount||hashes.length!==Math.ceil(plan.operationCount/WORLD_ASSEMBLY_LIMITS.operationsPerPart))throw Error('Complete coupled part-set count changed');
  const content={format:'AssemblyCoupledPatchSet',version:1,policy:COUPLED_ASSEMBLY_POLICY,planHash:plan.planHash,
    snapshotHash:plan.snapshotHash,selectionHash:plan.selectionHash,assetHash:plan.assetHash,cellsHash:plan.cellsHash,
    operationCount:offset,partCount:hashes.length,partHashes:hashes,fullAssetProcessed:true,
    partialPublicationAllowed:false,canAuthorizePlacement:false,serverBaselineVerified:false,physicsVerified:false,worldWrites:0};
  return freeze({...content,patchSetHash:contextHash(content)});
}
