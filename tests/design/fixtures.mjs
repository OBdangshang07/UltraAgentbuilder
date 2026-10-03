// Hand-authored expression tests, never counted as live model quality results.
export const at=(offset,relativeTo=null,anchor='min')=>({relativeTo,anchor,offset});
export const once={count:1,step:[0,0,0]};
export const palette=[['wall','sandstone'],['floor','oak'],['roof','dark_oak'],['glass','glass'],['frame','spruce'],['lamp','sea_lantern'],['beam','stripped_oak_log'],['paving','stone_bricks'],['foliage','leaves'],['door','oak_door'],['slab','stone_brick_slab'],['stairs','oak_stairs']].map(([role,material])=>({role,material}));
export const shape=(id,origin,size,material='frame',extra={})=>({id,kind:'shape',at:at(origin),size,material,op:'box',axis:'x',thickness:1,points:[],blockState:null,stage:'detail',repeat:once,allowOverwrite:[],...extra});
export const mass=(id,origin,size,levels=[],extra={})=>({id,kind:'mass',at:at(origin),size,material:'wall',floorMaterial:'floor',roofMaterial:'roof',thickness:1,levels,roof:true,repeat:once,allowOverwrite:[],...extra});
export const facade=(id,host,face,extra={})=>({id,kind:'facade',host,face,allowOverwrite:[],margin:1,start:[2,2],count:[3,1],step:[5,6],size:[4,4],frame:'frame',glazing:'glass',lattice:false,projection:1,sill:1,shade:1,exclude:[],...extra});
export const entry=(id,host,extra={})=>({id,kind:'entry',host,face:'north',u:10,feet:1,width:2,door:'door',frame:'frame',threshold:true,thresholdMaterial:'floor',canopy:2,open:true,allowOverwrite:[],...extra});
export function basicScene(id='study'){
 return {format:'SceneSpec',version:1,id,seed:42,bounds:{width:36,height:24,length:32},design:{style:'Hand-authored test',concept:'Expression fixture, not model evidence',silhouette:'Asymmetric volumes',paletteIntent:'Warm masonry / timber',features:['Layered openings']},palette:structuredClone(palette),modules:[],components:[],reservations:[],featureBindings:[],constraints:{interior:true,walkable:true,passages:[]}};
}
// Expression probes only. New options are not automatically applied to user designs.
export function panelCourtyard(){
 const s=courtyard();s.id='scene-panel-courtyard';
 for(const c of s.components)if(['rear','east','west'].includes(c.id))Object.assign(c,{kind:'panelFacade',borders:[0,0,0,1],recess:0,sill:0,shade:0});
 return s;
}
export function panelTeahouse(){
 const s=teahouse();s.id='scene-panel-teahouse';
 Object.assign(s.components.find(c=>c.id==='latticeBack'),{kind:'panelFacade',borders:[1,1,0,1],recess:0,size:[6,5],count:[3,1],step:[7,0],start:[1,1],sill:0,shade:0,glazing:null});
 return s;
}
export function panelHighrise(){
 const s=highrise();s.id='scene-panel-cbd-224';
 for(const c of s.components)if(c.kind==='facade')Object.assign(c,{kind:'panelFacade',borders:[0,0,0,0],recess:0,projection:0,sill:0,shade:0});
 return s;
}
export function panelWorldHighrise(){
 const s=worldHighrise();s.id='scene-panel-world-highrise';
 for(const face of ['north','south','east','west'])s.components.push({...facade('panel_'+face,'main',face,{start:[2,1],size:[9,4],count:[2,44],step:[12,5],projection:0,sill:0,shade:0,exclude:face==='north'?[[1,0]]:[]}),kind:'panelFacade',borders:[0,0,0,0],recess:0});
 return s;
}
export function instanceStudy(){
 const s=basicScene('scene-instance-study');s.constraints={interior:false,walkable:false,passages:[]};
 s.modules=[{id:'deskBay',parameters:[],size:[4,4,5],nodes:[{nodeId:'desk',op:'box',origin:[1,1,1],size:[2,1,2],material:'frame',thickness:1,axis:'x',repeat:once,points:[],blockState:null},{nodeId:'leg',op:'box',origin:[1,0,1],size:[1,1,2],material:'beam',thickness:1,axis:'x',repeat:once,points:[],blockState:null}]}];
 s.components=[{id:'desks',kind:'module',at:at([3,1,3]),module:'deskBay',values:[],rotation:0,mirror:false,repeat:{count:4,step:[6,0,0]},allowOverwrite:[]},{id:'otherDesks',kind:'module',at:at([3,1,14]),module:'deskBay',values:[],rotation:0,mirror:false,repeat:{count:2,step:[6,0,0]},allowOverwrite:[]}];return s;
}
export function worldHighrise(){
 const s=basicScene('scene-world-highrise');s.bounds={width:32,height:224,length:32};
 s.design={style:'Offline world regression',concept:'Functional repeated-floor fixture; not AI design-quality evidence',silhouette:'224-block engineering tower',paletteIntent:'Stable full blocks for navigation regression',features:['Repeated floors and common landings']};
 const levels=Array.from({length:43},(_,i)=>(i+1)*5);
 s.components=[mass('main',[2,0,2],[28,224,28],levels),
  {id:'entrance',kind:'void',at:at([15,1,2]),size:[2,3,1],repeat:once,allowOverwrite:['main']},
  {id:'flights',kind:'stairs',at:at([5,0,5]),size:[6,8,5],host:'main',style:'switchback',rotation:2,width:2,rise:5,material:'floor',repeat:{count:43,step:[0,5,0]},allowOverwrite:[]}];
 s.constraints={interior:true,walkable:true,passages:[0,...levels].map(y=>({origin:[15,y+1,15],size:[1,2,1]}))};
 return s;
}
// Engineering regression only, never an architectural template sent to a model.
export function fourMetreWorldTower(){
 const s=basicScene('scene-four-metre-world-tower');s.bounds={width:24,height:224,length:24};
 const levels=Array.from({length:54},(_,i)=>8+i*4);
 s.components=[mass('main',[1,0,1],[22,224,22],levels),{id:'entrance',kind:'void',at:at([3,1,1]),size:[2,3,1],repeat:once,allowOverwrite:['main']},
  {id:'lobbyStair',kind:'stairs',at:at([6,0,6]),size:[5,11,6],host:'main',style:'switchback',rotation:1,width:2,rise:8,material:'floor',repeat:once,allowOverwrite:[]},
  {id:'officeStairs',kind:'stairs',at:at([6,8,6]),size:[5,7,6],host:'main',style:'switchback',rotation:1,width:2,rise:4,material:'floor',repeat:{count:53,step:[0,4,0]},allowOverwrite:[]}];
 s.constraints.passages=[0,...levels].map(y=>({origin:[3,y+1,3],size:[1,2,1]}));return s;
}
export function courtyard(){
 const s=basicScene('scene-courtyard');s.components=[
  mass('main',[6,1,7],[24,15,20],[7]),
  {id:'court',kind:'void',at:at([9,1,6],'main'),size:[6,14,8],repeat:once,allowOverwrite:['main']},
  facade('front','main','north',{count:[4,2],exclude:[[1,0],[2,0]]}),
  facade('rear','main','south',{count:[4,2]}),
  facade('east','main','east',{count:[3,2]}),facade('west','main','west',{count:[3,2]}),
  entry('entrance','main'),
  {id:'stair',kind:'stairs',at:at([2,0,4],'main'),size:[6,10,5],host:'main',style:'switchback',rotation:0,width:2,rise:7,material:'stairs',repeat:once,allowOverwrite:[]},
  {id:'pergola',kind:'pergola',at:at([2,1,1]),size:[10,5,5],material:'roof',postMaterial:'beam',spacing:2,axis:'x',repeat:once,allowOverwrite:[]},
  {id:'planter',kind:'planter',at:at([25,0,1]),size:[7,3,4],material:'wall',foliage:'foliage',repeat:once,allowOverwrite:[]},
  {id:'path',kind:'path',at:at([16,1,1]),size:[2,1,6],material:'paving',clearance:3,repeat:once,allowOverwrite:[]}
 ];s.featureBindings=[{feature:'Courtyard facade and pergola',components:['front','pergola']}];return structuredClone(s);
}
export function teahouse(){
 const s=basicScene('scene-teahouse');s.palette.find(p=>p.role==='wall').material='white_terracotta';s.palette.find(p=>p.role==='frame').material='dark_oak';
 s.components=[mass('hall',[7,1,8],[23,8,18],[],{roof:false}),shape('roof',[5,9,6],[27,8,22],'roof',{op:'gableRoof'}),
  facade('latticeFront','hall','north',{start:[2,1],count:[4,1],exclude:[[2,0]],size:[4,5],lattice:true,shade:0}),facade('latticeBack','hall','south',{start:[2,1],count:[4,1],size:[4,5],lattice:true,shade:0}),
  entry('entrance','hall',{u:12,canopy:0}),
  {id:'porch',kind:'pergola',at:at([7,1,3]),size:[23,7,4],material:'roof',postMaterial:'beam',spacing:5,axis:'x',repeat:once,allowOverwrite:[]},
  shape('veranda',[5,0,3],[27,1,26],'paving'),
  shape('lowTables',[10,2,13],[3,1,2],'frame',{at:at([3,1,5],'hall'),allowOverwrite:['hall'],repeat:{count:3,step:[6,0,0]}})
 ];return structuredClone(s);
}
export function commercial(){
 const s=basicScene('scene-commercial');s.bounds={width:44,height:34,length:38};s.palette.find(p=>p.role==='wall').material='bricks';s.palette.find(p=>p.role==='frame').material='polished_andesite';
 s.components=[mass('podium',[5,1,6],[34,10,27],[5]),mass('upper',[9,11,9],[26,15,21],[5,10]),
  facade('shopfront','podium','north',{start:[2,1],count:[6,1],size:[4,4],exclude:[[3,0]]}),entry('mainEntry','podium',{u:17}),
  ...['north','south'].map((face,i)=>facade('upper'+i,'upper',face,{start:[2,1],count:[4,3],step:[6,4],size:[4,3]})),
  shape('crown',[13,26,12],[17,4,15],'frame'),
  {id:'terrace',kind:'balcony',at:at([5,10,6]),size:[34,2,4],material:'floor',railMaterial:'frame',openFace:'south',repeat:once,allowOverwrite:['podium','upper']},
  {id:'streetBeds',kind:'planter',at:at([5,0,1]),size:[10,3,4],material:'paving',foliage:'foliage',repeat:{count:2,step:[24,0,0]},allowOverwrite:[]}
 ];return structuredClone(s);
}
export function highrise(){
 const s=basicScene('scene-cbd-224');s.bounds={width:64,height:240,length:64};s.design={style:'CBD engineering fixture',concept:'Offset crown with vertical masonry fins and a glass lantern',silhouette:'224-block tower with stepped shoulders',paletteIntent:'Stone ribs, cool glass, warm lobby',features:['Continuous core','Repeated office interiors','Four-sided facade','Articulated crown']};
 s.palette.find(p=>p.role==='wall').material='smooth_quartz';s.palette.find(p=>p.role==='frame').material='polished_deepslate';s.palette.find(p=>p.role==='glass').material='blue_glass';
 const levels=Array.from({length:43},(_,i)=>i*5);
 s.components=[mass('tower',[12,1,12],[40,216,40],levels),mass('core',[25,1,25],[14,216,14],levels,{material:'paving',allowOverwrite:['tower']}),
  ...['north','south','east','west'].map((face,i)=>facade('curtain'+i,'tower',face,{start:[2,1],count:[6,43],step:[6,5],size:[4,4],projection:1,sill:0,shade:0,exclude:face==='north'?[[3,0]]:[]})),
  entry('lobbyDoors','tower',{u:20,canopy:3}),
  {id:'escapeStairs',kind:'stairs',at:at([1,0,1],'core'),size:[5,8,5],host:'core',style:'switchback',rotation:0,width:2,rise:5,material:'stairs',repeat:{count:42,step:[0,5,0]},allowOverwrite:[]},
  {id:'shaft',kind:'void',at:at([8,1,2],'core'),size:[3,214,3],repeat:once,allowOverwrite:['core']},
  shape('coreDoors',[0,0,0],[2,3,1],'frame',{at:at([6,1,0],'core'),repeat:{count:43,step:[0,5,0]},allowOverwrite:['core']}),
  shape('officeDesks',[0,0,0],[2,1,3],'floor',{at:at([3,2,4],'tower'),repeat:{count:43,step:[0,5,0]},allowOverwrite:['tower']}),
  shape('officeWall',[0,0,0],[1,3,8],'glass',{at:at([7,1,3],'tower'),repeat:{count:43,step:[0,5,0]},allowOverwrite:['tower']}),
  shape('crown',[16,217,16],[30,8,30],'frame',{op:'arch',thickness:2}),
  shape('crownLantern',[20,217,20],[20,6,20],'glass',{allowOverwrite:['crown']})
 ];s.reservations=[{id:'liftShaft',at:at([8,1,2],'core'),size:[3,214,3],allowedComponents:[]}];s.featureBindings=s.design.features.map((feature,i)=>({feature,components:[['core','escapeStairs','officeDesks','crown'][i]]}));return structuredClone(s);
}
