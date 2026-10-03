import {nativeViewsForScene} from './quality-prototypes.mjs';
import {lowerScene} from './compiler.mjs';
import {MATERIALS} from '../generation/materials.mjs';

// AssetReviewCapture uses Rx(pitch) * Ry(yaw) and an ordinary GL ortho
// projection. Its camera is on world (-sin(yaw), +cos(yaw)) in X/Z,
// not Minecraft's player-yaw convention. Face outward, not through the host.
const exteriorYaw=(face,skew)=>({north:180,east:270,south:0,west:90}[face]-skew);

/** Versioned framing only; never edits/rescales the building. v2 cameras and
 * frozen task replay remain byte-identical. Every crop discloses its coverage. */
export function nativeViewsForQualityV3(scene,tier,occupiedBounds){
  const views=nativeViewsForScene(scene,tier,occupiedBounds),lowered=lowerScene(scene),d=[scene.bounds.width,scene.bounds.height,scene.bounds.length];
  const clamp=(view,min,max,framing)=>{
    view.min=min.map((v,i)=>Math.max(0,Math.min(d[i]-1,Math.floor(v))));
    view.max=max.map((v,i)=>Math.max(view.min[i]+1,Math.min(d[i],Math.ceil(v))));view.framing=framing;
  };
  const section=views.find(v=>v.purpose==='section');
  if(section){
    section.yaw=-55;
    section.framing=(section.framing?section.framing+' ':'')+'Viewed from the exposed positive-X cut side. Representative section, not full interior or circulation certification.';
  }
  const specialView=views.find(v=>v.purpose==='special-floor');
  // A generic podium "public meeting room" must not hide a specifically
  // authored sky/atrium space. Labels only select a real compiled floor band;
  // they never prove that an atrium, void or usable route actually exists.
  const specialRooms=lowered.roomZones.filter(r=>r.use==='room'&&/(?:\batrium\b|\bsky(?:[- ]|$)|中庭|空中)/i.test(r.purpose));
  const special=specialRooms.find(r=>r.origin[1]>0)??specialRooms[0];
  if(special&&specialView){
    const y=special.origin[1];
    clamp(specialView,[0,y,0],[d[0],y+Math.min(4,special.size[1]),d[2]],'Floor band of named sky/atrium room '+special.id+'. Named purpose and void continuity are not verified.');
  }
  const masses=scene.components.filter(c=>['mass','profileMass'].includes(c.kind)).flatMap(c=>(lowered.componentBounds[c.id]??[]).map(b=>({...b,id:c.id})));
  // Empty site margins need not dwarf the actual floor plan. Crop only to the
  // union of real mass footprints intersecting this height band, not a room name.
  for(const view of views.filter(v=>['typical-floor','special-floor'].includes(v.purpose))){
    const boxes=masses.filter(b=>b.origin[1]<view.max[1]&&b.origin[1]+b.size[1]>view.min[1]);
    if(boxes.length){const min=[...view.min],max=[...view.max];for(const a of [0,2]){min[a]=Math.min(...boxes.map(b=>b.origin[a]))-2;max[a]=Math.max(...boxes.map(b=>b.origin[a]+b.size[a]))+2;}clamp(view,min,max,(view.framing?view.framing+' ':'')+'Representative floor band framed to intersecting mass footprints plus two cells. Unshown site/other floors are not inspected.');}
  }
  const entry=scene.components.find(c=>c.kind==='entry'),entryView=views.find(v=>v.purpose==='entry');
  if(entry&&entryView){
    const box=lowered.componentBounds[entry.id]?.[0];
    if(box){const center=box.origin.map((v,i)=>v+box.size[i]/2),extent=['north','south'].includes(entry.face)?[12,6,9]:[9,6,12];
      clamp(entryView,center.map((v,i)=>v-extent[i]),center.map((v,i)=>v+extent[i]),'Entry component '+entry.id+' and immediate surroundings only, not the whole public floor.');entryView.yaw=exteriorYaw(entry.face,20);entryView.pitch=20;}
  }else if(entryView&&scene.constraints.passages[0]){
    // Composite doorways need not use the hosted entry primitive. Inspect
    // actual lowered door cells (already rotated/mirrored), never ID keywords.
    // The nearest declared checkpoint is a framing hint, not a certified entry.
    const checkpoint=scene.constraints.passages[0].origin,groups=new Map();
    for(const node of lowered.spec.nodes){
      const material=scene.palette.find(p=>p.role===node.material)?.material??node.material;
      if(node.blockState?.half!=='lower'||!/_door\[/.test(MATERIALS[material]??''))continue;
      const source=lowered.nodeSources[node.nodeId],face=node.blockState.facing;
      for(let r=0;r<node.repeat.count;r++){
        const origin=node.origin.map((v,i)=>v+r*node.repeat.step[i]),end=origin.map((v,i)=>v+node.size[i]+(i===1?1:0));
        const key=[source.component,source.instance,origin[1],face].join('/');
        let group=groups.get(key);if(!group){group={component:source.component,face,min:[...origin],max:[...end]};groups.set(key,group);}
        for(let i=0;i<3;i++){group.min[i]=Math.min(group.min[i],origin[i]);group.max[i]=Math.max(group.max[i],end[i]);}
      }
    }
    const distance=g=>checkpoint.reduce((sum,v,i)=>sum+Math.max(g.min[i]-v,v-(g.max[i]-1),0)**2,0);
    const portal=[...groups.values()].sort((a,b)=>distance(a)-distance(b))[0];
    if(portal){
      const center=portal.min.map((v,i)=>(v+portal.max[i])/2),base=['north','south'].includes(portal.face)?[12,6,9]:[9,6,12];
      const extent=base.map((v,i)=>Math.max(v,(portal.max[i]-portal.min[i])/2+2));
      clamp(entryView,center.map((v,i)=>v-extent[i]),center.map((v,i)=>v+extent[i]),'Door group '+portal.component+' nearest the first declared route checkpoint. Entrance role and unshown connections are not certified.');
      entryView.yaw=exteriorYaw(portal.face,20);entryView.pitch=20;
    }
  }
  const detail=views.find(v=>v.purpose==='facade-detail');
  // The first facade may belong to a short podium, far below the typical
  // floor. Choose a real facade band nearest that floor, not the first host;
  // clamping a tower height to hostTop-1 otherwise photographs only its roof.
  const samples=detail?scene.components.filter(c=>['facade','panelFacade','storeyFacade','edgeFacade'].includes(c.kind)).flatMap(facade=>{
    const host=scene.components.find(c=>c.id===facade.host&&c.kind===(facade.kind==='edgeFacade'?'profileMass':'mass')),box=host&&lowered.componentBounds[host.id]?.[0];
    if(!box)return [];
    return (lowered.componentBounds[facade.id]??[]).flatMap(facadeBox=>{
      const bottom=Math.max(box.origin[1],facadeBox.origin[1]),top=Math.min(box.origin[1]+box.size[1],facadeBox.origin[1]+facadeBox.size[1]);
      if(top<=bottom)return [];
      const distance=Math.max(bottom-detail.min[1],detail.min[1]-(top-1),0);
      return [{facade,host,box,facadeBox,bottom,top,distance}];
    });
  }).sort((a,b)=>a.distance-b.distance):[];
  const sample=samples[0];
  if(detail&&sample){
    const {facade,host,box,facadeBox,bottom,top}=sample;
    if(facade.kind==='edgeFacade'){
      // Use actual emitted panel extents, including exclusions, not the host's
      // rectangular envelope or the first polygon corner. Winding determines
      // the exterior side even on a concave courtyard edge.
      const a=host.points[facade.edge],b=host.points[(facade.edge+1)%host.points.length];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      const area=host.points.reduce((sum,p,i)=>{const q=host.points[(i+1)%host.points.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
      const sign=Math.sign(area),normal=[sign*dz/length,-sign*dx/length],tangent=[dx/length,dz/length];
      const center=[0,2].map(i=>facadeBox.origin[i]+facadeBox.size[i]/2);
      const extent=tangent.map((v,i)=>Math.abs(v)*10+Math.abs(normal[i])*Math.max(4,host.thickness+2));
      const y=Math.max(bottom,Math.min(detail.min[1],top-Math.min(12,top-bottom)));
      clamp(detail,[center[0]-extent[0],y,center[1]-extent[1]],[center[0]+extent[0],y+Math.min(12,top-bottom),center[1]+extent[1]],
        'Representative profile edge '+facade.edge+' of host '+host.id+' for facade '+facade.id+'. Actual emitted panel band; partial elevation crop, not all-edge, all-corner or all-floor coverage.');
      detail.yaw=Math.atan2(-normal[0],normal[1])*180/Math.PI-35;
      return views;
    }
    // A host corner includes actual shell cells even for excluded/open windows;
    // source IDs make this representative sample reproducible and reviewable.
    const lo=[...box.origin],hi=box.origin.map((v,i)=>v+box.size[i]);
    const bandHeight=Math.min(12,top-bottom);
    lo[1]=Math.max(bottom,Math.min(detail.min[1],top-bandHeight));hi[1]=lo[1]+bandHeight;
    if(facade.face==='north'){hi[0]=Math.min(hi[0],lo[0]+20);lo[0]-=3;lo[2]-=3;hi[2]=Math.min(hi[2],lo[2]+12);}
    if(facade.face==='south'){hi[0]=Math.min(hi[0],lo[0]+20);lo[0]-=3;hi[2]+=3;lo[2]=Math.max(lo[2],hi[2]-12);}
    if(facade.face==='west'){hi[2]=Math.min(hi[2],lo[2]+20);lo[2]-=3;lo[0]-=3;hi[0]=Math.min(hi[0],lo[0]+12);}
    if(facade.face==='east'){hi[2]=Math.min(hi[2],lo[2]+20);lo[2]-=3;hi[0]+=3;lo[0]=Math.max(lo[0],hi[0]-12);}
    clamp(detail,lo,hi,'Representative '+facade.face+' corner of host '+host.id+' for facade '+facade.id+'. Partial elevation crop, not all-corner or all-floor coverage.');detail.yaw=exteriorYaw(facade.face,35);
  }
  return views;
}

export const QUALITY_V3_REVIEW_MEMORY=`REVIEW CONTINUITY: reviewHistory preserves earlier criticisms, the source/evidence hashes they targeted and the selected concept's weaknesses. Re-evaluate those points against CURRENT geometry and attached current pixels; a new round does not erase an unresolved criticism. Explain concretely in summary which earlier concerns are resolved, still present or outside current coverage. Keep every still-actionable concern in issues, while distinguishing ordinary deferred fine detail at concept stage and unverified navigation. Do not alternate aesthetic criteria to spend the budget. A different source hash is not itself evidence of improvement. Never claim the earlier pictures depict the changed building.`;
