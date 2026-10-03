import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {compileScene,lowerScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {resolveAnchor} from '../../src/design/spatial.mjs';
import {basicScene,mass,shape,at,once,courtyard,teahouse,instanceStudy,worldHighrise} from './fixtures.mjs';
import {spaceTower,spaceGallery,spaceCourt,spaceSetbackTower,edgeFacade} from './space-fixtures.mjs';
import {profileMass} from './profile-fixtures.mjs';
import {assemblyCorrectionInput} from '../../src/design/correction-feedback.mjs';

const node=(id,origin,size,extra={})=>({nodeId:id,op:'box',origin,size,material:'frame',thickness:1,axis:'x',repeat:once,points:[],blockState:null,...extra});
function badCoordinates(){
  const s=basicScene('coordinate-feedback');s.bounds={width:64,height:240,length:64};
  s.components=[mass('podiumSouth',[4,0,48],[56,18,8]),{id:'podiumSouthLobby',kind:'roomZone',host:'podiumSouth',at:at([6,0,50],'podiumSouth'),size:[52,9,4],repeat:once,use:'room',purpose:'Lobby',floorMaterial:'floor',boundaries:[],allowOverwrite:[]}];
  return s;
}
function brokenModules(){
  const s=basicScene('module-feedback');
  s.modules=[{id:'carrel',parameters:[],size:[3,3,2],nodes:[node('screen',[0,2,0],[3,2,1]),node('leg',[-1,0,0],[1,1,1])]}];
  s.components=[{id:'desks',kind:'module',module:'carrel',at:at([5,1,5]),values:[],rotation:1,mirror:true,repeat:{count:2,step:[5,0,0]},allowOverwrite:[]}];return s;
}

test('explains the exact CBD local/world confusion without choosing or changing a design',()=>{
  const s=badCoordinates(),before=JSON.stringify(s),r=inspectConstruction(s),d=r.issues[0];
  assert.equal(r.sourceHash,hash(s));assert.equal(r.status,'errors');assert.equal(r.canAuthorizePlacement,false);
  assert.deepEqual(d.origin,[10,0,98]);assert.deepEqual(d.frame.parentOrigin,[4,0,48]);assert.deepEqual(d.frame.offset,[6,0,50]);
  assert.deepEqual(d.endExclusive,[62,9,102]);assert.equal(d.violations[0].axis,'z');assert.equal(d.violations[0].aboveBy,38);
  assert.equal(JSON.stringify(s),before);assert.throws(()=>lowerScene(s),/\[10,0,98\]/);
});
test('collects independent module errors before any world expansion, including rotated consumers',()=>{
  const s=brokenModules(),before=JSON.stringify(s),r=inspectConstruction(s);
  assert.equal(r.issues.length,2);assert.deepEqual(r.issues.map(i=>i.node),['screen','leg']);
  assert.deepEqual(r.issues[0].localBounds,[3,3,2]);assert.deepEqual(r.issues[0].worldSize,[2,3,3]);assert.equal(r.issues[0].violations[0].aboveBy,1);
  assert.equal(r.issues[1].violations[0].belowBy,1);assert.equal(JSON.stringify(s),before);
  assert.throws(()=>lowerScene(s),/module carrel \/ node screen/);
});
test('shared modules are checked with each explicit parameter binding, not only defaults',()=>{
  const s=brokenModules();s.modules[0].nodes=[node('screen',[0,2,0],[3,2,1])];
  s.modules[0].parameters=[{name:'height',type:'integer',minimum:3,maximum:6,default:3}];s.modules[0].size[1]={parameter:'height',offset:0};
  s.components.push({...structuredClone(s.components[0]),id:'tallDesks',values:[{name:'height',value:5}],at:at([20,1,5])});
  const r=inspectConstruction(s);assert.equal(r.issueCount,1);assert.equal(r.issues[0].component,'desks');assert.deepEqual(r.issues[0].values,[{name:'height',value:3}]);
});
test('checks both ends of negative component and node repeats without changing arithmetic',()=>{
  const s=brokenModules();s.modules[0].nodes=[node('detail',[1,0,0],[1,1,1],{repeat:{count:3,step:[-1,0,0]}})];
  s.components[0].repeat={count:3,step:[-3,0,0]};
  const r=inspectConstruction(s);assert.equal(r.issues.find(i=>i.code==='component-bounds').instance,2);
  assert.equal(r.issues.find(i=>i.code==='module-local-bounds').nodeRepeatIndex,2);
});
test('all anchors share the compiler formula, including odd center sizes and reservations',()=>{
  const map=new Map([['parent',{origin:[10,20,30],size:[5,7,9]}]]),b=[64,128,64];
  for(const [anchor,delta] of [['min',[0,0,0]],['top',[0,7,0]],['center',[2,3,4]],['max',[5,7,9]]]){
    const r=resolveAnchor(at([-1,2,-3],'parent',anchor),map,b);
    assert.deepEqual(r.origin,[9+delta[0],22+delta[1],27+delta[2]]);
  }
  const s=badCoordinates();s.components.pop();s.reservations=[{id:'reserved',at:at([6,0,50],'podiumSouth'),size:[3,3,3],allowedComponents:[]}];
  assert.equal(inspectConstruction(s).issues[0].code,'reservation-bounds');assert.throws(()=>lowerScene(s),/reserved: outside/);
});
test('valid outward references still produce useful errors for independent components',()=>{
  const s=badCoordinates();s.components.reverse();s.components.push(shape('badIndependent',[63,0,0],[2,1,1]));
  const r=inspectConstruction(s);assert.deepEqual(r.issues.filter(i=>i.code==='component-bounds').map(i=>i.component),['podiumSouthLobby','badIndependent']);
});
test('cycles, unknown references and depth failures cannot become apparent passes',()=>{
  const s=basicScene();s.components=[shape('a',[0,0,0],[1,1,1],undefined,{at:at([0,0,0],'b')}),shape('b',[0,0,0],[1,1,1],undefined,{at:at([0,0,0],'a')}),shape('c',[0,0,0],[1,1,1],undefined,{at:at([0,0,0],'missing')})];
  const r=inspectConstruction(s);assert.equal(r.status,'errors');assert.equal(r.checksComplete,false);assert.equal(r.skippedComponents.length,3);
  const chain=basicScene();chain.components=Array.from({length:35},(_,i)=>shape('p'+i,[0,0,0],[1,1,1],undefined,{at:at([0,0,0],i<34?'p'+(i+1):null)}));
  assert.ok(inspectConstruction(chain).issues.some(i=>i.message.includes('depth')));
});
test('all missing overwrite and reservation permissions are reported together without changing the draft',()=>{
  const s=basicScene();s.components=[mass('main',[2,0,2],[12,10,12],[])];
  s.components[0].allowOverwrite=['missingWall','missingFloor'];
  s.reservations=[{id:'well',at:at([4,1,4]),size:[1,2,1],allowedComponents:['future__pendant','future__rail']}];
  const before=hash(s),r=inspectConstruction(s),issues=r.issues.filter(i=>i.code==='permission-reference-missing');
  assert.equal(r.status,'errors');assert.equal(r.canAuthorizePlacement,false);assert.equal(r.checksComplete,true);
  assert.deepEqual(issues.map(i=>i.reference),['missingWall','missingFloor','future__pendant','future__rail']);
  assert.equal(r.issueGroups.length,4);assert.equal(hash(s),before);assert.throws(()=>lowerScene(s),/Unknown component reference/);
  const limited=inspectConstruction(s,{maxIssues:1});assert.equal(limited.issues.length,1);assert.equal(limited.issueCount,4);assert.equal(limited.issueGroups.length,4);assert.equal(limited.truncated,true);
  s.components[0].allowOverwrite=[];s.reservations[0].allowedComponents=['main'];assert.equal(inspectConstruction(s).status,'passed');assert.doesNotThrow(()=>lowerScene(s));
});
test('duplicate IDs and schema-invalid data return explicit incomplete feedback',()=>{
  const s=badCoordinates();s.components[1].id=s.components[0].id;
  assert.equal(inspectConstruction(s).issues[0].code,'duplicate-component');
  s.components[0].size[0]='run code';const r=inspectConstruction(s);assert.equal(r.issues[0].code,'schema-invalid');assert.equal(r.checksComplete,false);
});

function changedProfileHost(){
 const s=basicScene('profile-host-feedback');s.constraints={interior:false,walkable:false,passages:[]};
 s.components=[mass('crown',[2,0,2],[12,10,12]),...[0,1,2,3].map(edge=>edgeFacade('side_'+edge,'crown',edge,{count:[1,1]}))];return s;
}
test('changed profile host reports every dependent edge facade through compact design-correction feedback',()=>{
 const s=changedProfileHost(),before=hash(s),r=inspectConstruction(s,{maxIssues:1});
 assert.equal(r.status,'errors');assert.equal(r.issueCount,4);assert.equal(r.issues.length,1);assert.equal(r.truncated,true);assert.equal(r.issueGroups.length,4);
 const input=assemblyCorrectionInput({contractFeedback:{sourceHash:before,geometryPassed:false,canAuthorizePlacement:false,constructionFeedback:r}});
 assert.deepEqual(input.contractFeedback.constructionFeedback.issues.map(i=>i.component),['side_0','side_1','side_2','side_3']);
 for(const issue of input.contractFeedback.constructionFeedback.issues){assert.equal(issue.code,'edge-facade-host-invalid');assert.equal(issue.host,'crown');assert.equal(issue.actualHostKind,'mass');assert.equal(issue.expectedHostKind,'profileMass');assert.equal(issue.hostRepeat.count,1);}
 assert.ok(r.notChecked.includes('edge-facade-openings'));assert.ok(r.notChecked.includes('ownership'));assert.equal(r.canAuthorizePlacement,false);
 assert.throws(()=>lowerScene(s),/edgeFacade host must be one profileMass/);assert.equal(hash(s),before);
});
test('profile host repeat and missing edge diagnostics agree with strict lowering without testing window geometry',()=>{
 const s=changedProfileHost();s.components=[profileMass('crown',[2,0,2],[12,10,12],[[0,0],[12,0],[12,12],[0,12]]),edgeFacade('side','crown',0,{count:[1,1]})];
 assert.equal(inspectConstruction(s).status,'passed');assert.doesNotThrow(()=>lowerScene(s));
 s.components[0].repeat={count:2,step:[16,0,0]};
 const repeat=inspectConstruction(s);assert.equal(repeat.issues[0].code,'edge-facade-host-invalid');assert.equal(repeat.issues[0].hostRepeat.count,2);assert.throws(()=>lowerScene(s),/one profileMass/);
 s.components[0].repeat=once;s.components[1].edge=4;
 const edge=inspectConstruction(s);assert.equal(edge.issues[0].code,'edge-facade-edge-missing');assert.equal(edge.issues[0].availableEdges,4);assert.throws(()=>lowerScene(s),/missing profile edge/);
});
test('profile facade relation diagnostics respect work bounds and explicitly retain unchecked components',()=>{
 const s=changedProfileHost(),before=hash(s),r=inspectConstruction(s,{maxPrimitiveChecks:1});
 assert.equal(r.checksComplete,false);assert.equal(r.primitiveChecks,1);assert.equal(r.status,'errors');assert.equal(r.canAuthorizePlacement,false);
 assert.deepEqual(r.skippedComponents,['side_1','side_2','side_3']);assert.equal(hash(s),before);
});
test('feedback has explicit issue and work budgets, never truncates into a successful pass',()=>{
  const r=inspectConstruction(brokenModules(),{maxIssues:1});assert.equal(r.issueCount,2);assert.equal(r.issues.length,1);assert.equal(r.truncated,true);assert.equal(r.status,'errors');
  const s=brokenModules();s.modules[0].nodes=[node('ok',[0,0,0],[1,1,1]),node('bad',[0,2,0],[3,2,1])];
  const limited=inspectConstruction(s,{maxPrimitiveChecks:1});assert.equal(limited.status,'incomplete');assert.equal(limited.checksComplete,false);assert.ok(limited.primitiveChecks<=1);
  assert.throws(()=>inspectConstruction(s,{maxIssues:0}),/budget/);
});
test('node lowering errors are collected without suppressing independent bounds errors',()=>{
  const s=brokenModules();s.modules[0].nodes.unshift(node('badDoor',[0,0,0],[2,2,1],{op:'door'}));
  const r=inspectConstruction(s);assert.ok(r.issues.some(i=>i.code==='module-node-invalid'&&i.node==='badDoor'));assert.ok(r.issues.some(i=>i.node==='screen'));
});
test('passing static feedback cannot authorize compilation or ignore ownership collisions',()=>{
  const s=courtyard();s.components.push(shape('collision',[6,2,7],[1,1,1],'frame'));
  const r=inspectConstruction(s);assert.equal(r.status,'passed');assert.equal(r.canAuthorizePlacement,false);assert.ok(r.notChecked.includes('ownership'));assert.throws(()=>compileScene(s),/Ownership conflict/);
});
test('unaffected scenes retain original cell bytes and provenance; only the compiler identity changes',()=>{
  const expected=[
    [courtyard,'0b71247936257372606e6162a7f6a8da164c62c2457914872da39d417040545f','989ce51f9c16717f4e332e19277c3d90f1deea62e1d00930168602f8fdfbe06a'],
    [teahouse,'cfdea139d9488abb3f31ff68bfe668a43c8c1283890b5f112de3164f3a281a58','eb9e18b3af771b2d5870b5ef664be0f6418041e78742af2d71f12084b80bdd19'],
    [instanceStudy,'cc3c0022cbce923a02d81defad5dab66267c67a67feb32865e9426963f82a53f','31490e62e7cb3880d217045c7ebbe317a6f9ef46df748fba1d45c3a194fdc92c'],
    [worldHighrise,'2f07869c7b945b51adcc0e86a30ccecfda54bea2bb75d61a2b69dae4ce8f8ca8','d137e4f70395a9812dc594f1c91e9e9dfdce79ef8a33ed63d5473c2f3df8e746']
  ];
  for(const [fixture,assetHash,cellsHash] of expected){
    const s=fixture(),r=inspectConstruction(s);assert.equal(r.status,'passed');const c=compileScene(s);assert.equal(c.manifest.cellsHash,cellsHash);
    const {assetHash:currentHash,...metadata}=c.manifest;
    assert.equal(metadata.scene.compiler,'scene-1.6.0');assert.equal(hash(metadata),currentHash);
    // Keep the historical assertion: no source, ownership or geometry drift is
    // hidden by merely refreshing a golden hash after a compiler version bump.
    metadata.scene={...metadata.scene,compiler:'scene-1.4.1'};assert.equal(hash(metadata),assetHash);
  }
});
test('room feedback verifies actual host floors and profiles across tower, setback, gallery and court',()=>{
  for(const fixture of [spaceTower,spaceGallery,spaceCourt,spaceSetbackTower])assert.equal(inspectConstruction(fixture()).status,'passed');
  const s=spaceGallery(),zone=s.components.find(c=>c.kind==='roomZone');zone.at.offset[1]++;
  const r=inspectConstruction(s);assert.ok(r.issues.some(i=>i.component===zone.id&&i.code==='room-zone-invalid'&&i.message.includes('floor')));
  const limited=inspectConstruction(spaceGallery(),{maxProfileWork:1});assert.equal(limited.status,'incomplete');assert.ok(limited.skippedComponents.length>0);assert.equal(limited.canAuthorizePlacement,false);
});
