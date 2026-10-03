import {validateScene} from '../../contracts/scene-spec.schema.mjs';
import {BUILDING_LIMITS as L} from '../../contracts/building-limits.mjs';
import {hash} from '../generation/compiler.mjs';
import {addVector,numeric,resolveAnchor,resolvePlacement,lowerModuleNode,boxViolations} from './spatial.mjs';
import {profileFootprint} from './profile.mjs';
import {validateRoomZone} from './room-zone.mjs';
import {rectangularFacadeLayout,rectangularFacadePanels,rectangularPanelProblems} from './facade-validation.mjs';
import {expandStoreyFacade} from './storey-layout.mjs';
import {isFloorComponent,componentReferences} from './floor-components.mjs';
import {stairBoundsProblem} from './stair-bounds.mjs';

/** Bounded static feedback, not a compiler/preview, collision or navigation pass.
 * It deliberately reports ambiguous data instead of choosing a design repair.
 * Both first and last repetition suffice for containment in a convex AABB.
 */
export function inspectConstruction(source,{maxIssues=128,maxPrimitiveChecks=65536,maxProfileWork=1000000}={}){
  if(!Number.isInteger(maxIssues)||maxIssues<1||maxIssues>512||!Number.isInteger(maxPrimitiveChecks)||maxPrimitiveChecks<1||maxPrimitiveChecks>65536||!Number.isInteger(maxProfileWork)||maxProfileWork<1||maxProfileWork>L.visits)throw new Error('Invalid construction feedback budget');
  const report={version:1,sourceHash:hash(source),status:'passed',checksComplete:true,canAuthorizePlacement:false,
    coverage:['component-coordinate-frames','component-repeat-bounds','permission-reference-existence','stairs-world-box-host-containment','instantiated-module-local-bounds','room-zone-host-floors-and-footprints','reservation-coordinate-frames','rectangular-facade-panels-roofs-floors-projections','storey-facade-rule-expansion-and-representatives','profile-facade-host-and-edge-references'],
    notChecked:['unused-module-definitions','profiles-without-room-zones','stairs-profile-footprint-and-flight-engineering','edge-facade-openings','entry-openings','materials-and-block-states','ownership','navigation','architectural-quality'],
    issues:[],issueGroups:[],groupsTruncated:false,issueCount:0,blockingIssueCount:0,truncated:false,primitiveChecks:0,profileWork:0,skippedComponents:[]};
  const groups=new Map();
  const issue=data=>{
    report.issueCount++;if(data.severity!=='review')report.blockingIssueCount++;
    if(report.issues.length<maxIssues)report.issues.push(data);else report.truncated=true;
    // Keep per-component feedback even when one repeated facade exhausts the
    // raw sample limit. Group by violated edge as well as rule: a U error must
    // not conceal an independent top-row Y error in the same component.
    const key=JSON.stringify([data.component,data.reservation,data.code,data.severity,data.node,data.referenceField,data.reference,data.violations?.map(v=>[v.axis,v.edge])]);
    let group=groups.get(key);
    if(!group){
      if(groups.size>=512){report.groupsTruncated=true;return;}
      group={...data,occurrences:0};groups.set(key,group);report.issueGroups.push(group);
      if(data.panel)group.panelIndexRange={columns:[data.panel.column,data.panel.column],rows:[data.panel.row,data.panel.row]};
    }
    group.occurrences++;
    if(data.panel){group.lastPanel=data.panel;for(const [key,value] of [['columns',data.panel.column],['rows',data.panel.row]]){group.panelIndexRange[key][0]=Math.min(group.panelIndexRange[key][0],value);group.panelIndexRange[key][1]=Math.max(group.panelIndexRange[key][1],value);}}
  };
  try{validateScene(source);}catch(error){issue({code:'schema-invalid',message:error.message});report.status='errors';report.checksComplete=false;return report;}
  const bounds=[source.bounds.width,source.bounds.height,source.bounds.length];
  if(bounds.reduce((a,b)=>a*b,1)>L.cells){issue({code:'scene-volume',message:'Scene volume quota exceeded'});report.status='errors';report.checksComplete=false;return report;}
  const components=new Map(),modules=new Map(),resolved=new Map(),failed=new Map(),visiting=new Set();
  const incomplete=message=>Object.assign(new Error(message),{diagnosticIncomplete:true});
  for(const c of source.components){if(components.has(c.id))issue({code:'duplicate-component',component:c.id});components.set(c.id,c);}
  for(const m of source.modules){if(modules.has(m.id))issue({code:'duplicate-module',module:m.id});modules.set(m.id,m);}
  if(report.issueCount){report.status='errors';report.checksComplete=false;return report;}
  // Match existing compiler rules, but report every missing permission target
  // in one bounded feedback pass. Future package IDs are not present geometry;
  // never silently remove a permission, create a placeholder, or widen a scope.
  for(const [index,c] of source.components.entries())for(const [i,id] of c.allowOverwrite.entries())if(!components.has(id))issue({code:'permission-reference-missing',component:c.id,referenceField:'allowOverwrite',reference:id,path:`components[${index}].allowOverwrite[${i}]`,message:'Unknown component reference: '+id});
  for(const [index,r] of source.reservations.entries())for(const [i,id] of r.allowedComponents.entries())if(!components.has(id))issue({code:'permission-reference-missing',reservation:r.id,referenceField:'allowedComponents',reference:id,path:`reservations[${index}].allowedComponents[${i}]`,message:'Unknown component reference: '+id});
  function resolve(id,depth=0){
    if(resolved.has(id))return resolved.get(id);
    if(failed.has(id))throw failed.get(id);
    if(visiting.has(id))throw new Error('Cyclic component anchor: '+id);
    if(depth>32)throw new Error('Component dependency depth exceeds 32');
    const c=components.get(id);if(!c)throw new Error('Unknown component reference: '+id);
    visiting.add(id);
    try{
      for(const ref of componentReferences(c))resolve(ref,depth+1);
      if(isFloorComponent(c)){
        const work=c.floors.count*2;
        if(report.primitiveChecks+work>maxPrimitiveChecks)throw incomplete('Floor-layout diagnostic work budget exhausted; evidence incomplete');
        report.primitiveChecks+=work;
        const host=components.get(c.host),hr=resolved.get(c.host);
        if(host.kind==='profileMass'&&!hr.profile){
          const cost=hr.size[0]*hr.size[2]*10+host.points.length**2+hr.size[2]*host.points.length*2;
          if(report.profileWork+cost>maxProfileWork)throw incomplete('Floor-layout profile diagnostic budget exhausted; evidence incomplete');
          report.profileWork+=cost;hr.profile=profileFootprint(hr.size[0],hr.size[2],host.points,host.thickness);
        }
      }
      const r=resolvePlacement(c,modules,resolved,bounds,components);resolved.set(id,r);return r;
    }catch(error){failed.set(id,error);throw error;}finally{visiting.delete(id);}
  }
  function checkBox(origin,size,limit,data){
    const violations=boxViolations(origin,size,limit);
    if(violations.length)issue({...data,origin:[...origin],size:[...size],endExclusive:addVector(origin,size),bounds:[...limit],violations});
  }
  const endpoints=repeat=>repeat.count>1?[0,repeat.count-1]:[0];
  const profileFailures=new Map();
  for(const [index,c] of source.components.entries()){
    let r;try{r=resolve(c.id);}catch(error){if(!error.diagnosticIncomplete)issue({code:error.layoutFeedback?'floor-layout':'coordinate-unresolved',component:c.id,path:`components[${index}]`,message:error.message,...(error.layoutFeedback?{layoutFeedback:error.layoutFeedback}:{})});report.skippedComponents.push(c.id);report.checksComplete=false;continue;}
    if(r.floorLayout)(report.parametricLayouts??=[]).push(r.floorLayout.evidence);
    const repeat=c.repeat??{count:1,step:[0,0,0]};
    // Hosted facade size is U/V, not an independent XYZ volume.
    if(c.at)for(const instance of endpoints(repeat))checkBox(addVector(r.origin,repeat.step.map(v=>v*instance)),r.size,bounds,{code:'component-bounds',component:c.id,path:`components[${index}]`,instance,repeat,frame:r.frame});
    if(c.kind==='stairs'){
      const host=components.get(c.host),hr=resolved.get(c.host);
      if(!['mass','profileMass'].includes(host.kind))issue({code:'stairs-host-invalid',component:c.id,host:c.host,path:`components[${index}]`,message:'Stairs host must be a mass or profileMass'});
      else for(const instance of endpoints(repeat)){
        if(report.primitiveChecks>=maxPrimitiveChecks){report.checksComplete=false;report.skippedComponents.push(c.id);break;}
        report.primitiveChecks++;
        const problem=stairBoundsProblem(c,host,hr,addVector(r.origin,repeat.step.map(v=>v*instance)),r.size,instance);
        if(problem)issue({...problem,path:`components[${index}]`,repeat,frame:r.frame});
      }
    }
    if(c.kind==='storeyFacade'){
      // Reserve the bounded worst-case work before expansion. Skipped evidence
      // is explicitly incomplete; it never masquerades as a geometry pass.
      const work=2*(c.columns.count==='fit'?64:c.columns.count)*c.floors.count;
      if(report.primitiveChecks+work>maxPrimitiveChecks){report.checksComplete=false;report.skippedComponents.push(c.id);continue;}
      report.primitiveChecks+=work;
      try{
        const expanded=expandStoreyFacade(c,components.get(c.host),resolved.get(c.host),bounds);
        (report.parametricLayouts??=[]).push(expanded.evidence);
      }catch(error){issue({code:'facade-layout',component:c.id,host:c.host,path:`components[${index}]`,message:error.message,layoutFeedback:error.layoutFeedback});}
    }
    if(['facade','panelFacade'].includes(c.kind)){
      try{
        const host=components.get(c.host),hr=resolved.get(c.host),layout=rectangularFacadeLayout(c,host,hr);
        for(const panel of rectangularFacadePanels(c,layout)){
          if(report.primitiveChecks>=maxPrimitiveChecks){report.checksComplete=false;report.skippedComponents.push(c.id);break;}
          report.primitiveChecks++;
          for(const problem of rectangularPanelProblems(c,host,hr,bounds,layout,panel))issue({...problem,component:c.id,host:c.host,face:c.face,panel,path:`components[${index}]`});
        }
      }catch(error){issue({code:'facade-invalid',component:c.id,host:c.host,message:error.message,path:`components[${index}]`});}
    }
    if(c.kind==='edgeFacade'){
      // Mirror only the compiler's existing host/edge relation checks. Panel
      // masks, margins, floor intersections and ownership remain unchecked
      // here and must still pass the unchanged full compiler.
      if(report.primitiveChecks>=maxPrimitiveChecks){report.checksComplete=false;report.skippedComponents.push(c.id);continue;}
      report.primitiveChecks++;
      const host=components.get(c.host),facts={component:c.id,host:c.host,path:`components[${index}]`,expectedHostKind:'profileMass',actualHostKind:host.kind,
        hostRepeat:host.repeat??null,edge:c.edge,availableEdges:host.kind==='profileMass'?host.points.length:null};
      if(host.kind!=='profileMass'||host.repeat.count!==1)issue({...facts,code:'edge-facade-host-invalid',message:c.id+': edgeFacade host must be one profileMass'});
      else if(c.edge>=host.points.length)issue({...facts,code:'edge-facade-edge-missing',message:c.id+': missing profile edge'});
    }
    if(c.kind==='roomZone'){
      const host=components.get(c.host),hr=resolved.get(c.host);
      try{
        if(host.kind==='profileMass'&&!hr.profile){
          if(profileFailures.has(host.id))throw new Error(profileFailures.get(host.id));
          const cost=hr.size[0]*hr.size[2]*10+host.points.length**2+hr.size[2]*host.points.length*2;
          if(report.profileWork+cost>maxProfileWork){report.checksComplete=false;report.skippedComponents.push(c.id);continue;}
          report.profileWork+=cost;
          try{hr.profile=profileFootprint(hr.size[0],hr.size[2],host.points,host.thickness);}catch(error){profileFailures.set(host.id,error.message);throw error;}
        }
        validateRoomZone(c,host,hr,r.origin);
      }catch(error){issue({code:'room-zone-invalid',component:c.id,host:c.host,path:`components[${index}]`,message:error.message,frame:r.frame,origin:r.origin,size:r.size,repeat,
        hostOrigin:hr.origin,hostSize:hr.size,hostThickness:host.thickness,hostFloors:host.levels,hostRoof:host.roof,...(error.roomZoneFeedback?{roomZoneFeedback:error.roomZoneFeedback}:{})});}
    }
    if(c.kind!=='module')continue;
    const template=modules.get(c.module),templateIndex=source.modules.indexOf(template),local=template.size.map(v=>numeric(v,r.parameters)),seen=new Set();
    const binding={component:c.id,module:template.id,values:[...r.parameters].map(([name,p])=>({name,value:p.value})),localBounds:local,worldOrigin:r.origin,worldSize:r.size,rotation:c.rotation,mirror:c.mirror};
    for(const [ni,node] of template.nodes.entries()){
      if(report.primitiveChecks>=maxPrimitiveChecks){report.checksComplete=false;report.skippedComponents.push(c.id);break;}
      const detail={...binding,node:node.nodeId,path:`modules[${templateIndex}].nodes[${ni}]`};
      if(seen.has(node.nodeId)){issue({...detail,code:'duplicate-module-node'});continue;}seen.add(node.nodeId);
      try{
        // Check declared bounds too: lowered components cannot make a malformed
        // template appear valid by emitting only some of its declared volume.
        const origin=node.origin.map(v=>numeric(v,r.parameters)),size=node.size.map(v=>numeric(v,r.parameters));
        report.primitiveChecks++;
        for(const instance of endpoints(node.repeat))checkBox(addVector(origin,node.repeat.step.map(v=>v*instance)),size,local,{...detail,code:'module-local-bounds',nodeRepeatIndex:instance});
        const low=lowerModuleNode(node,r.parameters);
        for(const part of low){
          if(report.primitiveChecks>=maxPrimitiveChecks){report.checksComplete=false;break;}
          report.primitiveChecks++;
          // Avoid repeating identical source/primitive evidence (ordinary box).
          if(part.origin.every((v,i)=>v===origin[i])&&part.size.every((v,i)=>v===size[i]))continue;
          for(const instance of endpoints(part.repeat))checkBox(addVector(part.origin,part.repeat.step.map(v=>v*instance)),part.size,local,{...detail,code:'module-emitted-bounds',primitive:part.nodeId,nodeRepeatIndex:instance});
        }
      }catch(error){issue({...detail,code:'module-node-invalid',message:error.message});}
    }
  }
  for(const [index,r] of source.reservations.entries()){
    try{if(r.at.relativeTo)resolve(r.at.relativeTo);const placed=resolveAnchor(r.at,resolved,bounds);checkBox(placed.origin,r.size,bounds,{code:'reservation-bounds',reservation:r.id,path:`reservations[${index}]`,frame:placed.frame});}
    catch(error){if(!error.diagnosticIncomplete)issue({code:'reservation-unresolved',reservation:r.id,message:error.message});report.checksComplete=false;}
  }
  report.status=report.blockingIssueCount?'errors':!report.checksComplete?'incomplete':report.issueCount?'review':'passed';
  report.skippedComponents=[...new Set(report.skippedComponents)];
  return report;
}
