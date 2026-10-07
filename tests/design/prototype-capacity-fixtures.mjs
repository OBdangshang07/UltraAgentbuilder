import {hash} from '../../src/generation/compiler.mjs';
import {basicScene,mass,shape,at} from './fixtures.mjs';
import {storeyRoom} from './floor-components-fixtures.mjs';

// Entirely synthetic capacity probes, never a model answer or design template.
export function retainedDetailsAndServices(){
 const scene=basicScene('prototype-capacity-services');
 scene.bounds={width:32,height:128,length:32};
 scene.constraints={interior:false,walkable:false,passages:[]};
 const details=Array.from({length:64},(_,i)=>shape('detail'+i,[4+i%8*2,114,4+Math.floor(i/8)*2],[1,1,1],'frame'));
 const services=['washroom','pantry','support'].map((id,i)=>storeyRoom(id,'upperHall',{
  floors:{source:'upperHall',first:0,count:1},offset:[21,2+i*6],footprint:[4,4],floorMaterial:'frame',
  boundaries:['north','east','south','west'].map(face=>({face,material:'wall',openings:face==='north'?
   [{u:1,width:1,height:2,door:'door',hinge:'left',open:true}]:[]}))
 }));
 scene.components=[mass('upperHall',[2,113,2],[28,15,28],[8]),...details,...services];
 scene.reservations=[{id:'untouchedSpace',at:at([0,0,0]),size:[1,1,1],allowedComponents:[]}];
 const retained=details.map(c=>({component:c.id,mode:'repeat',count:2,step:[0,8,0]}));
 const program={format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(scene),
  recipes:[...retained,...services.map(c=>({component:c.id,mode:'storeys',count:2,step:[0,0,0]}))]};
 return {scene,program,retained,services:services.map(c=>c.id)};
}

export function fullRecipeCapacity(count=256){
 const scene=basicScene('prototype-capacity-boundary');scene.bounds={width:16,height:4,length:16};
 scene.constraints={interior:false,walkable:false,passages:[]};
 scene.components=Array.from({length:count},(_,i)=>shape('seed'+i,[i%16,0,Math.floor(i/16)],[1,1,1],'frame'));
 const program={format:'ScenePrototypeExpansion',version:1,seedSourceHash:hash(scene),
  recipes:scene.components.map(c=>({component:c.id,mode:'repeat',count:2,step:[0,2,0]}))};
 return {scene,program};
}
