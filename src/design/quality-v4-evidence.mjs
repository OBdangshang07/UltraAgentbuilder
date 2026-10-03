import {nativeViewsForQualityV3} from './quality-v3-evidence.mjs';
import {lowerScene} from './compiler.mjs';
import {MATERIALS} from '../generation/materials.mjs';

const outwardYaw=face=>({north:180,east:270,south:0,west:90}[face]-20);

/** Separate version: old captures/replays retain their original cameras. Once
 * selected, cameras stay fixed across design revisions for honest comparisons. */
export function nativeViewsForQualityV4(scene,tier,occupiedBounds,baselineViews=null){
  if(baselineViews)return structuredClone(baselineViews);
  const views=nativeViewsForQualityV3(scene,tier,occupiedBounds),lowered=lowerScene(scene),extent=[scene.bounds.width,scene.bounds.height,scene.bounds.length];
  const crop=(view,min,max,framing)=>{
    view.min=min.map((v,i)=>Math.max(0,Math.min(extent[i]-1,Math.floor(v))));
    view.max=max.map((v,i)=>Math.max(view.min[i]+1,Math.min(extent[i],Math.ceil(v))));view.framing=framing;
  };
  const entrance=views.find(v=>v.purpose==='entry'),checkpoint=scene.constraints.passages[0]?.origin;
  if(entrance&&checkpoint&&!scene.components.some(c=>c.kind==='entry')){
    const groups=new Map();
    for(const node of lowered.spec.nodes){
      const material=scene.palette.find(p=>p.role===node.material)?.material??node.material;
      // Semantic door nodes emit both halves later. They deliberately have no
      // half=lower on the source node; testing that field misses these portals.
      if((node.op!=='door'&&node.blockState?.half!=='lower')||!/_door(?:\[|$)/.test(MATERIALS[material]??''))continue;
      const source=lowered.nodeSources[node.nodeId],face=node.blockState?.facing??'north';
      for(let r=0;r<node.repeat.count;r++){
        const origin=node.origin.map((v,i)=>v+r*node.repeat.step[i]),end=origin.map((v,i)=>v+node.size[i]+(i===1&&node.op!=='door'?1:0));
        const key=[source.component,source.instance,origin[1],face].join('/');
        const group=groups.get(key)??{component:source.component,face,min:[...origin],max:[...end]};groups.set(key,group);
        for(let i=0;i<3;i++){group.min[i]=Math.min(group.min[i],origin[i]);group.max[i]=Math.max(group.max[i],end[i]);}
      }
    }
    const distance=g=>checkpoint.reduce((sum,v,i)=>sum+Math.max(g.min[i]-v,v-(g.max[i]-1),0)**2,0);
    const portal=[...groups.values()].sort((a,b)=>distance(a)-distance(b))[0];
    if(portal){
      const center=portal.min.map((v,i)=>(v+portal.max[i])/2),half=['north','south'].includes(portal.face)?[12,6,9]:[9,6,12];
      crop(entrance,center.map((v,i)=>v-half[i]),center.map((v,i)=>v+half[i]),'Source door group '+portal.component+' nearest the first route checkpoint, including semantic paired doors. Local entrance evidence only; entrance role and route accessibility are not certified.');
      entrance.yaw=outwardYaw(portal.face);entrance.pitch=15;
    }
  }
  const section=views.find(v=>v.purpose==='section');
  const featureIds=new Set(scene.featureBindings.filter(f=>/atrium|courtyard|sky.?court|中庭|庭院|挑空/i.test(f.feature)).flatMap(f=>f.components));
  const voids=scene.components.filter(c=>c.kind==='void'&&featureIds.has(c.id)).flatMap(c=>(lowered.componentBounds[c.id]??[]).map(b=>({...b,id:c.id})));
  const atrium=voids.filter(b=>b.size[1]>=6).sort((a,b)=>b.size[1]-a.size[1])[0];
  if(section&&atrium){
    const min=atrium.origin.map((v,i)=>v-(i===1?2:6)),max=atrium.origin.map((v,i)=>v+atrium.size[i]+(i===1?2:6));
    max[0]=atrium.origin[0]+Math.max(1,Math.ceil(atrium.size[0]/2));
    crop(section,min,max,'Vertical section through feature-bound void '+atrium.id+' across its declared height and adjacent interfaces. Shows only this local section; labels, full-building circulation and unobstructed air remain unverified.');section.yaw=-55;section.pitch=15;
  }
  const redundant=views.find(v=>v.id==='exterior-side');
  if(redundant&&extent[1]>64){
    const top=occupiedBounds?.max?.[1]??extent[1]-1,lo=occupiedBounds?.min??[0,0,0],hi=occupiedBounds?.max??extent.map(v=>v-1);
    redundant.id='upper-termination';
    crop(redundant,[lo[0]-2,Math.max(lo[1],top-23),lo[2]-2],[hi[0]+3,top+1,hi[2]+3],'Upper 24 occupied height cells, framed to measured geometry when available. Detail of the actual roof/termination; no claim that a crown was designed or lower levels were inspected.');
    redundant.yaw=-35;redundant.pitch=25;
  }
  return views;
}
