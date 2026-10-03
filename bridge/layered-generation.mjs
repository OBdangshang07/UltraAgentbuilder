import {hash,LIMITS} from '../src/generation/compiler.mjs';

export const ENVELOPE_INSTRUCTIONS=`This is stage 1 of an explicitly approved TWO-stage building job. Establish the complete design brief and a distinctive exterior: crafted facade modules, depth, entry hierarchy, material rhythm, silhouette, landscaping and roof. Return a BuildingSpec v2 for foundation/podium, external facade/windows, structural core and roof. Reserve clear space for stairs, repeated floors and furniture. Include every palette role needed by the next stage, including doors/stairs/slabs. Use constraints={interior:false,walkable:false,passages:[]} at this temporary stage; it is NOT offered for placement. Preserve the full requested 1:1 height. Use groups/instances and repeat to compress craftsmanship, not remove it. The next stage adds interior circulation and furniture without redesigning the exterior.`;
export const INTERIOR_INSTRUCTIONS=`This is stage 2 (final) of the approved building job. The prior envelope is DATA. Return a BuildingSpec fragment with EXACTLY the same schemaVersion, id, seed, units, bounds and palette. Include ONLY NEW nodes, groups and instances with unique IDs not present in the envelope; keep the original design brief. All your geometry is applied AFTER all envelope geometry, including its instances. Add repeated floor slabs with stair holes, walkable stairs/landings, circulation, entry openings, furnishings, partitions and real lamps. Use groups/instances and repeat objects {count:N,step:[0,floorHeight,0]} rather than enumerating every floor. Preserve exterior detailing; scope new clear nodes to actual openings. Do not refill circulation with furniture. Explicitly clear doorway and stair headroom. Set constraints.interior=true and walkable=true with narrow checked passages; all intended floor surfaces must connect to the entry. The complete merged building, not this fragment alone, is validated. Never change palette, shrink bounds, duplicate the whole envelope, or switch off final navigation checks.`;

export function validateEnvelope(spec){
  if(spec?.constraints?.interior!==false||spec?.constraints?.walkable!==false||!Array.isArray(spec?.constraints?.passages)||spec.constraints.passages.length)throw new Error('外壳阶段须使用临时外壳约束；未开始第二阶段，没有自动修复。');
}
export function mergeInterior(envelope,fragment){
  for(const key of ['schemaVersion','id','seed','units','bounds','palette'])if(hash(envelope[key])!==hash(fragment?.[key]??null))throw new Error(`内饰阶段修改了固定字段 ${key}；拒绝缩放/替换外壳，没有自动重试。`);
  if(!Array.isArray(fragment.nodes)||!fragment.nodes.length||fragment.nodes.length+envelope.nodes.length>LIMITS.nodes)throw new Error('内饰阶段节点数量无效或超限；没有自动重试。');
  if(fragment.constraints?.interior!==true||fragment.constraints?.walkable!==true)throw new Error('内饰阶段不得关闭室内/步行检查；没有自动重试。');
  const ids=new Set(envelope.nodes.map(n=>n.nodeId));
  for(const n of fragment.nodes){if(!n||typeof n.nodeId!=='string'||ids.has(n.nodeId))throw new Error('内饰阶段节点 ID 重复；没有覆盖原节点。');ids.add(n.nodeId);}
  if(envelope.schemaVersion===2){
    const combined={};for(const key of ['groups','instances']){if(!Array.isArray(envelope[key])||!Array.isArray(fragment[key]))throw new Error('Missing v2 groups/instances');const ids=new Set(envelope[key].map(v=>v.id));for(const v of fragment[key]){if(ids.has(v.id))throw new Error('Interior stage duplicated '+key+' ID');ids.add(v.id);}combined[key]=[...envelope[key],...fragment[key]];}
    // Keep the stage ordering even though v2 global nodes normally precede all instances.
    const size=[envelope.bounds.width,envelope.bounds.height,envelope.bounds.length],taken=new Set([...combined.groups,...combined.instances].map(v=>v.id));
    const stage=(label,nodes)=>{let id=label;while(taken.has(id))id+='x';if(id.length>32)throw new Error('Cannot allocate stage group ID');taken.add(id);combined.groups.push({id,size,nodes});return {id,group:id,origin:[0,0,0],rotation:0,mirror:false,repeat:{count:1,step:[0,0,0]}};};
    const ordered=[...(envelope.nodes.length?[stage('envelope-global',envelope.nodes)]:[]),...envelope.instances,...(fragment.nodes.length?[stage('interior-global',fragment.nodes)]:[]),...fragment.instances];
    return {...fragment,design:envelope.design,groups:combined.groups,instances:ordered,nodes:[]};
  }
  return {...fragment,nodes:[...envelope.nodes,...fragment.nodes]};
}
