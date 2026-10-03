import {basicScene,mass,worldHighrise} from './fixtures.mjs';
import {assemblyPlan} from './assembly-fixtures.mjs';

export const storeyRoom=(id,host,extra={})=>({id,kind:'storeyRoom',host,allowOverwrite:[],floors:{source:host,first:0,count:4},offset:[2,2],footprint:[8,8],ceilingInset:0,use:'room',purpose:'Offline floor alignment fixture',floorMaterial:'floor',boundaries:[],...extra});
export const storeyOpening=(id,host,face='north',extra={})=>({id,kind:'storeyOpening',host,face,allowOverwrite:[],floors:{source:host,first:0,count:4},u:3,width:2,height:2,door:null,hinge:'left',open:false,...extra});
export function floorStudy(){
  const s=basicScene('floor-layout-study');s.bounds={width:40,height:30,length:40};s.constraints={interior:false,walkable:false,passages:[]};
  s.components=[mass('main',[7,2,7],[26,22,26],[5,10,16]),storeyRoom('rooms','main')];return s;
}
export function floorWorldTower(){
  const s=worldHighrise();s.id='floor-world-tower';
  const main=s.components[0];
  s.components.splice(1,0,mass('core',[4,0,4],[9,224,9],[...main.levels],{allowOverwrite:['main']}));
  s.components.find(c=>c.kind==='stairs').host='core';
  s.components.push(storeyOpening('corePortals','core','east',{floors:{source:'main',first:0,count:44},u:1,width:4,height:3}),
    storeyRoom('officeZone','main',{floors:{source:'main',first:0,count:44},offset:[16,16],footprint:[5,5]}));
  return s;
}
export function floorAssemblyPlan(){
  const p=assemblyPlan(true);p.scene=floorWorldTower();
  p.packages[0].editableComponents=['core','corePortals'];
  p.packages[0].regions=[{origin:[12,0,4],size:[1,224,9]}];
  return p;
}
