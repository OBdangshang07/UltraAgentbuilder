import {basicScene,mass,worldHighrise} from './fixtures.mjs';

// Engineering data only. Never supplied to a model as a building template.
export function storeyFacade(id='panels',host='main',face='north',extra={}){
  return {id,kind:'storeyFacade',host,face,allowOverwrite:[],margin:2,
    columns:{width:4,gap:2,count:'fit',align:'center'},floors:{first:0,count:4},insets:[1,0],
    borders:[0,0,0,0],recess:0,frame:'frame',glazing:'glass',lattice:false,projection:0,sill:0,shade:0,exclude:[],...extra};
}
export function storeyStudy(face='north',extra={}){
  const s=basicScene('storey-layout-study');s.constraints={interior:false,walkable:false,passages:[]};s.bounds={width:40,height:24,length:40};
  s.components=[mass('main',[7,0,7],[26,22,26],[5,10,16]),storeyFacade('panels','main',face,extra)];return s;
}
export function storeyWorldTower(){
  const s=worldHighrise();s.id='storey-world-tower';
  s.components.push(storeyFacade('panels','main','south',{floors:{first:0,count:44}}));return s;
}
