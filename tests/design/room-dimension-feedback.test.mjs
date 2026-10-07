import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {sceneSchema,validateScene} from '../../contracts/scene-spec.schema.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {correctionFeedback} from '../../src/design/correction-feedback.mjs';
import {basicScene,mass,at,once} from './fixtures.mjs';
import {storeyRoom} from './floor-components-fixtures.mjs';

const wall=(face,openings=[])=>({face,material:'wall',openings});
const portal=(extra={})=>({u:1,width:1,height:2,door:null,hinge:'left',open:false,...extra});
function fixture(kind,footprint=[2,4],boundaries=[wall('north')]){
 const s=basicScene('partition-dimensions');s.constraints={interior:false,walkable:false,passages:[]};
 const host=mass('body',[2,0,2],[24,20,24],[5,10,15]);
 const common={boundaries:structuredClone(boundaries),use:'room',floorMaterial:'floor'};
 const room=kind==='storeyRoom'?storeyRoom('services','body',{offset:[2,2],footprint,
  floors:{source:'body',first:0,count:3},...common}):{id:'services',kind:'roomZone',host:'body',
  at:at([4,0,4]),repeat:{...once},size:[footprint[0],5,footprint[1]],purpose:'Synthetic service room',allowOverwrite:[],...common};
 s.components=[host,room];return s;
}
function details(scene){
 const raw=inspectConstruction(scene),compact=correctionFeedback({constructionFeedback:raw,geometryPassed:false,canAuthorizePlacement:false});
 const issue=compact.constructionFeedback.issues.find(i=>i.component==='services');
 return {issue,e:issue.roomZoneFeedback??issue.layoutFeedback?.roomZoneFeedback};
}
for(const kind of ['roomZone','storeyRoom'])for(const [faces,footprint,minimum] of [
 [['east','west'],[2,4],[3,1]],[['north','south'],[4,2],[1,3]],
 [['north','west'],[1,1],[2,2]],[['north','east','south','west'],[2,4],[3,3]]
])test(`${kind} ${faces.join('/')} retains exact invalid footprint and actual-axis requirement ${footprint}`,()=>{
  const s=fixture(kind,footprint,faces.map(face=>wall(face))),before=hash(s);
  assert.doesNotThrow(()=>validateScene(s)); // Descriptions do not silently narrow legacy schema.
  assert.throws(()=>compileScene(s),/partitioned room needs interior width\/depth/);
  const {e,issue}=details(s);assert.equal(e.rule,'partition-footprint');assert.deepEqual(e.footprint,footprint);
  assert.deepEqual(e.minimumFootprint,minimum);assert.deepEqual(e.boundaryFaces,faces);
  assert.deepEqual(e.invalidAxes,footprint.map((n,a)=>n<minimum[a]?['X','Z'][a]:null).filter(Boolean));
  assert.equal(e.canAuthorizePlacement,false);assert.equal(e.geometryChanged,false);assert.equal(hash(s),before);
  if(kind==='storeyRoom'){assert.equal(issue.layoutFeedback.row,0);assert.equal(issue.layoutFeedback.floorIndex,0);}
});
for(const kind of ['roomZone','storeyRoom'])test(`${kind} preserves narrow open zones and requires an explicit partition-layout repair`,()=>{
 for(const use of ['room','circulation']){
  const s=fixture(kind,[2,4],[]);s.components[1].use=use;assert.doesNotThrow(()=>compileScene(s));
 }
 const invalid=fixture(kind,[2,4],[wall('west',[portal()]),wall('east')]),before=hash(invalid);
 assert.throws(()=>compileScene(invalid),/partitioned room/);assert.equal(hash(invalid),before);
 const repaired=structuredClone(invalid);
 if(kind==='storeyRoom')repaired.components[1].footprint=[3,4];else repaired.components[1].size[0]=3;
 const compiled=compileScene(repaired);assert.equal(inspectConstruction(repaired).status,'passed');
 // Successful normal bundles omit diagnosticOnly; failed diagnostic bundles set true.
 assert.equal(compiled.manifest.diagnosticOnly,undefined);assert.equal(hash(invalid),before);
 assert.equal(repaired.components[1].boundaries.length,2);assert.equal(repaired.components[1].boundaries[0].openings.length,1);
});
test('a floor-linked opening reports the actual exceptional floor, not a typical copied height',()=>{
 const s=fixture('storeyRoom',[4,4],[wall('north',[portal({height:3})])]);
 s.components[0].levels=[5,8,15];const before=hash(s);
 assert.throws(()=>compileScene(s),/room opening exceeds side\/head margins/);
 const {e,issue}=details(s);assert.equal(issue.layoutFeedback.floorIndex,1);assert.equal(issue.layoutFeedback.row,1);
 assert.equal(e.size[1],3);assert.equal(e.maximumHeight,2);assert.equal(e.opening.height,3);assert.equal(hash(s),before);
 s.components[1].boundaries[0].openings[0].height=2;assert.doesNotThrow(()=>compileScene(s));
});
for(const kind of ['roomZone','storeyRoom'])for(const [face,opening] of [
 ['north',portal({width:2})],['east',portal({u:0})],['south',portal({height:5})]
])test(`${kind} ${face} opening feedback preserves exact side/head arithmetic`,()=>{
 const s=fixture(kind,[3,4],[wall(face,[opening])]),before=hash(s);
 assert.throws(()=>compileScene(s),/room opening exceeds side\/head margins/);
 const {e}=details(s);assert.equal(e.rule,'boundary-opening-margins');assert.equal(e.face,face);
 assert.deepEqual(e.opening,opening);assert.equal(e.minimumU,1);assert.equal(e.endExclusive,opening.u+opening.width);
 assert.equal(e.maximumEndExclusive,e.span-1);assert.equal(e.maximumHeight,e.size[1]-1);
 assert.equal(e.canAuthorizePlacement,false);assert.equal(e.geometryChanged,false);assert.equal(hash(s),before);
});
test('schema and prompt expose conditional partitions without changing supported field families',async()=>{
 const branch=kind=>sceneSchema.$defs.component.anyOf.find(s=>s.properties.kind.enum.includes(kind));
 for(const kind of ['roomZone','storeyRoom']){
  const p=branch(kind).properties;assert.match(p.boundaries.description,/width>=1\+west\+east, depth>=1\+north\+south/);
  assert.match(p[kind==='roomZone'?'size':'footprint'].description,/width>=1\+west\+east, depth>=1\+north\+south/);
 }
 assert.equal(branch('roomZone').properties.size.items.minimum,1);
 assert.equal(branch('storeyRoom').properties.footprint.items.minimum,1);
 const prompt=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
 assert.match(prompt,/ROOM PARTITION ARITHMETIC \(roomZone AND storeyRoom\)/);
 assert.match(prompt,/width-2 opening at u=1 needs span>=4/);
 assert.match(prompt,/check EVERY selected storey/);
});
