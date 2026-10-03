import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene} from '../../src/design/compiler.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {spaceTower,spaceGallery,spaceCourt,spaceSetbackTower} from './space-fixtures.mjs';
import {auditSpaceTower} from './space-audit.mjs';
import {shape} from './fixtures.mjs';

const state=(c,x,y,z)=>c.manifest.palette[c.cells[x+z*c.manifest.dimensions.width+y*c.manifest.dimensions.width*c.manifest.dimensions.length]];
for(const make of [spaceTower,spaceGallery,spaceCourt])test(`${make.name}: combined room, facade and furniture sources are deterministic and collision-free`,()=>{
 const s=make(),before=hash(s),a=compileScene(s),b=compileScene(s);
 assert.equal(hash(s),before);assert.deepEqual(a.binary,b.binary);assert.equal(a.manifest.assetHash,b.manifest.assetHash);
 assert.ok(a.scene.components.some(c=>c.kind==='edgeFacade'));assert.ok(a.scene.components.some(c=>c.kind==='roomZone'));
 assert.ok(a.spec.nodes.length<4096);assert.ok(!a.manifest.diagnosticOnly);assert.equal(a.manifest.scene.diagnostics.length,0);
 // Partial furniture must not be upgraded to a complete collision/door simulation claim.
 assert.equal(a.manifest.quality.navigation,'unverified');assert.ok(a.manifest.quality.issues.some(i=>i.code==='partial-block-collision'));
});
test('224m tower: both stair routes independently reach occupied-floor checkpoints while shafts stay fully enclosed',()=>{
 const c=compileScene(spaceTower()),a=auditSpaceTower(c);
 assert.equal(c.manifest.dimensions.height,240);assert.ok(c.cells.slice(223*64*64,224*64*64).some(v=>v>=2));assert.ok(c.cells.slice(224*64*64).every(v=>v===0));
 assert.equal(a.checkpoints.length,395);assert.ok(a.checkpoints.every(p=>p.reachable));
 assert.equal(a.stairAccessCount,176);assert.equal(a.unverifiedStairAccess,0);
 for(const injected of a.faultInjection.slice(0,2)){assert.ok(injected.changedCells>0);assert.equal(injected.unreachable.length,0);}
 assert.ok(a.faultInjection[2].unreachable.some(p=>p.floor===220));
 for(const shaft of a.shafts){assert.equal(shaft.clear,1998);assert.equal(shaft.nonAir,0);assert.equal(shaft.enclosureHoles,0);}
 // Shaft pit slabs are deliberately inaccessible: retain the conservative warning.
 assert.ok(a.quality.issues.some(i=>i.message.includes('18 disconnected floor cells')));
});
test('nonrectangular court/gallery integration keeps real external recesses and required routes',()=>{
 const court=compileScene(spaceCourt(),{navigationPolicy:'strict'}),gallery=compileScene(spaceGallery(),{navigationPolicy:'strict'});
 for(let y=0;y<10;y++)assert.equal(state(court,20,y,20),'@keep');
 for(let y=0;y<14;y++)assert.equal(state(gallery,24,y,24),'@keep');
 assert.equal(court.manifest.navigation.disconnectedFloorCells,0);assert.equal(gallery.manifest.navigation.disconnectedFloorCells,0);
});
test('furnishing a declared route still fails in a complete combined fixture',()=>{
 const s=spaceCourt();s.components.push(shape('badSeat',[7,1,7],[2,1,2],'oak',{allowOverwrite:['link']}));
 assert.throws(()=>compileScene(s),/Circulation zone was obstructed: link -> badSeat/);
});
test('setback interfaces retain both stair routes and bounded upper rooms without filling external KEEP',()=>{
 const c=compileScene(spaceSetbackTower()),a=auditSpaceTower(c);
 assert.ok(a.checkpoints.every(p=>p.reachable));assert.ok(a.faultInjection.slice(0,2).every(t=>t.unreachable.length===0));
 assert.equal(a.unverifiedStairAccess,0);assert.equal(c.manifest.scene.diagnostics.length,0);
 assert.equal(state(c,5,125,30),'@keep');assert.notEqual(state(c,5,115,30),'@keep');
 assert.equal(state(c,31,120,20),'minecraft:smooth_stone');assert.equal(state(c,31,121,20),'minecraft:air');
 assert.ok(c.designSources.roomZones.some(z=>z.host==='upper'));assert.ok(c.spec.nodes.length<4096);
});
