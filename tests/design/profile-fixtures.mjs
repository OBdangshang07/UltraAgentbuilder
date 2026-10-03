// Hand-authored expression probes. Not model outputs, templates or quality scores.
import {basicScene,at,once,mass,shape} from './fixtures.mjs';
export const profileMass=(id,origin,size,points,levels=[],extra={})=>({...mass(id,origin,size,levels),kind:'profileMass',points,...extra});
export const chamfer=(w,d,c)=>[[c,0],[w-c,0],[w,c],[w,d-c],[w-c,d],[c,d],[0,d-c],[0,c]];
export function profileTower(){
 const s=basicScene('scene-profile-tower');s.bounds={width:64,height:240,length:64};
 s.constraints={interior:false,walkable:false,passages:[]};
 s.components=[profileMass('body',[8,0,8],[48,192,48],chamfer(48,48,10),Array.from({length:38},(_,i)=>i*5),{material:'blue_glass',floorMaterial:'polished_deepslate',roofMaterial:'polished_deepslate'}),
  profileMass('crown',[14,192,14],[36,32,36],chamfer(36,36,7),[5,10,15,20,25],{material:'glass',floorMaterial:'smooth_quartz',roofMaterial:'smooth_quartz'}),
  mass('core',[27,0,27],[10,190,10],Array.from({length:38},(_,i)=>i*5),{allowOverwrite:['body'],material:'paving',roof:false})];
 s.design={style:'Offline cut-corner volume study',concept:'Constant polygon sections with a smaller upper section; not a furnished or circulation-certified CBD',silhouette:'224-block chamfered tower',paletteIntent:'Glazing with deliberately opaque floor bands',features:['Two polygonal volume sections']};
 return s;
}
export function profileGallery(){
 const s=basicScene('scene-profile-gallery');s.bounds={width:40,height:22,length:36};s.constraints={interior:false,walkable:false,passages:[]};
 s.components=[profileMass('gallery',[4,0,4],[28,14,24],[[0,0],[28,0],[28,10],[16,10],[16,24],[0,24]],[],{material:'white_terracotta',floorMaterial:'stone_bricks',roofMaterial:'smooth_quartz'}),
  {id:'windows',kind:'void',at:at([11,2,4]),size:[3,6,1],repeat:{count:4,step:[5,0,0]},allowOverwrite:['gallery']},
  shape('glazing',[11,2,4],[3,6,1],'glass',{repeat:{count:4,step:[5,0,0]},allowOverwrite:['windows']}),
  {id:'entryHole',kind:'void',at:at([6,1,4]),size:[2,2,1],repeat:once,allowOverwrite:['gallery']},
  {id:'entryDoors',kind:'doorway',host:'entryHole',at:at([0,0,0],'entryHole'),repeat:once,face:'north',width:2,door:'door',hinge:'left',open:false,allowOverwrite:[]},
  shape('benches',[7,1,14],[2,1,5],'slab',{blockState:{facing:null,half:null,hinge:null,open:null,shape:null,axis:null,type:'bottom'},repeat:{count:2,step:[7,0,0]}})];
 s.design={style:'Offline L-plan gallery',concept:'Masonry gallery with a deliberate recess; not AI design evidence',silhouette:'L-shaped low volume',paletteIntent:'Quiet pale masonry and tall openings',features:['Nonrectangular interior and exterior recess']};
 return s;
}
export function profileCourt(){
 const s=basicScene('scene-profile-court');s.bounds={width:40,height:20,length:36};s.constraints={interior:false,walkable:false,passages:[]};
 s.components=[profileMass('wings',[4,0,4],[32,10,28],[[0,0],[32,0],[32,28],[22,28],[22,10],[10,10],[10,28],[0,28]],[],{material:'bricks',floorMaterial:'oak',roofMaterial:'dark_oak'}),
  {id:'arcade',kind:'void',at:at([4,2,8]),size:[1,4,3],repeat:{count:4,step:[0,0,6]},allowOverwrite:['wings']},
  {id:'courtDoorHole',kind:'void',at:at([18,1,13]),size:[2,2,1],repeat:once,allowOverwrite:['wings']},
  {id:'courtDoors',kind:'doorway',host:'courtDoorHole',at:at([0,0,0],'courtDoorHole'),repeat:once,face:'south',width:2,door:'door',hinge:'left',open:false,allowOverwrite:[]}];
 s.design={style:'Offline U-plan courtyard',concept:'Recess stays KEEP; no automatic terrain excavation',silhouette:'Three linked brick wings',paletteIntent:'Warm brick and timber',features:['Untouched courtyard recess']};
 return s;
}
export function profileWorldTower(){
 const s=basicScene('scene-profile-world-tower');s.bounds={width:40,height:224,length:40};
 const levels=Array.from({length:44},(_,i)=>(i+1)*5);
 s.components=[profileMass('body',[2,0,2],[36,224,36],chamfer(36,36,6),levels),
  {id:'flights',kind:'stairs',at:at([10,0,10]),size:[6,8,5],host:'body',style:'switchback',rotation:2,width:2,rise:5,material:'floor',repeat:{count:44,step:[0,5,0]},allowOverwrite:[]}];
 s.constraints={interior:true,walkable:true,passages:[0,...levels].map(y=>({origin:[20,y+1,20],size:[1,2,1]}))};
 return s;
}
