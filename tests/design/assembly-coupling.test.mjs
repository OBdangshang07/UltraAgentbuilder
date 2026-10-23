import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {resolveState, stateText, parseState} from '../../src/generation/block-states.mjs';
import {createContextSnapshot, contextHash} from '../../src/world/context-snapshot.mjs';
import {selectionChunks, regionCells} from '../../contracts/world-selection.mjs';
import {analyzeAssemblyCoupling, validateAssemblyCouplingAnalysis, assemblyUpperFaceSupport, assemblySupportStateCases} from '../../src/world/assembly-coupling.mjs';
import {compileAssemblyWorldPatch, prepareAssemblyWorldContext} from '../../src/world/assembly-context.mjs';

// Raw data-only native cells, NOT a compiled SceneSpec, native-bundle acceptance
// or a publishable candidate. No model, filesystem, world or geometry compiler.
function native(entries, dimensions = {width:3,height:4,length:3}, extras = {}) {
  const {width:w,height:h,length:d} = dimensions, palette = ['@keep','minecraft:air'];
  const binary = Buffer.alloc(w*h*d*2);
  for (const [p,state] of entries) {
    if (!palette.includes(state)) palette.push(state);
    binary.writeUInt16LE(palette.indexOf(state),(p[0]+p[2]*w+p[1]*w*d)*2);
  }
  let setCount = 0, clearCount = 0;
  for (let i = 0; i < binary.length; i+=2) { const n = binary.readUInt16LE(i); if (n>=2) setCount++; else if (n===1) clearCount++; }
  const data = {dimensions,palette,cellsHash:hash(binary),setCount,clearCount,...extras};
  return {manifest:{...data,assetHash:hash(data)},binary};
}
function snapshot({changes=[],unknown=[],protect=[],dimensions={width:3,height:4,length:3},origin=[0,0,0],tight=false,revision=1}={}) {
  const lengths = [dimensions.width,dimensions.height,dimensions.length], edit = {min:[...origin],max:origin.map((n,i)=>n+lengths[i])};
  const s = {format:'WorldSelection',version:1,world:{worldId:'synthetic_coupling',dimension:'minecraft:overworld',minY:-64,maxY:320},revision,
    edit,context:tight?edit:{min:origin.map(n=>n-1),max:edit.max.map(n=>n+1)},protected:protect};
  const changed = new Map(changes.map(([point,state,blockEntity=false])=>[point.join(','),{state,blockEntity}]));
  return createContextSnapshot(s,{fence:{start:7,end:7},chunks:selectionChunks(s).map(c=>{
    if (unknown.some(p=>p[0]===c.x&&p[1]===c.z)) return {x:c.x,z:c.z,coverage:'unknown',palette:[],runs:[]};
    const palette=[],runs=[],known=new Map(),{min,max}=c.region;
    for (let y=min[1];y<max[1];y++) for(let z=min[2];z<max[2];z++) for(let x=min[0];x<max[0];x++) {
      const fact=changed.get([x,y,z].join(','))??{state:'minecraft:air',blockEntity:false},key=JSON.stringify(fact);
      if (!known.has(key)) { known.set(key,palette.length);palette.push(fact); }
      const n=known.get(key);if(runs.at(-1)?.[0]===n)runs.at(-1)[1]++;else runs.push([n,1]);
    }
    assert.equal(runs.reduce((n,r)=>n+r[1],0),regionCells(c.region));
    return {x:c.x,z:c.z,coverage:'known',palette,runs};
  })});
}
const door = (half='lower',extra={}) => resolveState('dark_oak_door',{half,...extra});
const entries = () => [[[1,0,1],'minecraft:stone'],[[1,1,1],door()],[[1,2,1],door('upper')]];
const analyze = (items=entries(),opts={}) => analyzeAssemblyCoupling(snapshot(opts),native(items,opts.dimensions));

test('complete native door analysis binds original cells, world origin and support without placement authority',()=>{
  const s=snapshot(),n=native(entries()),original=JSON.stringify({s,n}),r=analyzeAssemblyCoupling(s,n);
  assert.equal(JSON.stringify({s,n}),original);assert.equal(r.operationCount,3);assert.equal(r.counts.door,2);assert.equal(r.groups.length,1);
  assert.deepEqual(r.groups[0].indices,[13,22]);assert.deepEqual(r.groups[0].positions,[[1,1,1],[1,2,1]]);
  assert.deepEqual(r.groups[0].support,{position:[1,0,1],state:'minecraft:stone',source:'native-after'});
  for(const key of ['assetHash','cellsHash'])assert.equal(r[key],n.manifest[key]);assert.equal(r.snapshotHash,s.snapshotHash);
  for(const key of ['serverBaselineVerified','physicsVerified','applicationIntegrated','canAuthorizePlacement'])assert.equal(r[key],false);
  assert.equal(r.worldWrites,0);assert.equal(r.groupScope,'complete-native-not-parts');assert.ok(Object.isFrozen(r.groups[0].support.position));
  assert.deepEqual(validateAssemblyCouplingAnalysis(s,n,structuredClone(r)),r);
});

test('whole groups are not cut by 8192-operation transport boundaries',()=>{
  const dimensions={width:64,height:3,length:64},items=[];
  for(let y=0;y<2;y++)for(let z=0;z<64;z++)for(let x=0;x<64;x++)items.push([[x,y,z],x===63&&z===63&&y===1?door():'minecraft:stone']);
  items.push([[63,2,63],door('upper')]);
  const r=analyze(items,{dimensions});assert.equal(r.operationCount,8193);assert.equal(r.groups.length,1);
  assert.deepEqual(r.groups[0].indices,[8191,12287]);assert.deepEqual(r.groups[0].positions,[[63,1,63],[63,2,63]]);
});

for(const [label,change] of [
  ['missing upper',items=>items.pop()],
  ['missing lower',items=>items.splice(1,1)],
  ['upper is explicit CLEAR',items=>items[2][1]='minecraft:air'],
  ['upper is stone',items=>items[2][1]='minecraft:stone'],
  ['different wood',items=>items[2][1]=resolveState('birch_door',{half:'upper'})],
  ['two lower halves',items=>items[2][1]=door()],
  ['different facing',items=>items[2][1]=door('upper',{facing:'east'})],
  ['different hinge',items=>items[2][1]=door('upper',{hinge:'right'})],
  ['different open',items=>items[2][1]=door('upper',{open:true})],
]) test('rejects complete-asset door mismatch: '+label,()=>{const items=entries();change(items);assert.throws(()=>analyze(items),/both explicit matching/);});

test('door halves cannot wrap across top or bottom of native bounds',()=>{
  for(const half of ['lower','upper'])assert.throws(()=>analyze([[[1,half==='lower'?3:0,1],door(half)],[[1,2,1],'minecraft:stone']]),/both explicit matching/);
});

test('final support uses original known KEEP outside native bounds at negative world origin',()=>{
  const origin=[-20,-30,-20],s=snapshot({origin,changes:[[[-19,-31,-19],'minecraft:stone']]}),n=native([[[1,0,1],door()],[[1,1,1],door('upper')]]);
  const r=analyzeAssemblyCoupling(s,n);assert.deepEqual(r.origin,origin);
  assert.deepEqual(r.groups[0].support,{position:[-19,-31,-19],state:'minecraft:stone',source:'snapshot-keep'});
});

test('KEEP inside native uses captured support and CLEAR never means KEEP',()=>{
  const items=entries().slice(1),s=snapshot({changes:[[[1,0,1],'minecraft:stone']]});
  assert.equal(analyzeAssemblyCoupling(s,native(items)).groups[0].support.source,'snapshot-keep');
  assert.throws(()=>analyzeAssemblyCoupling(s,native([[[1,0,1],'minecraft:air'],...items])),/final full upper-face/);
});

for(const [material,extra] of [['quartz_slab',{type:'top'}],['quartz_slab',{type:'double'}],['oak_stairs',{half:'top',shape:'inner_left'}]])
  test('final support admits verified UP-face shape: '+material+JSON.stringify(extra),()=>{
    const items=entries();items[0][1]=resolveState(material,extra);assert.equal(analyze(items).groups.length,1);
  });
for(const state of ['minecraft:air',resolveState('quartz_slab',{type:'bottom'}),resolveState('oak_stairs',{half:'bottom'}),resolveState('oak_trapdoor',{half:'bottom'}),resolveState('oak_trapdoor',{half:'top'})])
  test('support policy does not confuse a partial or air block with a full UP face: '+state,()=>{
    const items=entries();items[0][1]=state;assert.throws(()=>analyze(items),/final full upper-face/);
  });

test('floating trapdoors have no invented attachment rule; stairs and slabs retain every native property',()=>{
  const items=[[[0,2,0],resolveState('oak_trapdoor',{facing:'west',half:'top',open:true})],[[1,2,0],resolveState('oak_stairs',{facing:'south',half:'top',shape:'outer_right'})],[[2,2,0],resolveState('quartz_slab',{type:'double'})]];
  const n=native(items),before=Buffer.from(n.binary),r=analyzeAssemblyCoupling(snapshot(),n);
  assert.deepEqual(r.counts,{door:0,trapdoor:1,stairs:1,slab:1,static:0});assert.equal(r.groups.length,0);
  assert.equal(r.trapdoorSupport,'no-attachment-requirement-vanilla-1.20.1');assert.deepEqual(n.binary,before);
});

for(const [label,opts,pattern] of [
  ['protected write',{protect:[{min:[1,1,1],max:[2,2,2]}]},/protected BEFORE/],
  ['unknown write',{unknown:[[0,0]]},/UNKNOWN/],
  ['missing C closure',{tight:true},/closure inside C/],
  ['unknown neighboring chunk',{origin:[-1,0,0],unknown:[[0,0]]},/UNKNOWN/],
  ['block entity neighbor',{changes:[[[2,1,1],'minecraft:stone',true]]},/block-entity/],
  ['fluid neighbor',{changes:[[[2,1,1],'minecraft:water[level=0]']]},/dynamic-state/],
  ['old door neighbor',{changes:[[[2,1,1],door()]]},/coupled-block/],
  ['old stair neighbor',{changes:[[[2,1,1],resolveState('oak_stairs')]]},/BEFORE stair protection/],
  ['unclassified neighbor',{changes:[[[2,1,1],'minecraft:barrier']]},/unclassified/],
  ['old trapdoor neighbor',{changes:[[[2,1,1],resolveState('oak_trapdoor')]]},/static BEFORE policy/],
]) test('retains original scope and unsafe BEFORE guards: '+label,()=>assert.throws(()=>analyze(entries(),opts),pattern));

test('a protected static C neighbor is readable, not editable; protected support is not silently changed',()=>{
  const protect=[{min:[1,0,1],max:[2,1,2]}],s=snapshot({protect,changes:[[[1,0,1],'minecraft:stone']]});
  assert.equal(analyzeAssemblyCoupling(s,native(entries().slice(1))).groups.length,1);
  assert.throws(()=>analyzeAssemblyCoupling(s,native([[[1,0,1],'minecraft:glass'],...entries().slice(1)])),/protected BEFORE/);
});

test('existing coupled BEFORE cannot be removed or replaced one half at a time',()=>{
  const s=snapshot({changes:[[[1,1,1],door()],[[1,2,1],door('upper')]]});
  for(const after of ['minecraft:air','minecraft:stone'])assert.throws(()=>analyzeAssemblyCoupling(s,native([[[1,1,1],after]])),/protected BEFORE/);
});

test('all supported door directions, hinges and open states are analyzed without rewriting states',()=>{
  for(const facing of ['north','east','south','west'])for(const hinge of ['left','right'])for(const open of [false,true]){
    const items=entries();items[1][1]=door('lower',{facing,hinge,open});items[2][1]=door('upper',{facing,hinge,open});
    assert.deepEqual(analyze(items).groups[0].states,items.slice(1).map(i=>i[1]));
  }
});

test('used states, original bytes/counts/bounds and diagnostic eligibility are all checked',()=>{
  const s=snapshot(),n=native(entries());
  for(const change of [n=>n.binary[0]^=1,n=>n.manifest.assetHash='0'.repeat(64),n=>n.manifest.cellsHash='0'.repeat(64)]){
    const copy=structuredClone(n);change(copy);assert.throws(()=>analyzeAssemblyCoupling(s,copy),/native|hash/);
  }
  for(const extra of [{diagnosticOnly:true},{setCount:999},{clearCount:999}])assert.throws(()=>analyzeAssemblyCoupling(s,native(entries(),undefined,extra)),/diagnostic|counts/);
  const larger=native([[[3,1,1],'minecraft:stone']],{width:4,height:4,length:3});assert.throws(()=>analyzeAssemblyCoupling(s,larger),/original W/);
  const bad=native(entries());bad.binary.writeUInt16LE(255,0);bad.manifest.cellsHash=hash(bad.binary);const {assetHash,...data}=bad.manifest;bad.manifest.assetHash=hash(data);
  assert.throws(()=>analyzeAssemblyCoupling(s,bad),/palette index/);
  for(const state of ['minecraft:light[level=15,waterlogged=false]','minecraft:oak_leaves[persistent=true]',door().replace('powered=false','powered=true'),resolveState('oak_trapdoor').replace('waterlogged=false','waterlogged=true'),'minecraft:unknown'])
    assert.throws(()=>analyzeAssemblyCoupling(s,native([[[1,1,1],state]])),/does not resolve|Unsupported/);
});

test('unused default palette entries are not mistaken for occupied leaves, light or unpaired doors',()=>{
  const n=native(entries());n.manifest.palette.push('minecraft:oak_leaves[persistent=true]',door('upper'));
  const {assetHash,...data}=n.manifest;n.manifest.assetHash=hash(data);
  assert.equal(analyzeAssemblyCoupling(snapshot(),n).counts.door,2);
});

test('noncanonical or duplicate property text is not silently normalized into a different asset',()=>{
  const parsed=parseState(door()),reordered=parsed.id+'['+Object.entries(parsed.properties).reverse().map(p=>p.join('=')).join(',')+']';
  assert.notEqual(stateText(parsed),reordered);
  for(const state of [reordered,door().replace('powered=false','powered=false,powered=false')])assert.throws(()=>analyze([[[1,1,1],state]]),/canonical|duplicate/);
});

test('serialized authority flags, changed context and tampered groups cannot be accepted by rehashing',()=>{
  const s=snapshot(),n=native(entries()),r=analyzeAssemblyCoupling(s,n);
  for(const mutate of [r=>r.canAuthorizePlacement=true,r=>r.groups[0].indices.pop(),r=>r.groups[0].support.state='minecraft:glass']){
    const changed=structuredClone(r);mutate(changed);const {analysisHash,...data}=changed;changed.analysisHash=contextHash(data);
    assert.throws(()=>validateAssemblyCouplingAnalysis(s,n,changed),/differs/);
  }
  assert.throws(()=>validateAssemblyCouplingAnalysis(snapshot({revision:2}),n,r),/differs/);
});

test('cancellation before and during a whole scan exposes no provisional groups',()=>{
  const s=snapshot(),n=native(entries()),c=new AbortController();c.abort();assert.throws(()=>analyzeAssemblyCoupling(s,n,{signal:c.signal}),{name:'AbortError'});
  let calls=0;const stop=Error('cancelled during complete scan');assert.throws(()=>analyzeAssemblyCoupling(s,n,{signal:{throwIfAborted(){if(++calls===4)throw stop;}}}),e=>e===stop);
});

test('empty/no-op masks do not pretend to be an actionable world change',()=>{
  for(const items of [[],[[[1,1,1],'minecraft:air']]])assert.throws(()=>analyze(items),/no explicit world changes/);
});

test('finite support cases include all partial types and reject unsupported, wet and powered states',()=>{
  const cases=assemblySupportStateCases();assert.ok(cases.length>1000);assert.equal(new Set(cases.map(c=>c.state)).size,cases.length);
  assert.ok(cases.some(c=>c.state.includes('half=top')&&c.state.includes('_stairs')&&c.fullUpperFace));
  for(const state of ['minecraft:air','minecraft:unknown',door(),'minecraft:oak_slab[type=top,waterlogged=true]'])assert.equal(assemblyUpperFaceSupport(state),false);
});

test('read-only analysis does not relax or replace legacy whole-assembly lowering',()=>{
  const s=snapshot(),n=native(entries());assert.equal(analyzeAssemblyCoupling(s,n).groups.length,1);
  assert.throws(()=>compileAssemblyWorldPatch(prepareAssemblyWorldContext(s),n),/separate coupling\/support policy/);
});
