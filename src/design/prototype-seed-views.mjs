import {hash} from '../generation/compiler.mjs';
import {nativeViewsForQualityV4} from './quality-v4-evidence.mjs';

/** Actual saved seed bounds choose framing, never a keyword or an assumed
 * middle storey. The crop does not certify a complete floor or good design.
 * Once chosen, comparison cameras stay fixed across seed/design revisions. */
export function nativeViewsForPrototypeSeeds(scene,tier,occupiedBounds,witness,baselineViews=null){
 if(witness.sourceHash!==hash(scene)||witness.geometryVerified!==true||witness.canAuthorizePlacement!==false)throw Error('Prototype cameras require the current saved seed witness');
 if(baselineViews)return structuredClone(baselineViews);
 const views=nativeViewsForQualityV4(scene,tier,occupiedBounds),extent=[scene.bounds.width,scene.bounds.height,scene.bounds.length];
 const component=seed=>scene.components.find(c=>c.id===seed.component);
 const crop=(view,min,max,label)=>{
  view.min=min.map((v,i)=>Math.max(0,Math.min(extent[i]-1,Math.floor(v))));
  view.max=max.map((v,i)=>Math.max(view.min[i]+1,Math.min(extent[i],Math.ceil(v))));
  view.framing=label+' Actual saved seed geometry only; full-floor function, expanded instances and navigation are not visually certified.';
 };
 const room=witness.seeds.find(s=>['roomZone','storeyRoom'].includes(component(s)?.kind));
 const furnishing=room??witness.seeds.find(s=>component(s)?.kind==='module');
 const floorView=views.find(v=>v.purpose==='typical-floor');
 if(furnishing&&floorView){
  const c=component(furnishing),b=furnishing.bounds,y=Math.max(0,b.origin[1]-(c.kind==='module'?1:0));
  // Keep the complete X/Z floor context: one piece of furniture is never
  // promoted to a whole-floor design simply by zooming in on it.
  crop(floorView,[floorView.min[0],y,floorView.min[2]],[floorView.max[0],Math.min(extent[1],Math.max(y+3,b.origin[1]+b.size[1])),floorView.max[2]],'Floor band containing constructed seed '+furnishing.component);
 }
 const facade=witness.seeds.find(s=>['facade','panelFacade','storeyFacade','edgeFacade'].includes(component(s)?.kind)),detail=views.find(v=>v.purpose==='facade-detail');
 if(facade&&detail){
  const b=facade.bounds,c=component(facade);
  crop(detail,b.origin.map(v=>v-2),b.origin.map((v,i)=>v+b.size[i]+2),'Constructed facade seed '+facade.component);
  if(c.face)detail.yaw={north:160,east:250,south:-20,west:70}[c.face];
 }
 return views;
}
