// Hand-authored integration probes. Never provided to a model as design templates.
import {basicScene,at,once,mass,shape} from './fixtures.mjs';
import {profileMass,chamfer} from './profile-fixtures.mjs';

export const edgeFacade=(id,host,edge,extra={})=>({id,kind:'edgeFacade',host,edge,margin:2,start:[3,1],size:[4,4],count:[1,3],step:[5,5],borders:[0,0,0,0],recess:0,frame:'frame',glazing:'glass',lattice:false,exclude:[],allowOverwrite:[],...extra});
export const roomZone=(id,host,origin,size,extra={})=>({id,kind:'roomZone',host,at:at(origin),size,repeat:once,use:'room',purpose:'Explicit offline spatial allocation',floorMaterial:'floor',boundaries:[],allowOverwrite:[],...extra});
const wall=(face,openings=[],material='glass')=>({face,material,openings});
const portal=(u,width=2,door=null)=>({u,width,height:2,door,hinge:'left',open:false});
const voidBox=(id,origin,size,allowOverwrite,repeat=once)=>({id,kind:'void',at:at(origin),size,repeat,allowOverwrite});
const state=extra=>({facing:null,half:null,hinge:null,open:null,shape:null,axis:null,type:null,...extra});
const part=(nodeId,origin,size,material,blockState=null)=>({nodeId,op:'box',origin,size,material,thickness:1,axis:'x',repeat:once,points:[],blockState});
const moduleAt=(id,module,origin,extra={})=>({id,kind:'module',module,at:at(origin),values:[],rotation:0,mirror:false,repeat:once,allowOverwrite:[],...extra});
const deskModule=()=>({id:'workBay',parameters:[],size:[6,3,5],nodes:[
 part('legs',[0,0,0],[1,1,2],'polished_deepslate'),part('legs2',[5,0,0],[1,1,2],'polished_deepslate'),
 part('surface',[0,1,0],[6,1,2],'birch_slab',state({type:'top'})),
 part('screens',[1,2,0],[1,1,1],'black'),part('screens2',[4,2,0],[1,1,1],'black'),
 part('chair',[1,0,3],[1,1,1],'oak_stairs',state({facing:'south',half:'bottom',shape:'straight'})),
 part('chair2',[4,0,3],[1,1,1],'oak_stairs',state({facing:'south',half:'bottom',shape:'straight'}))
]});
const meetingModule=()=>({id:'meetingTable',parameters:[],size:[9,3,7],nodes:[
 part('pedestal',[3,0,2],[3,1,3],'polished_deepslate'),part('table',[2,1,1],[5,1,5],'quartz_slab',state({type:'top'})),
 ...[1,3,5].flatMap((z,i)=>[part('chairW'+i,[0,0,z],[1,1,1],'birch_stairs',state({facing:'west',half:'bottom',shape:'straight'})),part('chairE'+i,[8,0,z],[1,1,1],'birch_stairs',state({facing:'east',half:'bottom',shape:'straight'}))])
]});

/** 224 m integration tower, not a refined architectural design or fire-code claim.
 * Open core portals deliberately enable conservative walking tests. They are NOT fire doors.
 * Shafts are enclosed and inert; labels do not claim working lifts or plumbing.
 */
export function spaceTower(){
 const s=basicScene('scene-space-tower');s.bounds={width:64,height:240,length:64};
 const levels=Array.from({length:44},(_,i)=>(i+1)*5),typical={count:43,step:[0,5,0]},floors={count:44,step:[0,5,0]},all={count:45,step:[0,5,0]};
 s.design={style:'Offline circulation and room-expression probe',concept:'Two stair routes, enclosed inert shafts, discrete office and meeting zones. Open portals are not fire doors. Not model quality evidence.',silhouette:'224-block chamfered constant section',paletteIntent:'Restrained pale slab bands, frameless glazing and timber furniture',features:['Two independent stair routes','Enclosed inert elevator shafts','Zoned office floors']};
 s.components=[profileMass('body',[4,0,4],[56,224,56],chamfer(56,56,10),levels,{material:'smooth_quartz',floorMaterial:'smooth_stone',roofMaterial:'polished_deepslate'}),
  mass('core',[22,0,22],[20,224,20],levels,{material:'stone_bricks',floorMaterial:'smooth_stone',roofMaterial:'polished_deepslate',allowOverwrite:['body']}),
  shape('stairAWallE',[29,1,23],[1,222,6],'stone_bricks',{stage:'structure',allowOverwrite:['core']}),
  shape('stairAWallS',[23,1,28],[6,222,1],'stone_bricks',{stage:'structure',allowOverwrite:['core']}),
  shape('stairBWallW',[34,1,35],[1,222,6],'stone_bricks',{stage:'structure',allowOverwrite:['core']}),
  shape('stairBWallN',[35,1,35],[6,222,1],'stone_bricks',{stage:'structure',allowOverwrite:['core']}),
  ...[29,35].map((z,i)=>mass('liftEnclosure'+i,[23,0,z],[5,224,5],[],{material:'stone_bricks',floorMaterial:'smooth_stone',roofMaterial:'polished_deepslate',allowOverwrite:['core']})),
  ...[29,35].map((z,i)=>voidBox('liftAir'+i,[24,1,z+1],[3,222,3],['liftEnclosure'+i])),
  ...[29,35].map((z,i)=>shape('fixedLiftFront'+i,[27,1,z+1],[1,2,3],'polished_andesite',{repeat:all,allowOverwrite:['liftEnclosure'+i]})),
  {id:'stairA',kind:'stairs',at:at([23,0,23]),size:[6,8,5],host:'core',style:'switchback',rotation:2,width:2,rise:5,material:'stone_bricks',repeat:floors,allowOverwrite:[]},
  {id:'stairB',kind:'stairs',at:at([35,0,36]),size:[6,8,5],host:'core',style:'switchback',rotation:0,width:2,rise:5,material:'stone_bricks',repeat:floors,allowOverwrite:[]},
  voidBox('stairAPortal',[29,1,24],[1,2,2],['stairAWallE'],all),voidBox('stairBPortal',[34,1,37],[1,2,2],['stairBWallW'],all),
  voidBox('coreNorthPortal',[31,1,22],[2,2,1],['core'],all),voidBox('coreSouthPortal',[31,1,41],[2,2,1],['core'],all),
  voidBox('coreEastPortal',[41,1,32],[1,2,2],['core'],all),voidBox('coreWestPortal',[22,1,32],[1,2,2],['core'],all),
  voidBox('entryOpening',[31,1,4],[2,3,1],['body']),
  {id:'entryPaving',kind:'path',at:at([30,0,0]),size:[4,1,4],material:'smooth_stone',clearance:2,repeat:once,allowOverwrite:[]}
 ];
 const zones=[
  ['coreRoute','core',[30,0,23],[4,5,18]],['ringNorth','body',[19,0,19],[26,5,3]],['ringSouth','body',[19,0,42],[26,5,3]],
  ['ringWest','body',[19,0,22],[3,5,20]],['ringEast','body',[42,0,22],[3,5,20]]
 ];
 for(const [id,host,o,size] of zones){s.components.push(roomZone(id,host,o,size,{repeat:floors,use:'circulation',floorMaterial:'smooth_stone'}));s.components.push(roomZone(id+'Top',host,[o[0],220,o[2]],[size[0],3,size[2]],{use:'circulation',floorMaterial:'smooth_stone'}));}
 s.components.push(
  roomZone('lobby','body',[16,0,6],[32,5,13],{purpose:'Ground-floor lobby',floorMaterial:'smooth_quartz'}),
  roomZone('office','body',[16,5,6],[32,5,13],{repeat:typical,purpose:'Open work bays with a shared south circulation edge',floorMaterial:'birch_planks',boundaries:[wall('south',[portal(15)])]}),
  roomZone('meeting','body',[45,5,23],[13,5,18],{repeat:typical,purpose:'Meeting rooms with a west-side opening',floorMaterial:'oak',boundaries:[wall('west',[portal(8)]),wall('north'),wall('south')]}),
  roomZone('quiet','body',[6,5,23],[13,5,18],{repeat:typical,purpose:'Quiet working zone',floorMaterial:'birch_planks',boundaries:[wall('east',[portal(8)]),wall('north'),wall('south')]}),
  roomZone('shared','body',[20,5,45],[24,5,13],{repeat:typical,purpose:'Shared collaboration space',floorMaterial:'oak',boundaries:[wall('north',[portal(11)])]}),
  roomZone('service','core',[35,0,24],[6,5,10],{repeat:floors,purpose:'Service space reservation, not functional plumbing',floorMaterial:'smooth_quartz',boundaries:[wall('west',[portal(2)],'stone_bricks'),wall('north',[],'stone_bricks'),wall('south',[],'stone_bricks')]}));
 for(let edge=0;edge<8;edge++)s.components.push(edgeFacade('edge'+edge,'body',edge,{start:[edge%2?2:3,1],size:[6,4],count:[edge%2?1:4,44],step:[8,5],glazing:'blue_glass',frame:'smooth_quartz',exclude:edge===0?[[0,0],[1,0],[2,0],[3,0]]:[]}));
 s.modules=[deskModule(),meetingModule()];
 for(const x of [17,25,33,41])s.components.push(moduleAt('desks'+x,'workBay',[x,6,8],{repeat:typical}));
 s.components.push(moduleAt('conference','meetingTable',[47,6,28],{repeat:typical}),moduleAt('collaboration','meetingTable',[27,6,49],{repeat:typical}),
  shape('lobbyDesk',[18,2,8],[7,1,2],'birch_slab',{blockState:state({type:'top'})}),
  shape('lobbyDeskBase',[19,1,8],[5,1,2],'polished_deepslate'),
  shape('officeLights',[20,9,14],[1,1,1],'light',{repeat:typical}),shape('meetingLights',[50,9,32],[1,1,1],'light',{repeat:typical}));
 s.reservations=[29,35].map((z,i)=>({id:'liftReserve'+i,at:at([24,1,z+1]),size:[3,222,3],allowedComponents:[]}));
 s.featureBindings=[{feature:'Two stair routes',components:['stairA','stairB']},{feature:'Enclosed inert lift shafts',components:['liftAir0','liftAir1','fixedLiftFront0','fixedLiftFront1']},{feature:'Office and meeting rooms',components:['office','meeting','desks17','conference']}];
 s.constraints={interior:true,walkable:true,passages:[{origin:[31,1,0],size:[1,2,1]},...[0,...levels].flatMap(y=>[[31,y+1,25],[28,y+1,25],[35,y+1,38],...(y>0&&y<220?[[31,y+1,16],[46,y+1,32]]:[])].map(origin=>({origin,size:[1,2,1]})))]};
 return structuredClone(s);
}

export function spaceGallery(){
 const s=basicScene('scene-space-gallery');s.bounds={width:40,height:20,length:36};s.constraints={interior:true,walkable:true,passages:[{origin:[8,1,8],size:[1,2,1]},{origin:[11,1,24],size:[1,2,1]}]};
 s.design={style:'Offline L-plan gallery',concept:'Distinct public rooms and a protected circulation spine; technical expression probe',silhouette:'Low folded gallery',paletteIntent:'Pale walls, tall glass and timber seats',features:['Glazed reentrant edge','Connected galleries']};
 s.components=[profileMass('body',[4,0,4],[28,14,28],[[0,0],[28,0],[28,10],[16,10],[16,28],[0,28]],[],{material:'white_terracotta',floorMaterial:'smooth_stone',roofMaterial:'smooth_quartz'}),
  edgeFacade('northLight','body',0,{start:[2,2],size:[5,7],count:[4,1],step:[6,0]}),edgeFacade('recessLight','body',2,{start:[2,2],size:[8,7],count:[1,1],step:[0,0]}),
  roomZone('entryRoom','body',[6,0,6],[23,10,6],{purpose:'Orientation gallery',floorMaterial:'oak'}),roomZone('spine','body',[6,0,12],[3,10,17],{use:'circulation',purpose:'Continuous visitor route',floorMaterial:'smooth_stone'}),
  roomZone('exhibition','body',[9,0,15],[9,10,14],{purpose:'Quiet display room',floorMaterial:'birch_planks',boundaries:[wall('west',[portal(6,3)],'white_terracotta')]}),
  shape('exhibit',[13,1,20],[2,2,2],'smooth_quartz'),shape('seat',[11,1,26],[4,1,1],'birch_slab',{blockState:state({type:'bottom'})})];
 return structuredClone(s);
}

/** Same functional core across a deliberate 120m setback; explicit upper layouts. */
export function spaceSetbackTower(){
 const s=spaceTower();s.id='scene-space-setback-tower';
 // JSON transport has no shared object references; isolate fixture helper aliases
 // before intentionally changing only selected repeated ranges.
 for(const c of s.components)if(c.repeat)c.repeat=structuredClone(c.repeat);
 s.design.silhouette='224-block tower with an explicit setback at 120m';
 s.design.concept+=' Upper footprint, facade and room extents are explicitly redesigned; no automatic cropping.';
 const base=s.components.find(c=>c.id==='body');base.size[1]=120;base.roof=false;base.levels=base.levels.filter(y=>y<120);
 const upper=profileMass('upper',[8,120,8],[48,104,48],chamfer(48,48,8),Array.from({length:20},(_,i)=>(i+1)*5),{material:'smooth_quartz',floorMaterial:'smooth_stone',roofMaterial:'polished_deepslate'});
 s.components.splice(1,0,upper);s.components.find(c=>c.id==='core').allowOverwrite.push('upper');
 const additions=[];
 for(const c of s.components){
  if(c.kind==='edgeFacade'){
   c.count[1]=24;const u=structuredClone(c);u.id+='Upper';u.host='upper';u.count=[c.edge%2?1:3,20];u.size[0]=c.edge%2?4:6;u.exclude=[];additions.push(u);
  }else if(c.kind==='roomZone'&&c.host==='body'){
   if(c.at.offset[1]===220){c.host='upper';continue;}
   if(c.repeat.count===1)continue;
   const first=c.at.offset[1];c.repeat.count=first===0?24:23;
   const u=structuredClone(c);u.id+='Upper';u.host='upper';u.at.offset[1]=first===0?120:125;u.repeat.count=first===0?20:19;
   if(c.id==='office'){u.at.offset[0]=18;u.at.offset[2]=10;u.size=[28,5,9];u.boundaries[0].openings[0].u=13;}
   if(c.id==='meeting'){u.size[0]=10;}
   if(c.id==='quiet'){u.at.offset[0]=9;u.size[0]=10;}
   if(c.id==='shared'){u.size[2]=9;}
   additions.push(u);
  }else if((c.kind==='module'||c.kind==='shape')&&c.repeat.count===43){
   c.repeat.count=23;const u=structuredClone(c);u.id+='Upper';u.at.offset[1]+=120;u.repeat.count=19;
   if(c.id.startsWith('desks')){if(c.id==='desks41')continue;u.at.offset[0]+=2;u.at.offset[2]=12;}
   if(c.id==='conference')u.at.offset[0]=46;
   if(c.id==='collaboration')u.at.offset[2]=47;
   additions.push(u);
  }
 }
 s.components.push(...additions);
 // Additional interfaces immediately below, at and above the transfer level.
 s.constraints.passages.push(...[115,120,125].map(y=>({origin:[31,y+1,20],size:[1,2,1]})));
 return s;
}

export function spaceCourt(){
 const s=basicScene('scene-space-court');s.bounds={width:40,height:20,length:36};s.constraints={interior:true,walkable:true,passages:[{origin:[7,1,8],size:[1,2,1]},{origin:[7,1,24],size:[1,2,1]},{origin:[29,1,24],size:[1,2,1]}]};
 s.design={style:'Offline U-plan reading court',concept:'Two reading wings connected behind an untouched courtyard; not model aesthetic evidence',silhouette:'Three linked brick wings',paletteIntent:'Brick, timber and restrained window bands',features:['Untouched courtyard','Connected reading wings']};
 s.components=[profileMass('body',[4,0,4],[32,10,28],[[0,0],[32,0],[32,28],[22,28],[22,10],[10,10],[10,28],[0,28]],[],{material:'bricks',floorMaterial:'oak',roofMaterial:'dark_oak'}),
  ...[3,5].map(edge=>edgeFacade('courtGlazing'+edge,'body',edge,{start:[2,2],size:[4,4],count:[3,1],step:[5,0],borders:[0,0,0,1],frame:'dark_oak'})),
  roomZone('link','body',[6,0,6],[28,7,6],{use:'circulation',floorMaterial:'oak'}),
  roomZone('westReading','body',[6,0,14],[6,7,16],{floorMaterial:'birch_planks',purpose:'Reading wing with individual seats'}),
  roomZone('eastReading','body',[28,0,14],[6,7,16],{floorMaterial:'birch_planks',purpose:'Group study wing'}),
  shape('westShelves',[10,1,16],[1,3,12],'dark_oak'),shape('eastShelves',[32,1,16],[1,3,12],'dark_oak'),
  shape('westSeats',[7,1,17],[1,1,1],'oak_stairs',{blockState:state({facing:'east',half:'bottom',shape:'straight'}),repeat:{count:3,step:[0,0,4]}}),
  shape('eastSeats',[30,1,17],[1,1,1],'oak_stairs',{blockState:state({facing:'west',half:'bottom',shape:'straight'}),repeat:{count:3,step:[0,0,4]}})];
 return structuredClone(s);
}
