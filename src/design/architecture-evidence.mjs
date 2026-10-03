import {hash} from '../generation/compiler.mjs';

/** Source measurements, not aesthetic scores. No style or glass-ratio gate. */
export function architectureEvidence(scene){
  const roles=new Map(scene.palette.map(p=>[p.role,p.material]));
  const material=value=>roles.get(value)??value;
  return {version:1,sourceHash:hash(scene),metresPerCell:1,
    masses:scene.components.filter(c=>['mass','profileMass'].includes(c.kind)).map(c=>({id:c.id,kind:c.kind,at:c.at,size:c.size,repeat:c.repeat,material:material(c.material),floorElevations:c.levels})),
    storeyFacadeRules:scene.components.filter(c=>c.kind==='storeyFacade').map(c=>({id:c.id,host:c.host,face:c.face,columns:c.columns,floors:c.floors,insets:c.insets,margin:c.margin,borders:c.borders,exclude:c.exclude,glazing:c.glazing===null?null:material(c.glazing),frame:material(c.frame),projection:c.projection,recess:c.recess,lattice:c.lattice,sill:c.sill,shade:c.shade})),
    floorInterfaceRules:scene.components.filter(c=>['storeyRoom','storeyOpening'].includes(c.kind)).map(c=>structuredClone(c)),
    facadeUnits:scene.components.filter(c=>['facade','panelFacade','edgeFacade'].includes(c.kind)).map(c=>{
      const borders=c.kind==='facade'?[1,1,1,1]:c.borders;
      const opening=[c.size[0]-borders[0]-borders[1],c.size[1]-borders[2]-borders[3]];
      const area=opening[0]*opening[1],tile=c.step[0]*c.step[1];
      return {id:c.id,host:c.host,face:c.face??null,edge:c.edge??null,size:c.size,borders,opening,count:c.count,step:c.step,
        openingShareOfPanel:area/(c.size[0]*c.size[1]),
        openingShareOfRepeatedUnit:c.count.every(n=>n>1)&&tile>0?area/tile:null,
        glazing:c.glazing===null?null:material(c.glazing),frame:material(c.frame),
        lattice:c.lattice,recess:c.recess??null,projection:c.projection??0,shade:c.shade??0};
    }),
    limitations:['Panel measurements are nominal source openings, not a measured whole-elevation glass percentage. Exclusions, overlap, lattice, projections and other occlusion are not deducted.',
      'A one-cell border is about one metre. Evaluate its scale against the intended architecture; no universal glass-ratio or complexity target applies.',
      'Geometry compilation, component count and tier are not design-quality certification.'],
    aestheticQualityVerified:false,canAuthorizePlacement:false};
}
