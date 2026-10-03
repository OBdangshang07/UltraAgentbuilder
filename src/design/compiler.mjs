import {validateScene} from '../../contracts/scene-spec.schema.mjs';
import {BUILDING_LIMITS as L} from '../../contracts/building-limits.mjs';
import {compileSpec,hash} from '../generation/compiler.mjs';
import {transformPoint} from '../generation/groups.mjs';
import {resolveState,transformState,parseState} from '../generation/block-states.mjs';
import {MATERIALS} from '../generation/materials.mjs';
import {inspectStairAccess} from './stair-access.mjs';
import {profileFootprint,profileContainsInterior} from './profile.mjs';
import {profileEdgeTopology,edgePanelMasks} from './edge-facade.mjs';
import {validateRoomZone,emitRoomZone} from './room-zone.mjs';
import {furnishableAirSource} from './ownership.mjs';
import {numeric,resolveAnchor,resolvePlacement,lowerModuleNode} from './spatial.mjs';
import {validateRectangularFacade,rectangularFacadeLayout,rectangularFacadePanels,rectangularPanelProblems} from './facade-validation.mjs';
import {expandStoreyFacade} from './storey-layout.mjs';
import {componentReferences} from './floor-components.mjs';
import {stairBoundsProblem} from './stair-bounds.mjs';

export const SCENE_COMPILER='scene-1.6.0';
const isFacade=c=>['facade','panelFacade','edgeFacade','storeyFacade'].includes(c.kind);
const isMass=c=>c?.kind==='mass'||c?.kind==='profileMass';
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const repeatOnce={count:1,step:[0,0,0]};
const inside=(p,o,s)=>p.every((v,i)=>v>=o[i]&&v<o[i]+s[i]);
const dimensions=b=>[b.width,b.height,b.length];
const rotatedSize=(size,r)=>r%2?[size[2],size[1],size[0]]:[...size];
function finiteBox(origin,size,bounds,label){
  if(!origin.every(Number.isSafeInteger)||!size.every(n=>Number.isSafeInteger(n)&&n>=1)||origin.some((v,i)=>v<0||v+size[i]>bounds[i]))throw new Error(`${label}: outside scene or invalid size [${origin}] + [${size}]`);
}
function materials(scene){const result={};for(const p of scene.palette){if(Object.hasOwn(result,p.role))throw new Error('Duplicate material role: '+p.role);result[p.role]=p.material;}return result;}

/** Data-only DAG resolution and bounded semantic lowering. It never executes generated code. */
export function lowerScene(source){return lowerScenePhases(source);}
const componentStage=c=>isMass(c)||c.kind==='shape'&&c.stage==='structure'?0:['roomZone','storeyRoom'].includes(c.kind)?0.5:c.kind==='void'?1:c.kind==='stairs'?2:isFacade(c)||['entry','storeyOpening'].includes(c.kind)?3:4;
function lowerScenePhases(source,maximumStage=4,facadeAudit=null){
  validateScene(source);
  const scene=structuredClone(source),bounds=dimensions(scene.bounds),palette=materials(scene);
  if(bounds.reduce((a,b)=>a*b,1)>L.cells)throw new Error('Scene volume quota exceeded');
  const components=new Map(),modules=new Map(),resolved=new Map(),visiting=new Set(),dependencies={};
  let profileWork=0;
  for(const c of scene.components){if(components.has(c.id))throw new Error('Duplicate component: '+c.id);components.set(c.id,c);}
  for(const m of scene.modules){if(modules.has(m.id))throw new Error('Duplicate module: '+m.id);modules.set(m.id,m);}
  const dependency=id=>{if(!components.has(id))throw new Error('Unknown component reference: '+id);return id;};
  function resolve(id,depth=0){
    if(resolved.has(id))return resolved.get(id);
    if(visiting.has(id))throw new Error('Cyclic component anchor: '+id);
    if(depth>32)throw new Error('Component dependency depth exceeds 32');
    const c=components.get(dependency(id));visiting.add(id);
    const refs=componentReferences(c);dependencies[id]=refs;
    for(const ref of refs)resolve(ref,depth+1);
    const {origin,size,parameters,floorLayout}=resolvePlacement(c,modules,resolved,bounds,components);
    finiteBox(origin,size,bounds,id);
    const r={origin,size,parameters,...(floorLayout?{floorLayout}:{})};
    if(c.kind==='profileMass'){
      // Bound analysis as well as emitted-cell work; repeated instances reuse this mask.
      profileWork+=size[0]*size[2]*10+c.points.length*c.points.length+size[2]*c.points.length*2;
      if(profileWork>L.visits)throw new Error('Profile raster analysis quota exceeded');
      try{r.profile=profileFootprint(size[0],size[2],c.points,c.thickness);}catch(error){throw new Error(`${c.id}: ${error.message}`,{cause:error});}
    }
    resolved.set(id,r);visiting.delete(id);return r;
  }
  for(const c of scene.components)resolve(c.id);
  // Validate all permissions up front. Referencing an anchor alone never grants overwrite authority.
  for(const c of scene.components)for(const id of c.allowOverwrite)dependency(id);
  const nodes=[],nodeSources={},componentBounds={},diagnostics=[],roomZones=[],parametricLayouts=[];
  let work=0;
  const stage=componentStage;
  // Stable ordering within each phase; input order never allows a wall to refill a later opening.
  const ordered=[...scene.components].sort((a,b)=>stage(a)-stage(b));
  for(const sourceComponent of ordered){
    if(stage(sourceComponent)>maximumStage)continue;
    const sourceResolved=resolved.get(sourceComponent.id),floorLayout=sourceResolved.floorLayout;
    if(floorLayout)parametricLayouts.push(floorLayout.evidence);
    componentBounds[sourceComponent.id]=[];
    const placements=floorLayout?.bands??[{component:sourceComponent,resolved:sourceResolved,rowOffset:0}];
    for(const placement of placements){
    const c=placement.component,resolvedComponent=placement.resolved,repeat=c.repeat??repeatOnce;
    if(c.kind==='roomZone'){
      validateRoomZone(c,components.get(c.host),resolved.get(c.host),resolvedComponent.origin);
      roomZones.push({id:c.id,host:c.host,use:c.use,purpose:c.purpose,origin:resolvedComponent.origin,size:resolvedComponent.size,repeat});
    }
    // Disjoint instances commute. Keep repeat in the existing kernel rather than unrolling every office floor.
    const compactRepeat=['module','shape','roomZone','storeyOpening'].includes(c.kind)&&repeat.count>1&&repeat.step.some((v,i)=>Math.abs(v)>=resolvedComponent.size[i]);
    const allowed=new Set([...c.allowOverwrite,...(c.host?[c.host]:[])]);
    for(let instance=0;instance<(compactRepeat?1:repeat.count);instance++){
      const sourceInstance=placement.rowOffset+instance;
      const firstNode=nodes.length;
      const o=add(resolvedComponent.origin,repeat.step.map(v=>v*instance)),s=resolvedComponent.size;
      finiteBox(o,s,bounds,c.id);componentBounds[c.id][sourceInstance]={origin:o,size:s};
      let serial=0,emissionRepeat=compactRepeat?repeat:repeatOnce,walkablePart=false,layoutSource=floorLayout?{rule:sourceComponent.kind,firstRow:sourceInstance,lastRow:sourceInstance+(compactRepeat?repeat.count-1:0)}:null;
      function emit(op,origin,size,material='wall',extra={}){
        finiteBox(origin,size,bounds,c.id);
        finiteBox(add(origin,emissionRepeat.step.map(v=>v*(emissionRepeat.count-1))),size,bounds,c.id);
        if(nodes.length>=L.nodes)throw new Error('Scene expanded node quota exceeded');
        work+=size.reduce((a,b)=>a*b,1)*emissionRepeat.count;if(work>L.visits)throw new Error('Scene expansion work quota exceeded');
        const nodeId='s'+hash({id:c.id,instance:sourceInstance,part:serial++}).slice(0,24);
        const node={nodeId,op,origin,size,material,thickness:1,axis:'x',repeat:emissionRepeat,points:[],blockState:null,...extra};
        nodes.push(node);nodeSources[nodeId]={component:c.id,instance:sourceInstance,stage:stage(c),kind:c.kind,allowed:[...allowed],origin,size,repeat:emissionRepeat,walkable:walkablePart,...(layoutSource?{layoutSource:{...layoutSource}}:{}),...(c.kind==='doorway'?{openingHost:c.host}:{}),...(c.kind==='roomZone'?{zoneUse:c.use}:{})};
      }
      const box=(origin,size,material,extra)=>emit('box',origin,size,material,extra);
      const clear=(origin,size)=>emit('clear',origin,size,Object.keys(palette)[0]);
      const localBox=(delta,size,material,extra)=>box(add(o,delta),size,material,extra);
      if(c.kind==='mass'){
        const [w,h,d]=s,t=c.thickness;
        if(w<2*t+1||d<2*t+1||h<4)throw new Error(`${c.id}: mass needs hollow interior and headroom`);
        clear(o,s);
        localBox([0,0,0],[w,h,t],c.material);localBox([0,0,d-t],[w,h,t],c.material);
        localBox([0,0,t],[t,h,d-2*t],c.material);localBox([w-t,0,t],[t,h,d-2*t],c.material);
        const floors=[...new Set([0,...c.levels])].sort((a,b)=>a-b);
        walkablePart=true;for(const y of floors){if(y>=h-2)throw new Error(`${c.id}: floor ${y} lacks two-block headroom`);localBox([0,y,0],[w,1,d],c.floorMaterial);}walkablePart=false;
        if(c.roof)localBox([0,h-1,0],[w,1,d],c.roofMaterial);
      }else if(c.kind==='profileMass'){
        if(s[1]<4)throw new Error(`${c.id}: profile mass needs hollow interior and headroom`);
        const p=resolvedComponent.profile;
        const profileBox=(r,y,h,material)=>localBox([r.origin[0],y,r.origin[1]],[r.size[0],h,r.size[1]],material);
        for(const r of p.footprint)clear(add(o,[r.origin[0],0,r.origin[1]]),[r.size[0],s[1],r.size[1]]);
        for(const r of p.walls)profileBox(r,0,s[1],c.material);
        const floors=[...new Set([0,...c.levels])].sort((a,b)=>a-b);
        if(floors.some((y,i)=>y+2>=s[1]-(c.roof?1:0)||i>0&&y-floors[i-1]<3))throw new Error(`${c.id}: profile floors need two-block headroom between slabs and below the roof`);
        walkablePart=true;
        // Repeat matching storeys in the existing kernel; do not enumerate every
        // polygon row at every floor of a 200+ metre building.
        for(let i=0;i<floors.length;){
          let last=i;const step=floors[i+1]-floors[i];
          if(i+1<floors.length){last=i+1;while(last+1<floors.length&&floors[last+1]-floors[last]===step)last++;}
          emissionRepeat={count:last-i+1,step:[0,last>i?step:0,0]};
          for(const r of p.footprint)profileBox(r,floors[i],1,c.floorMaterial);
          i=last+1;
        }
        emissionRepeat=repeatOnce;walkablePart=false;
        if(c.roof)for(const r of p.footprint)profileBox(r,s[1]-1,1,c.roofMaterial);
      }else if(c.kind==='shape')emit(c.op,o,s,c.material,{axis:c.axis,thickness:c.thickness,points:c.points,blockState:c.blockState});
      else if(c.kind==='roomZone'){
        emitRoomZone(c,{box:localBox,clear:(p,size)=>clear(add(o,p),size),floor:(p,size,material)=>{walkablePart=true;localBox(p,size,material);walkablePart=false;},door:(p,material,blockState)=>{
          if(!/_door\[/.test(MATERIALS[resolveMaterial(material,palette)]))throw new Error(`${c.id}: room opening requires a door material or null`);
          emit('door',add(o,p),[1,2,1],material,{blockState});
        }});
      }
      else if(c.kind==='void')clear(o,s);
      else if(c.kind==='storeyOpening'){
        clear(o,s);
        if(c.door!==null){
          if(!/_door\[/.test(MATERIALS[resolveMaterial(c.door,palette)]))throw new Error(`${c.id}: opening requires a door material or null`);
          const along=c.face==='north'||c.face==='south'?0:2,normal=along===0?2:0;
          for(let leaf=0;leaf<c.width;leaf++){
            const p=[...o];p[along]+=leaf;
            if(c.face==='south'||c.face==='east')p[normal]+=c.hostThickness-1;
            emit('door',p,[1,2,1],c.door,{blockState:{facing:c.face,hinge:leaf===0?c.hinge:c.hinge==='left'?'right':'left',open:c.open}});
          }
        }
      }
      else if(c.kind==='doorway'){
        const host=components.get(c.host),hr=resolved.get(c.host);
        if(host.kind!=='void')throw new Error(`${c.id}: doorway host must be an explicitly cleared void; use entry for a mass wall`);
        const fits=Array.from({length:host.repeat.count},(_,i)=>add(hr.origin,host.repeat.step.map(v=>i*v)))
          .some(origin=>inside(o,origin,hr.size)&&inside(o.map((v,i)=>v+s[i]-1),origin,hr.size));
        if(!fits)throw new Error(`${c.id}: doorway must fit wholly inside one host opening instance; no automatic excavation or resizing`);
        if(!/_door\[/.test(MATERIALS[resolveMaterial(c.door,palette)]))throw new Error(`${c.id}: doorway requires a door material`);
        const along=c.face==='north'||c.face==='south'?0:2;
        for(let u=0;u<c.width;u++){
          const p=[...o];p[along]+=u;
          emit('door',p,[1,2,1],c.door,{blockState:{facing:c.face,hinge:u===0?c.hinge:c.hinge==='left'?'right':'left',open:c.open}});
        }
      }
      else if(c.kind==='edgeFacade'){
        const host=components.get(c.host),r=resolved.get(c.host),p=r.profile;
        if(host.kind!=='profileMass'||host.repeat.count!==1)throw new Error(`${c.id}: edgeFacade host must be one profileMass`);
        if(c.edge>=host.points.length)throw new Error(`${c.id}: missing profile edge`);
        if(!r.edges){
          profileWork+=p.mask.length*host.points.length;
          if(profileWork>L.visits)throw new Error('Profile edge analysis quota exceeded');
          r.edges=profileEdgeTopology(p,host.points);
        }
        profileWork+=p.mask.length*4*c.count[0];
        if(profileWork>L.visits)throw new Error('Profile panel analysis quota exceeded');
        const edge=r.edges[c.edge],[left,right,bottom,top]=c.borders,[pw,ph]=c.size;
        if(left+right>=pw||bottom+top>=ph)throw new Error(`${c.id}: facade borders consume its opening`);
        if(c.recess>=host.thickness)throw new Error(`${c.id}: glazing recess must stay inside host thickness`);
        if(c.count.some((v,i)=>v>1&&c.step[i]<c.size[i]))throw new Error(`${c.id}: overlapping edge window rhythm`);
        const excludes=new Set(c.exclude.map(v=>v.join(',')));
        if(c.exclude.some(v=>v.some((n,i)=>n>=c.count[i])))throw new Error(`${c.id}: invalid array exclusion`);
        const maskEmit=(rects,y,height,material,cut=false)=>{
          for(const rect of rects){const pos=add(r.origin,[rect.origin[0],y,rect.origin[1]]),size=[rect.size[0],height,rect.size[1]];if(cut)clear(pos,size);else box(pos,size,material);}
        };
        for(let col=0;col<c.count[0];col++){
          const u=c.start[0]+col*c.step[0];
          if(u<c.margin||u+pw>edge.span-c.margin)throw new Error(`${c.id}: profile panel exceeds edge margins`);
          if(Array.from({length:c.count[1]},(_,row)=>excludes.has(`${col},${row}`)).every(Boolean))continue;
          let masks;try{masks=edgePanelMasks(p,edge,{u,width:pw,left,right,recess:c.recess,lattice:c.lattice,requireGlazing:c.glazing!==null});}catch(error){throw new Error(`${c.id}: ${error.message}`,{cause:error});}
          for(let row=0;row<c.count[1];row++){
            if(excludes.has(`${col},${row}`))continue;
            let last=row;while(last+1<c.count[1]&&!excludes.has(`${col},${last+1}`))last++;
            const y=c.start[1]+row*c.step[1],lastY=c.start[1]+last*c.step[1];
            if(y<1||lastY+ph>r.size[1]-(host.roof?1:0))throw new Error(`${c.id}: profile panel exceeds floor/roof margins`);
            for(let k=row;k<=last;k++){
              const low=c.start[1]+k*c.step[1]+bottom,high=c.start[1]+k*c.step[1]+ph-top;
              if(host.levels.some(f=>f>=low&&f<high))throw new Error(`${c.id}: profile window opening would cut a declared floor; adjust the explicit rhythm`);
            }
            emissionRepeat={count:last-row+1,step:[0,c.step[1],0]};
            maskEmit(masks.opening,y+bottom,ph-bottom-top,null,true);
            maskEmit(masks.sides,y+bottom,ph-bottom-top,c.frame);
            if(bottom)maskEmit(masks.all,y,bottom,c.frame);if(top)maskEmit(masks.all,y+ph-top,top,c.frame);
            if(c.glazing)maskEmit(masks.glass,y+bottom,ph-bottom-top,c.glazing);
            row=last;emissionRepeat=repeatOnce;
          }
        }
      }
      else if(isFacade(c)||c.kind==='entry'){
        const host=components.get(c.host),r=resolved.get(c.host);
        if(host.kind!=='mass'||host.repeat.count!==1)throw new Error(`${c.id}: facade/entry host must be a single mass`);
        const {origin:ho,size:hs}=r,t=host.thickness;
        const along=c.face==='north'||c.face==='south'?0:2,normal=along===0?2:0;
        const sign=c.face==='north'||c.face==='west'?-1:1,plane=ho[normal]+(sign===1?hs[normal]-1:0),span=hs[along];
        function wall(op,u,y,width,height,depth,thickness,material,extra={}){
          const p=[...ho],z=[1,height,1];p[along]+=u;p[1]+=y;p[normal]=plane+sign*depth-(sign>0?thickness-1:0);z[along]=width;z[normal]=thickness;emit(op,p,z,material,extra);
        }
        const wallBox=(u,y,w,h,depth,thick,mat,extra)=>wall('box',u,y,w,h,depth,thick,mat,extra);
        const wallClear=(u,y,w,h)=>wall('clear',u,y,w,h,0,t,host.material);
        if(isFacade(c)){
          let bands=[{panel:c,rowOffset:0}];
          if(c.kind==='storeyFacade'){
            try{const expanded=expandStoreyFacade(c,host,r,bounds);bands=expanded.bands;parametricLayouts.push(expanded.evidence);}
            catch(error){if(!facadeAudit)throw error;facadeAudit.excludedComponents.push(c.id);facadeAudit.omissions.push({component:c.id,error:error.message,layoutFeedback:error.layoutFeedback});continue;}
          }
          const parametric=c.kind==='storeyFacade';
          for(const band of bands){
          const c=band.panel;
          let layout;
          if(facadeAudit){
            // Read-only partial audit ONLY. The public compiler never supplies
            // this option. Retain valid panels, including their intersections
            // with entries/details, without inventing replacement geometry.
            try{layout=rectangularFacadeLayout(c,host,r);}catch(error){facadeAudit.excludedComponents.push(c.id);facadeAudit.omissions.push({component:c.id,error:error.message});continue;}
            let omitted=0;const samples=[];
            for(const panel of rectangularFacadePanels(c,layout)){
              const problems=rectangularPanelProblems(c,host,r,bounds,layout,panel).filter(p=>p.severity!=='review');
              if(problems.length){omitted++;layout.excludes.add(`${panel.column},${panel.row}`);if(samples.length<4)samples.push({panel,codes:problems.map(p=>p.code)});}
            }
            if(omitted){facadeAudit.partiallyOmittedComponents.push(c.id);facadeAudit.omissions.push({component:c.id,omittedPanels:omitted,samples,samplesTruncated:omitted>samples.length});}
          }else layout=validateRectangularFacade(c,host,r,bounds);
          const {borders:[left,right,bottom,top],recess,excludes}=layout;
          const innerWidth=c.size[0]-left-right,innerHeight=c.size[1]-bottom-top;
          // Rows compile to bounded repeat nodes; the existing cell-visit quota remains authoritative.
          for(let col=0;col<c.count[0];col++)for(let row=0;row<c.count[1];row++){
            if(excludes.has(`${col},${row}`))continue;
            let last=row;while(last+1<c.count[1]&&!excludes.has(`${col},${last+1}`))last++;
            layoutSource=parametric?{rule:'storeyFacade',column:col,firstRow:row+band.rowOffset,lastRow:last+band.rowOffset}:null;
            emissionRepeat={count:last-row+1,step:[0,c.step[1],0]};
            const [w,h]=c.size,u=c.start[0]+col*c.step[0],y=c.start[1]+row*c.step[1];
            wallClear(u+left,y+bottom,innerWidth,innerHeight);
            if(bottom)wallBox(u,y,w,bottom,c.projection,1,c.frame);if(top)wallBox(u,y+h-top,w,top,c.projection,1,c.frame);
            if(left)wallBox(u,y+bottom,left,innerHeight,c.projection,1,c.frame);if(right)wallBox(u+w-right,y+bottom,right,innerHeight,c.projection,1,c.frame);
            if(c.glazing)wallBox(u+left,y+bottom,innerWidth,innerHeight,-recess,1,c.glazing);
            if(c.lattice)for(let x=left+1;x<w-right;x+=2)wallBox(u+x,y+bottom,1,innerHeight,c.projection,1,c.frame);
            if(c.sill)wallBox(u,y,w,1,c.sill,c.sill+1,c.frame);
            if(c.shade)wallBox(u,y+h-1,w,1,c.shade,c.shade+1,c.frame);
            row=last;emissionRepeat=repeatOnce;
          }
          }
          layoutSource=null;
        }else{
          if(c.u<1||c.u+c.width>=span||c.feet+2>=hs[1])throw new Error(`${c.id}: entry needs side/head margins`);
          wallClear(c.u,c.feet,c.width,2);
          if(c.threshold)wallBox(c.u,c.feet-1,c.width,1,0,t,c.thresholdMaterial);
          wallBox(c.u-1,c.feet,1,3,0,1,c.frame);wallBox(c.u+c.width,c.feet,1,3,0,1,c.frame);wallBox(c.u,c.feet+2,c.width,1,0,1,c.frame);
          for(let u=0;u<c.width;u++)wall('door',c.u+u,c.feet,1,2,0,1,c.door,{blockState:{facing:c.face,hinge:u===1?'right':'left',open:c.open}});
          if(c.canopy)wallBox(c.u-1,c.feet+3,c.width+2,1,c.canopy,c.canopy+1,c.frame);
        }
      }else if(c.kind==='stairs'){
        const host=components.get(c.host),hr=resolved.get(c.host);
        if(!isMass(host))throw new Error(`${c.id}: stairs host must be a mass or profileMass`);
        const local=rotatedSize(s,c.rotation),[run,height,breadth]=local,rise=c.rise;
        const stairBounds=stairBoundsProblem(c,host,hr,o,s,sourceInstance);
        if(stairBounds)throw Object.assign(new Error(stairBounds.message),{stairBoundsFeedback:stairBounds});
        if(hr.profile&&!profileContainsInterior(hr.profile,o[0]-hr.origin[0],o[2]-hr.origin[2],s[0],s[2]))throw new Error(`${c.id}: staircase footprint must stay inside the actual profile interior, not its bounding box`);
        if(!host.levels.includes(o[1]-hr.origin[1]+rise))throw new Error(`${c.id}: stair endpoint must match a declared upper floor`);
        if(height<rise+3)throw new Error(`${c.id}: staircase reservation needs rise+3 height for headroom`);
        const first=c.style==='switchback'?Math.ceil(rise/2):rise,second=rise-first;
        if(c.style==='switchback'&&rise<4)throw new Error(`${c.id}: switchback needs at least four blocks floor-to-floor for return-landing headroom; use straight stairs for a smaller rise`);
        const requiredRun=c.style==='straight'?rise+2:Math.max(first,second)+2;
        if(run<requiredRun||breadth<(c.style==='straight'?c.width:2*c.width+1))throw new Error(`${c.id}: insufficient staircase footprint; need run ${requiredRun}, width ${c.style==='straight'?c.width:2*c.width+1}; dimensions unchanged`);
        const rotatedBox=(p,sz,mat,extra={})=>{
          const corners=[transformPoint(p,local,c.rotation,false),transformPoint(p.map((v,i)=>v+sz[i]-1),local,c.rotation,false)];
          const origin=add(o,corners[0].map((v,i)=>Math.min(v,corners[1][i]))),size=corners[0].map((v,i)=>Math.abs(v-corners[1][i])+1);
          const state=extra.blockState?stateProperties(transformState(resolveState(resolveMaterial(mat,palette),extra.blockState),c.rotation,false)):null;
          box(origin,size,mat,{blockState:state});
        };
        // Only this explicitly declared core is excavated, then occupied by treads/landings.
        clear(add(o,[0,1,0]),[s[0],s[1]-1,s[2]]);
        walkablePart=true;
        const stairMaterial=resolveMaterial(c.material,palette),partial=/_stairs\[/.test(MATERIALS[stairMaterial]);
        const step=(x,y,z)=>rotatedBox([x,y,z],[1,1,c.width],c.material,partial?{blockState:{facing:'east',half:'bottom',shape:'straight'}}:{});
        rotatedBox([0,0,0],[1,1,c.style==='switchback'?2*c.width+1:c.width],host.floorMaterial);
        for(let i=1;i<=first;i++)step(i,i,0);
        if(c.style==='straight')rotatedBox([first+1,rise,0],[1,1,c.width],host.floorMaterial);
        else{
          rotatedBox([first+1,first,0],[1,1,2*c.width+1],host.floorMaterial);
          // At rise 4, a solid platform UNDER the first return tread becomes
          // a too-low ceiling for the preceding storey's last upward move.
          // Keep the cross-lane bridge and outer turn, but leave that redundant
          // underside empty. Higher-rise legacy geometry remains byte-identical.
          if(rise===4)rotatedBox([first,first,c.width],[1,1,1],host.floorMaterial);
          else rotatedBox([first,first,c.width],[2,1,c.width+1],host.floorMaterial);
          for(let i=1;i<=second;i++)rotatedBox([first-i+1,first+i,c.width+1],[1,1,c.width],c.material,partial?{blockState:{facing:'west',half:'bottom',shape:'straight'}}:{});
          // Join the upper return flight to a full-width common floor landing.
          // Odd rises have one extra return offset; extend that lane to X=0.
          rotatedBox([0,rise,c.width+1],[first-second+1,1,c.width],host.floorMaterial);
          rotatedBox([0,rise,0],[1,1,2*c.width+1],host.floorMaterial);
        }
      }else if(c.kind==='pergola'){
        if(s[0]<3||s[1]<3||s[2]<3)throw new Error(`${c.id}: pergola needs at least 3x3x3`);
        for(const x of [0,s[0]-1])for(const z of [0,s[2]-1])localBox([x,0,z],[1,s[1]-1,1],c.postMaterial);
        for(const z of [0,s[2]-1])localBox([0,s[1]-2,z],[s[0],1,1],c.material);
        const axis=c.axis==='x'?0:2;
        for(let n=0;n<s[axis];n+=c.spacing){const p=[0,s[1]-1,0],sz=[s[0],1,s[2]];p[axis]=n;sz[axis]=1;localBox(p,sz,c.material);}
      }else if(c.kind==='balcony'){
        if(s[0]<3||s[1]<2||s[2]<3)throw new Error(`${c.id}: balcony needs at least 3x2x3`);
        walkablePart=true;localBox([0,0,0],[s[0],1,s[2]],c.material);walkablePart=false;
        for(const [face,p,sz] of [['north',[0,1,0],[s[0],s[1]-1,1]],['south',[0,1,s[2]-1],[s[0],s[1]-1,1]],['west',[0,1,0],[1,s[1]-1,s[2]]],['east',[s[0]-1,1,0],[1,s[1]-1,s[2]]]])if(c.openFace!==face)localBox(p,sz,c.railMaterial);
      }else if(c.kind==='planter'){
        if(s[1]<2)throw new Error(`${c.id}: planter needs a base plus at least one foliage layer (height >=2)`);
        // Narrow ledge planters are real Minecraft geometry too. Use an inset only
        // where the declared width/depth leaves room for one; never enlarge the box.
        const ix=s[0]>=3?1:0,iz=s[2]>=3?1:0;
        box(o,[s[0],1,s[2]],c.material);localBox([ix,1,iz],[s[0]-2*ix,s[1]-1,s[2]-2*iz],c.foliage);
      }else if(c.kind==='path'){
        walkablePart=true;box(o,s,c.material);walkablePart=false;clear(add(o,[0,s[1],0]),[s[0],c.clearance,s[2]]);
      }else if(c.kind==='module'){
        const template=modules.get(c.module),parameters=resolvedComponent.parameters,local=template.size.map(v=>numeric(v,parameters)),seen=new Set();
        for(const sourceNode of template.nodes){
          try{
          if(seen.has(sourceNode.nodeId))throw new Error('Duplicate module node');seen.add(sourceNode.nodeId);
          const loweredNodes=lowerModuleNode(sourceNode,parameters);
          for(const low of loweredNodes)for(let r=0;r<low.repeat.count;r++){
            const pos=add(low.origin,low.repeat.step.map(v=>r*v));finiteBox(pos,low.size,local,c.id+' module');
            if(low.op==='stair'||low.op==='polygonExtrude')throw new Error('First SceneSpec modules use box/shell/cylinder/arch/components; put polygon shapes outside modules and use semantic stairs');
            const corners=[transformPoint(pos,local,c.rotation,c.mirror),transformPoint(pos.map((v,i)=>v+low.size[i]-1),local,c.rotation,c.mirror)];
            const origin=add(o,corners[0].map((v,i)=>Math.min(v,corners[1][i]))),size=corners[0].map((v,i)=>Math.abs(v-corners[1][i])+1);
            if(low._door&&!/_door\[/.test(MATERIALS[resolveMaterial(low.material,palette)]))throw new Error('Module door requires a door material');
            const state=low.op==='clear'||low.op==='keep'?null:stateProperties(transformState(resolveState(resolveMaterial(low.material,palette),low.blockState),c.rotation,c.mirror));
            emit(low.op,origin,size,low.material,{axis:c.rotation%2?(low.axis==='x'?'z':'x'):low.axis,thickness:low.thickness,points:low.points,blockState:state});
          }
          }catch(error){
            // Keep the original error and source intact; identifying a bad shared
            // module node must not silently repair or broaden its edit scope.
            throw new Error(`${c.id} / module ${template.id} / node ${sourceNode.nodeId}: ${error.message}`,{cause:error});
          }
        }
      }
      // Localization and revision scopes cover emitted geometry, including projections and cleared headroom.
      if(nodes.length>firstNode){
        const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
        for(let n=firstNode;n<nodes.length;n++)for(let axis=0;axis<3;axis++){
          const node=nodes[n],delta=compactRepeat?0:(node.repeat.count-1)*node.repeat.step[axis];
          lo[axis]=Math.min(lo[axis],node.origin[axis]+Math.min(0,delta));hi[axis]=Math.max(hi[axis],node.origin[axis]+Math.max(0,delta)+node.size[axis]);
        }
        componentBounds[c.id][sourceInstance]={origin:lo,size:hi.map((v,i)=>v-lo[i])};
        if(compactRepeat)for(let r=1;r<repeat.count;r++)componentBounds[c.id].push({origin:add(lo,repeat.step.map(v=>r*v)),size:hi.map((v,i)=>v-lo[i])});
      }
    }
    }
  }
  let reservedVisits=0;const reservedIds=new Set();
  const reservations=scene.reservations.map(r=>{
    if(reservedIds.has(r.id)||components.has(r.id))throw new Error('Duplicate/ambiguous reservation ID: '+r.id);reservedIds.add(r.id);
    reservedVisits+=r.size.reduce((a,b)=>a*b,1);if(reservedVisits>L.visits)throw new Error('Reservation inspection work quota exceeded');
    if(r.at.relativeTo)dependency(r.at.relativeTo);
    const {origin}=resolveAnchor(r.at,resolved,bounds);finiteBox(origin,r.size,bounds,r.id);r.allowedComponents.forEach(dependency);
    return {...r,origin};
  });
  const spec={schemaVersion:2,id:scene.id,seed:scene.seed,units:'block',bounds:scene.bounds,design:scene.design,palette,nodes,groups:[],instances:[],constraints:scene.constraints};
  return {spec,scene,nodeSources,componentBounds,dependencies,reservations,diagnostics,roomZones,parametricLayouts,expandedNodes:nodes.length,work,profileWork};
}
function resolveMaterial(material,palette){const result=Object.hasOwn(palette,material)?palette[material]:material;if(!Object.hasOwn(MATERIALS,result))throw new Error('Unknown design material: '+material);return result;}
function stateProperties(state){
  const props=parseState(state).properties;
  return Object.fromEntries(Object.entries(props).filter(([key])=>['facing','half','hinge','open','shape','axis','type'].includes(key)).map(([k,v])=>[k,k==='open'?v==='true':v]));
}

function compileOwned(lowered,navigationPolicy){
  const {spec,nodeSources}=lowered;
  const source=nodeId=>nodeSources[nodeId?.slice(0,25)];
  const overwritten=new Map(),conflicts=new Map(),coverage={conflictsTruncated:false};
  const conflict=(code,from,to,point,write)=>{
    const key=`${code}: ${from} -> ${to}`;
    if(!conflicts.has(key)){if(conflicts.size<64)conflicts.set(key,{code,from,to,point:[...point],count:0,bounds:{min:[...point],max:[...point]},...(write?{firstWrite:write}:{})});else coverage.conflictsTruncated=true;}
    const c=conflicts.get(key);if(c){c.count++;for(let a=0;a<3;a++){c.bounds.min[a]=Math.min(c.bounds.min[a],point[a]);c.bounds.max[a]=Math.max(c.bounds.max[a],point[a]);}}
  };
  const floorNodeIds=new Set(Object.entries(nodeSources).filter(([,s])=>s.walkable).map(([id])=>id));
  const compiled=compileSpec(spec,{navigationPolicy,traceNodes:true,floorNodeIds,onWrite:({point,nodeId,value,previous,previousNodeId})=>{
    const now=source(nodeId),prior=source(previousNodeId);
    // Binding an opening permits installing doors in its actual air, never
    // demolishing a later wall or filling an unrelated cleared region.
    if(now.openingHost&&(previous!==1||prior?.component!==now.openingHost))conflict('opening-fill',now.component,now.openingHost,point);
    const furnishableAir=furnishableAirSource(prior)&&previous===1&&value>=2;
    if(prior&&prior.component!==now.component&&value!==previous&&previous!==0&&!furnishableAir&&!now.allowed.includes(prior.component)){
      // Ordinary air inside a room is not a protected object. Explicit voids and
      // reservations remain protected; walls, floors and other solids require permission.
      conflict('ownership',now.component,prior.component,point,{operation:value===1?'clear':'set',previous:previous===1?'clear':'solid',producerKind:now.kind,receiverKind:prior.kind});
    }
    if(prior&&prior.component!==now.component&&previous>=2&&value!==previous)overwritten.set(prior.component,(overwritten.get(prior.component)??0)+1);
  }});
  return {compiled,conflicts,conflict,overwritten,source,coverage};
}

/** Supplemental evidence when a later facade cannot lower. Runs the identical
 * early-phase writes/ownership checks, never returns geometry or a manifest.
 * This is a partial construction-order audit, NOT a repaired scene or pass. */
export function inspectPreFacadeOwnership(scene){
  const report={sourceHash:hash(scene),scope:'pre-facade-construction-order',canAuthorizePlacement:false,checksComplete:false,
    notChecked:['facades','entries','detail-shapes-modules-landscape','final-reservation-clearances','navigation','architectural-quality'],
    includedComponents:scene.components.filter(c=>componentStage(c)<=2).map(c=>c.id),
    excludedComponents:scene.components.filter(c=>componentStage(c)>2).map(c=>c.id),conflicts:[],error:null};
  try{const {conflicts,coverage}=compileOwned(lowerScenePhases(scene,2),'review');report.conflicts=[...conflicts.values()];report.conflictsTruncated=coverage.conflictsTruncated;report.coveredPhasesComplete=!coverage.conflictsTruncated;}
  catch(error){report.coveredPhasesComplete=false;report.error=error.message;}
  return report;
}

/** Audit later writes even when rectangular facade panels fail validation.
 * Omitted panels can change ownership, so all conflicts here are conditional
 * evidence to recheck, NEVER an asset, a repair or authority to overwrite. */
export function inspectPartialConstructionOwnership(scene){
  const audit={excludedComponents:[],partiallyOmittedComponents:[],omissions:[]};
  const report={sourceHash:hash(scene),scope:'construction-order-with-invalid-rectangular-panels-omitted',canAuthorizePlacement:false,checksComplete:false,coveredPhasesComplete:false,
    notChecked:['omitted-panels-and-their-downstream-effects','final-reservation-clearances','navigation','architectural-quality'],conflicts:[],error:null,...audit};
  try{
    const {conflicts,coverage}=compileOwned(lowerScenePhases(scene,4,audit),'review');
    report.conflicts=[...conflicts.values()];report.conflictsTruncated=coverage.conflictsTruncated;report.coveredPhasesComplete=!coverage.conflictsTruncated;
  }catch(error){report.error=error.message;}
  report.includedComponents=scene.components.filter(c=>!audit.excludedComponents.includes(c.id)).map(c=>c.id);
  return report;
}

export function compileScene(scene,{navigationPolicy='review',diagnosticOnly=false}={}){
  const lowered=lowerScene(scene),{spec,nodeSources,reservations}=lowered;
  const {compiled,conflicts,conflict,overwritten,source}=compileOwned(lowered,navigationPolicy);
  const surviving={},survivingClear={},finalOwners=compiled.trace.owners,traceSources=compiled.trace.nodeIds.map(n=>source(n)??null);
  const [w,,d]=dimensions(spec.bounds);
  for(let i=0;i<compiled.cells.length;i++){
    const id=traceSources[finalOwners[i]]?.component;
    if(id&&compiled.cells[i]>=2)surviving[id]=(surviving[id]??0)+1;
    if(id&&compiled.cells[i]===1)survivingClear[id]=(survivingClear[id]??0)+1;
  }
  const reservationEvidence={};
  // A circulation zone is an explicit clearance promise, not a named room or
  // permission to erase future obstructions. Inspect final masks without repair.
  for(const zone of lowered.roomZones.filter(z=>z.use==='circulation'))for(let r=0;r<zone.repeat.count;r++){
    const o=add(zone.origin,zone.repeat.step.map(v=>v*r)),s=zone.size;
    for(let y=o[1]+1;y<o[1]+s[1];y++)for(let z=o[2];z<o[2]+s[2];z++)for(let x=o[0];x<o[0]+s[0];x++){
      const i=x+z*w+y*w*d,value=compiled.cells[i];
      if(value!==1&&!compiled.manifest.palette[value]?.startsWith('minecraft:light['))conflict('circulation',zone.id,traceSources[finalOwners[i]]?.component??'@keep',[x,y,z]);
    }
  }
  for(const r of reservations){
    const counts={kind:'reservation',clear:0,set:0,keep:0,instances:1};
    for(let y=r.origin[1];y<r.origin[1]+r.size[1];y++)for(let z=r.origin[2];z<r.origin[2]+r.size[2];z++)for(let x=r.origin[0];x<r.origin[0]+r.size[0];x++){
      const i=x+z*w+y*w*d,id=traceSources[finalOwners[i]]?.component,value=compiled.cells[i];counts[value===0?'keep':value===1?'clear':'set']++;
      if(value>=2&&!r.allowedComponents.includes(id))conflict('reservation',r.id,id,[x,y,z]);
    }
    reservationEvidence[r.id]=counts;
  }
  if(conflicts.size&&!diagnosticOnly){const errors=[...conflicts.values()];const error=new Error(errors.map(e=>`${e.code==='ownership'?'Ownership conflict':e.code==='opening-fill'?'Opening is not host-owned clear air':e.code==='circulation'?'Circulation zone was obstructed':'Reserved space'}: ${e.from} -> ${e.to} at [${e.point}] (${e.count} cells)`).join('\n'));error.designConflicts=errors;throw error;}
  const diagnostics=[...lowered.diagnostics];
  if(diagnosticOnly)diagnostics.push(...[...conflicts.values()].map(e=>({...e,severity:'blocked',message:'Only an analysis view of rejected source; world placement and export are disabled.'})));
  // A shaft/door opening is implemented by absence, not by a surviving solid block.
  // Check final masks across every declared void instance, including intentional later overlaps.
  const negativeSpace={...reservationEvidence};
  for(const c of scene.components.filter(c=>c.kind==='void')){
    const counts={clear:0,set:0,keep:0,instances:lowered.componentBounds[c.id].length};
    for(const r of lowered.componentBounds[c.id])for(let y=r.origin[1];y<r.origin[1]+r.size[1];y++)for(let z=r.origin[2];z<r.origin[2]+r.size[2];z++)for(let x=r.origin[0];x<r.origin[0]+r.size[0];x++){
      const value=compiled.cells[x+z*w+y*w*d];counts[value===0?'keep':value===1?'clear':'set']++;
    }
    negativeSpace[c.id]=counts;
    if(counts.set||counts.keep)diagnostics.push({code:'negative-space-obstructed',severity:'design',components:[c.id],...counts,message:'预留空洞有实体或未知保留格；可能是有意的门/栏杆，也可能是井道被填，请检查实际切面。'});
  }
  const openPanels=new Set(scene.components.filter(c=>['panelFacade','edgeFacade','storeyFacade'].includes(c.kind)&&c.glazing===null||c.kind==='storeyOpening'&&c.door===null).map(c=>c.id));
  for(const binding of scene.featureBindings){
    const missing=binding.components.filter(id=>negativeSpace[id]?!negativeSpace[id].clear:!surviving[id]&&!(openPanels.has(id)&&survivingClear[id]));
    if(missing.length)diagnostics.push({code:'feature-not-visible',severity:'design',feature:binding.feature,components:missing,message:'声明特征没有存活实体或明确空洞，请检查覆盖或绑定；不自动添加装饰。'});
  }
  for(const c of scene.components)if(c.kind!=='void'&&!surviving[c.id]&&!(openPanels.has(c.id)&&survivingClear[c.id]))diagnostics.push({code:'component-covered',severity:'design',components:[c.id],message:'构件没有存活实体几何；请确认是否有意隐藏。'});
  const componentModules=Object.fromEntries(scene.components.filter(c=>c.kind==='module').map(c=>[c.id,c.module]));
  const moduleConsumers=Object.fromEntries(scene.modules.map(m=>[m.id,scene.components.filter(c=>c.kind==='module'&&c.module===m.id).map(c=>c.id)]));
  const stairAccess=inspectStairAccess(scene,compiled,lowered.componentBounds);
  for(const c of scene.components.filter(c=>c.kind==='stairs'&&c.style==='switchback')){
    const missing=stairAccess.filter(a=>a.component===c.id&&a.status==='unverified');
    if(missing.length)diagnostics.push({code:'stair-floor-access-unverified',severity:'design',components:[c.id],face:missing[0].face,floors:[...new Set(missing.map(a=>a.floor))],message:`折返梯 ${c.id} 的 ${missing[0].face} 侧共用平台有 ${missing.length} 处未找到可步行的相邻楼层开口；请对齐门洞、平台和楼板。门/半格碰撞也可能需人工核查；未自动挖墙或旋转。`});
  }
  const designSources={version:1,sourceHash:hash(scene),nodeSources,traceSources,componentBounds:lowered.componentBounds,dependencies:lowered.dependencies,componentModules,moduleConsumers,surviving,survivingClear,negativeSpace,stairAccess,overwritten:Object.fromEntries(overwritten),diagnostics,...(lowered.roomZones.length?{roomZones:lowered.roomZones}:{}),...(lowered.parametricLayouts.length?{parametricLayouts:lowered.parametricLayouts}:{})};
  const ownerBytes=Buffer.alloc(finalOwners.length*2);finalOwners.forEach((v,i)=>ownerBytes.writeUInt16LE(v,i*2));
  const metadata={...compiled.manifest,...(diagnosticOnly?{diagnosticOnly:true}:{}),scene:{version:1,compiler:SCENE_COMPILER,sourceHash:hash(scene),sourcesHash:hash(designSources),ownersHash:hash(ownerBytes),components:scene.components.length,expandedNodes:lowered.expandedNodes,diagnostics}};delete metadata.assetHash;
  return {...compiled,manifest:{...metadata,assetHash:hash(metadata)},scene:structuredClone(scene),designSources,sourceOwners:finalOwners};
}
