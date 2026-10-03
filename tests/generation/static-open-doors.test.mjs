import test from 'node:test';
import assert from 'node:assert/strict';
import {walkingGrid} from '../../src/generation/walking-grid.mjs';
import {resolveState} from '../../src/generation/block-states.mjs';
import {staticOpenDoorCollision} from '../../src/generation/static-open-doors.mjs';

function fixture(facing='east',hinge='left',open=true){
 const width=5,height=5,length=5,palette=['@keep','minecraft:air','minecraft:stone',...['lower','upper'].map(half=>resolveState('oak_door',{facing,hinge,open,half}))];
 const cells=new Uint16Array(width*height*length).fill(1);cells.fill(2,0,25);cells[2+2*5+25]=3;cells[2+2*5+50]=4;
 return {cells,palette,width,height,length};
}
for(const facing of ['north','east','south','west'])for(const hinge of ['left','right'])test(`static open door ${facing}/${hinge} has a blocked leaf edge, not unrestricted air`,()=>{
 const f=fixture(facing,hinge),before=f.cells.slice(),g=walkingGrid({...f,staticOpenDoors:true}),strict=walkingGrid(f),shape=staticOpenDoorCollision(f.palette[3]);
 assert.equal(strict.stand(2,1,2),false);assert.equal(g.air(3),false);assert.equal(g.stand(2,1,2),true);assert.equal(g.staticOpenDoorCells,2);
 for(const [dx,dz,face] of [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]]){
  assert.equal(g.step(2,1,2,2+dx,1,2+dz),shape.face!==face);assert.equal(g.step(2+dx,1,2+dz,2,1,2),shape.face!==face);
 }
 assert.deepEqual(f.cells,before);
});
test('closed, unsupported and mismatched paired doors cannot provide extra reachability',()=>{
 for(const change of [f=>{f.palette[3]=resolveState('oak_door',{open:false,half:'lower'});},f=>f.cells[62]=1,f=>f.cells[12]=1,f=>f.palette[4]=resolveState('oak_door',{open:true,facing:'west',half:'upper'})]){
  const f=fixture();change(f);const g=walkingGrid({...f,staticOpenDoors:true});assert.equal(g.stand(2,1,2),false);assert.equal(g.staticOpenDoorCells,0);
 }
 assert.equal(staticOpenDoorCollision('minecraft:oak_trapdoor[open=true]'),null);
 assert.equal(staticOpenDoorCollision('minecraft:unknown_door[open=true]'),null);
});
test('extra door traversal never authorizes stepping up/down through a leaf, KEEP or partial support',()=>{
 const f=fixture();f.cells[3+2*5+25]=2;const g=walkingGrid({...f,staticOpenDoors:true});
 assert.equal(g.stand(3,2,2),true);assert.equal(g.step(2,1,2,3,2,2),false);assert.equal(g.step(3,2,2,2,1,2),false);
 f.cells[37]=0;assert.equal(walkingGrid({...f,staticOpenDoors:true}).stand(2,1,2),false);
});
