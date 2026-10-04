import {hash} from '../generation/compiler.mjs';
import {nativeViewsForQualityV4} from './quality-v4-evidence.mjs';

const inside=(a,b)=>a.origin.every((v,i)=>v>=b.origin[i]&&v+a.size[i]<=b.origin[i]+b.size[i]);
const end=b=>b.origin.map((v,i)=>v+b.size[i]);
/** Framing only. Geometry is read from the saved, hash-checked cell/owner
 * bundle by the Bridge, never compiled here into a replacement baseline.
 * Authored role/purpose labels do not establish function or design quality. */
export function representativeFloorCameras(scene,tier,actual,representatives){
 const sources=actual.designSources,sourceHash=hash(scene),extent=[scene.bounds.width,scene.bounds.height,scene.bounds.length];
 if(actual.manifest.scene.sourceHash!==sourceHash||sources.sourceHash!==sourceHash||
  hash(actual.manifest.dimensions)!==hash(scene.bounds))throw Error('Representative cameras changed saved source/dimensions');
 const role=representatives?.['typical-floor-core']?.find(r=>r.kind==='typical-floor');
 if(!role?.components?.length||new Set(role.components).size!==role.components.length||
  role.components.some(id=>!scene.components.some(c=>c.id===id)))throw Error('Missing bound staged typical-floor responsibility');
 const ids=new Set(role.components),{width:w,height:h,length:d}=actual.manifest.dimensions;
 const index=(x,y,z)=>x+z*w+y*w*d,candidates=[];
 let occupiedMin=[w,h,d],occupiedMax=[-1,-1,-1];
 for(let i=0;i<actual.cells.length;i++)if(actual.cells[i]>=2){
  const p=[i%w,Math.floor(i/(w*d)),Math.floor(i/w)%d];
  for(let a=0;a<3;a++){occupiedMin[a]=Math.min(occupiedMin[a],p[a]);occupiedMax[a]=Math.max(occupiedMax[a],p[a]);}
 }
 const occupiedBounds=occupiedMax[0]>=0?{min:occupiedMin,max:occupiedMax}:null;
 const views=nativeViewsForQualityV4(scene,tier,occupiedBounds);
 const floors=[];
 for(const c of scene.components.filter(c=>['mass','profileMass'].includes(c.kind)))
  for(const [instance,b] of (sources.componentBounds[c.id]??[]).entries()){
   const levels=[...new Set([0,...c.levels])].sort((a,b)=>a-b);
   for(let row=0;row<levels.length;row++)floors.push({host:c.id,hostInstance:instance,
    origin:[...b.origin],size:[...b.size],base:b.origin[1]+levels[row],
    ceiling:b.origin[1]+(levels[row+1]??b.size[1]-(c.roof?1:0))});
  }
 const stats=(b,base,referenced)=>{
  if(b.origin.some((v,a)=>!Number.isSafeInteger(v)||v<0||!Number.isSafeInteger(b.size[a])||b.size[a]<1||v+b.size[a]>extent[a])||base<0||base>=h)
   throw Error('Saved representative bounds are invalid');
  let floorSetCells=0,clearCells=0,referencedSetCells=0,referencedClearCells=0;
  const hi=end(b);
  for(let z=b.origin[2];z<hi[2];z++)for(let x=b.origin[0];x<hi[0];x++){
   if(actual.cells[index(x,base,z)]>=2)floorSetCells++;
   for(let y=b.origin[1];y<hi[1];y++){
    const i=index(x,y,z),value=actual.cells[i];
    if(value===1&&y>base)clearCells++;
    if(referenced.has(sources.traceSources[actual.sourceOwners[i]]?.component)){
     if(value>=2)referencedSetCells++;else if(value===1)referencedClearCells++;
    }
   }
  }
  return {floorSetCells,clearCells,referencedSetCells,referencedClearCells};
 };
 // Expand every saved compact room band, including exceptional heights.
 // Never look only at the first repeat, or infer an office from its name.
 const detailBoxes=role.components.flatMap(id=>
  ['shape','module'].includes(scene.components.find(c=>c.id===id).kind)?
   (sources.componentBounds[id]??[]).map((b,instance)=>({component:id,instance,...b})):[]);
 for(const zone of sources.roomZones??[]){
  if(zone.use!=='room')continue;
  for(let repeat=0;repeat<zone.repeat.count;repeat++){
   const b={origin:zone.origin.map((v,a)=>v+repeat*zone.repeat.step[a]),size:[...zone.size]};
   const referenced=ids.has(zone.id)?new Set([zone.id]):new Set(detailBoxes.filter(part=>
    part.origin[1]>b.origin[1]&&inside(part,b)).map(part=>part.component));
   if(!referenced.size)continue;
   const floor=floors.find(f=>f.host===zone.host&&f.base===b.origin[1]&&inside(b,f));
   if(!floor||b.origin[1]+b.size[1]>floor.ceiling)continue;
   const counts=stats(b,floor.base,referenced);
   if(!counts.floorSetCells||!counts.clearCells||!counts.referencedSetCells&&!counts.referencedClearCells)continue;
   const instance=(sources.componentBounds[zone.id]??[]).findIndex(box=>hash(box)===hash(b));
   if(instance<0)throw Error('Saved room band differs from component provenance');
   candidates.push({basis:'room-zone',component:zone.id,instance,host:zone.host,
    base:floor.base,ceiling:floor.ceiling,...b,...counts});
  }
 }
 // A raw module/shape is allowed by SceneSpec and can have no semantic room.
 // Show its real floor context, but disclose that no room program was found.
 if(!candidates.length)for(const part of detailBoxes){
  const floor=floors.filter(f=>inside(part,f)&&part.origin[1]>=f.base&&
   part.origin[1]+part.size[1]<=f.ceiling).sort((a,b)=>b.base-a.base||a.host.localeCompare(b.host))[0];
  if(!floor)continue;
  const counts=stats(part,floor.base,new Set([part.component]));
  if(!counts.floorSetCells||!counts.referencedSetCells)continue;
  candidates.push({basis:'floor-associated-detail',component:part.component,instance:part.instance,
   host:floor.host,base:floor.base,ceiling:floor.ceiling,origin:part.origin,size:part.size,...counts});
 }
 const middle=occupiedBounds?(occupiedMin[1]+occupiedMax[1])/2:h/2;
 candidates.sort((a,b)=>Math.abs(a.base-middle)-Math.abs(b.base-middle)||a.base-b.base||a.component.localeCompare(b.component)||a.instance-b.instance);
 const selected=candidates[0]??null,view=views.find(v=>v.purpose==='typical-floor');
 if(selected){
  view.min[1]=selected.base;
  view.max[1]=Math.min(h,selected.ceiling,selected.basis==='room-zone'?
   selected.origin[1]+selected.size[1]:Math.max(selected.base+3,selected.origin[1]+selected.size[1]));
  view.framing='Saved staged representative '+selected.component+' at floor Y='+selected.base+
   '. Full horizontal building context, not a furniture-only crop. '+
   (selected.basis==='room-zone'?'Actual constructed room band;':'Actual detail and floor cells only; semantic room program missing;')+
   ' authored role/purpose labels, full-floor completeness, function, navigation and aesthetic quality are not certified. This initial camera remains fixed for later comparisons.';
 }else view.framing='Representative floor UNRESOLVED: no surviving floor-associated staged room/detail was found. This legacy context band is not typical-floor evidence or a functional/quality certificate. Camera remains fixed for comparisons.';
 return {views,selection:{version:1,status:selected?'selected':'unresolved',candidateCount:candidates.length,selected,
  representativeComponents:[...role.components],purposeLabelsUsed:false,geometrySource:'saved-cells-and-owners',
  canAuthorizePlacement:false,architecturalCompletenessVerified:false,functionVerified:false,navigationVerified:false,aestheticQualityVerified:false,
  limitations:['The staged typical-floor role is model-authored; selecting surviving geometry does not verify its intended function.',
   'Only typical-floor selection uses this new geometry policy. Other camera roles retain V4 framing; authored feature labels there are framing hints, not verified function.',
   'SET cells are not a collision/support certificate. A room band or detail does not prove complete furnishings, offices or circulation.',
   'The first expanded asset selects cameras. Subsequent fixed-camera views may reveal removal or a now-empty floor; the initial basis is historical, not current quality acceptance.']}};
}
