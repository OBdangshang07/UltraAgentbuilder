import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {validateScene} from '../../contracts/scene-spec.schema.mjs';
import {affectedComponents,reviseScene} from '../../src/design/revision.mjs';
import {basicScene,mass,shape,at,once} from './fixtures.mjs';
import {storeyRoom,storeyOpening,floorStudy,floorWorldTower} from './floor-components-fixtures.mjs';

const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];
test('exhausted floor diagnostic budgets are incomplete evidence, not invented design errors',()=>{
  const s=floorStudy();s.components.push(shape('desk',[0,0,0],[1,1,1],'frame',{at:at([1,1,1],'rooms')}));
  s.reservations.push({id:'reserved',at:at([3,1,3],'rooms'),size:[1,2,1],allowedComponents:[]});
  for(const options of [{maxPrimitiveChecks:1},{maxProfileWork:1}]){
    const source=structuredClone(s);
    if(options.maxProfileWork)Object.assign(source.components[0],{kind:'profileMass',points:[[0,0],[26,0],[26,26],[0,26]]});
    const r=inspectConstruction(source,options);
    assert.equal(r.status,'incomplete');assert.equal(r.checksComplete,false);assert.equal(r.blockingIssueCount,0);
    assert.deepEqual(r.skippedComponents,['rooms','desk']);assert.equal(r.canAuthorizePlacement,false);
  }
});
test('floor-derived rooms match independent explicit room instances at a nonzero host elevation',()=>{
  const s=floorStudy(),before=hash(s),c=compileScene(s),manual=structuredClone(s);
  manual.components.splice(1,1,...[0,5,10,16].map((floor,i)=>({id:'room'+i,kind:'roomZone',host:'main',at:at([2,floor,2],'main'),repeat:once,allowOverwrite:[],size:[8,[5,5,6,5][i],8],use:'room',purpose:'Explicit fixture',floorMaterial:'floor',boundaries:[]})));
  assert.deepEqual(c.binary,compileScene(manual).binary);assert.equal(hash(s),before);
  assert.deepEqual(c.designSources.parametricLayouts[0].rows.map(r=>r.height),[5,5,6,5]);
  assert.deepEqual(c.designSources.componentBounds.rooms.map(r=>r.origin[1]),[2,7,12,18]);
  assert.equal(new Set(c.spec.nodes.map(n=>n.nodeId)).size,c.spec.nodes.length);
  assert.deepEqual(inspectConstruction(s).parametricLayouts,c.designSources.parametricLayouts);
  assert.ok(c.designSources.traceSources.some(n=>n?.kind==='roomZone'&&n.layoutSource?.rule==='storeyRoom'));
});

for(const face of ['north','south','east','west'])test(`${face} thick-wall floor openings and paired doors use real slabs and preserve support`,()=>{
  const s=floorStudy();s.components=[s.components[0],storeyOpening('portals','main',face)];s.components[0].thickness=2;
  const explicit=structuredClone(s),along=['north','south'].includes(face)?0:2,normal=along===0?2:0;
  explicit.components.splice(1,1,...[2,7,12,18].map((base,i)=>{
    const pos=[7,base+1,7],size=[1,2,1];pos[along]+=3;size[along]=2;size[normal]=2;if(['south','east'].includes(face))pos[normal]+=24;
    return {id:'cut'+i,kind:'void',at:at(pos),size,repeat:once,allowOverwrite:['main']};
  }));
  const a=compileScene(s);assert.deepEqual(a.binary,compileScene(explicit).binary);
  s.components[1].door='oak_door';const b=compileScene(s);assert.equal(b.manifest.quality.navigation,'unverified');
  for(const base of [2,7,12,18]){
    const p=[7,base+1,7];p[along]+=3;if(['south','east'].includes(face))p[normal]+=25;
    assert.match(state(b,...p),/oak_door\[.*half=lower/);p[1]++;assert.match(state(b,...p),/oak_door\[.*half=upper/);p[1]-=2;assert.notEqual(state(b,...p),'minecraft:air');
  }
  assert.equal(b.designSources.componentBounds.portals.length,4);assert.equal(b.designSources.parametricLayouts[0].expandedInstanceChecks,4);
});

test('shared floor sources require matching world floors and ceilings with dependency closure',()=>{
  const s=floorStudy();s.components.push(mass('schedule',[1,2,1],[4,22,4],[5,10,16]));s.components[1].floors.source='schedule';
  assert.doesNotThrow(()=>compileScene(s));assert.deepEqual(affectedComponents(s,['schedule']),['schedule','rooms']);
  assert.deepEqual(lowerScene(s).dependencies.rooms,['main','schedule']);
  s.components.at(-1).levels=[5,11,16];const before=hash(s);
  assert.throws(()=>compileScene(s),/floor\/ceiling do not align/);const report=inspectConstruction(s);assert.equal(report.issueGroups[0].layoutFeedback.rule,'floor-interface');assert.equal(hash(s),before);
  s.components.at(-1).levels=[5,10,16];s.components.at(-1).at.offset[1]=1;assert.throws(()=>compileScene(s),/do not align/);
});
test('irregular room bands with real partition doors match explicitly authored per-floor geometry',()=>{
  for(const levels of [[4,8,13,18],[4,9,14,19],[6,10,14,18]])for(const first of [0,1]){
    const s=floorStudy();s.bounds.height=32;s.components[0].size[1]=25;s.components[0].levels=levels;
    Object.assign(s.components[1],{floors:{source:'main',first,count:5-first},ceilingInset:1,boundaries:[{face:'south',material:'frame',openings:[{u:2,width:2,height:2,door:'oak_door',hinge:'right',open:false}]}]});
    const manual=structuredClone(s),floors=[0,...levels];
    manual.components.splice(1,1,...floors.slice(first).map((floor,i)=>({id:'explicit'+i,kind:'roomZone',host:'main',at:at([2,floor,2],'main'),size:[8,(floors[first+i+1]??24)-floor-1,8],repeat:once,use:'room',purpose:'Independent floor',floorMaterial:'floor',boundaries:structuredClone(s.components[1].boundaries),allowOverwrite:[]})));
    const c=compileScene(s),reference=compileScene(manual);assert.deepEqual(c.binary,reference.binary);
    assert.deepEqual(c.designSources.componentBounds.rooms.map(b=>b.origin[1]),floors.slice(first).map(y=>y+2));
    assert.equal(c.manifest.quality.navigation,'unverified');assert.equal(inspectConstruction(s).status,'passed');
    assert.equal(new Set(c.spec.nodes.map(n=>n.nodeId)).size,c.spec.nodes.length);
  }
});

test('profile room footprints and exceptional small floors are checked without clipping',()=>{
  const s=floorStudy();Object.assign(s.components[0],{kind:'profileMass',points:[[0,0],[26,0],[26,12],[12,12],[12,26],[0,26]]});
  assert.doesNotThrow(()=>compileScene(s));assert.equal(inspectConstruction(s).status,'passed');
  s.components[1].offset=[15,15];assert.throws(()=>compileScene(s),/actual host interior/);assert.equal(inspectConstruction(s).issueGroups[0].layoutFeedback.rule,'room-interface');
  const short=floorStudy();short.components[0].levels=[5,10,20];assert.throws(()=>compileScene(short),/two air cells/);
});

test('schema families and floor reference cycles remain strict',()=>{
  for(const modify of [c=>c.at=at([0,0,0]),c=>c.repeat=once,c=>c.size=[8,5,8],c=>c.floors.first=-1,c=>c.floors.count=65,c=>c.ceilingInset='5-1',c=>c.floors.source='rooms']){
    const s=floorStudy();modify(s.components[1]);assert.throws(()=>compileScene(s));
  }
  const s=floorStudy();s.components[1].floors.source='missing';assert.throws(()=>compileScene(s),/Unknown component reference/);
  s.components[1].floors={source:'main',first:3,count:2};assert.throws(()=>compileScene(s),/selection exceeds/);
});

test('floor layout grants no authority over unrelated walls, room partitions or reserved passages',()=>{
  const s=floorStudy();s.components.push(shape('protected',[10,3,10],[1,2,1],'frame',{stage:'structure'}));assert.throws(()=>compileScene(s),/Ownership conflict/);
  const open=floorStudy();open.components=[open.components[0],shape('locked',[10,3,7],[2,2,1],'frame',{stage:'structure',allowOverwrite:['main']}),storeyOpening('portals','main')];
  assert.throws(()=>compileScene(open),/Ownership conflict: portals -> locked/);
  const circulation=floorStudy();circulation.components[1].use='circulation';circulation.components.push(shape('chair',[10,3,10],[1,1,1],'frame',{allowOverwrite:['rooms']}));assert.throws(()=>compileScene(circulation),/Circulation zone/);
});

test('host-relative anchors use first room instance and furniture in ordinary room air remains allowed',()=>{
  const s=floorStudy();s.components.push(shape('desk',[0,0,0],[2,1,2],'frame',{at:at([1,1,1],'rooms'),repeat:{count:2,step:[0,5,0]}}));
  const c=compileScene(s);assert.deepEqual(c.designSources.componentBounds.desk[0].origin,[10,3,10]);assert.deepEqual(c.designSources.dependencies.desk,['rooms']);
});

test('component-wide saved-asset revisions cannot silently change shared floor consumers or protected slabs',()=>{
  const s=floorStudy(),base=compileScene(s);s.components[1].floorMaterial='frame';
  const patch={baseHash:base.manifest.assetHash,replaceComponents:[s.components[1]],removeComponents:[],replaceModules:[],replaceInstances:[]};
  const original=base.scene,scope={components:['rooms'],protectedComponents:[],regions:base.designSources.componentBounds.rooms,shared:'instance'};
  assert.ok(reviseScene(original,patch,scope,{baseCompiled:base}).revision.changedCells>0);
  const floor=structuredClone(original.components[0]);floor.levels=[5,11,16];
  assert.throws(()=>reviseScene(original,{...patch,replaceComponents:[floor]},{...scope,components:['main']},{baseCompiled:base}),/Dependency change/);
});

test('224m core and office floor relationships survive full strict compilation without source padding',()=>{
  const s=floorWorldTower(),c=compileScene(s,{navigationPolicy:'strict'}),before=hash(s);
  assert.equal(c.manifest.quality.navigation,'verified');assert.equal(c.manifest.dimensions.height,224);assert.ok(c.cells.slice(223*32*32).some(n=>n>=2));
  assert.deepEqual(c.designSources.parametricLayouts.map(e=>e.expandedInstanceChecks),[44,44]);assert.equal(c.designSources.componentBounds.corePortals.length,44);
  assert.equal(inspectConstruction(s).status,'passed');assert.equal(hash(s),before);assert.ok(c.spec.nodes.length<4096);
});
test('two independent 224m stair cores share one authoritative floor schedule and connect every landing',()=>{
  const s=floorWorldTower(),core=structuredClone(s.components.find(c=>c.id==='core')),stairs=structuredClone(s.components.find(c=>c.kind==='stairs'));
  core.id='coreTwo';core.at.offset[0]+=15;stairs.id='flightsTwo';stairs.host=core.id;stairs.at.offset[0]+=15;
  s.components.push(core,stairs,storeyOpening('portalsTwo','coreTwo','east',{floors:{source:'main',first:0,count:44},u:1,width:4,height:3}));
  for(let y=0;y<220;y+=5)s.constraints.passages.push({origin:[28,y+1,6],size:[1,2,1]});
  const c=compileScene(s,{navigationPolicy:'strict'});
  assert.equal(c.manifest.quality.navigation,'verified');
  for(const id of ['flights','flightsTwo']){
    const access=c.designSources.stairAccess.filter(a=>a.component===id);
    assert.equal(access.length,86);assert.ok(access.every(a=>a.status==='local-opening-found'));
  }
  assert.deepEqual(c.designSources.dependencies.portalsTwo,['coreTwo','main']);
});
