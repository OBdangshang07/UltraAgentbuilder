import {hash} from '../generation/compiler.mjs';
import {architectureEvidence} from './architecture-evidence.mjs';

/** Facts for an independent reviewer, not a universal style/glass-ratio gate.
 * Nominal aperture totals are deliberately not called visible facade area. */
export function revisionMeasurements(before,after){
  const old=architectureEvidence(before),current=architectureEvidence(after);
  const previous=new Map(before.components.map(c=>[c.id,c])),next=new Map(after.components.map(c=>[c.id,c]));
  const changedComponents=[...new Set([...previous.keys(),...next.keys()])].filter(id=>hash(previous.get(id)??null)!==hash(next.get(id)??null)).map(id=>({id,change:!previous.has(id)?'added':!next.has(id)?'removed':'modified',kind:next.get(id)?.kind??previous.get(id).kind}));
  const nominal=c=>{
    const source=(c===old?before:after);
    return new Map(c.facadeUnits.map(unit=>{
      const component=source.components.find(v=>v.id===unit.id),panels=unit.count[0]*unit.count[1]-new Set(component.exclude.map(v=>v.join(','))).size;
      return [unit.id,{panels,nominalOpeningArea:unit.opening[0]*unit.opening[1]*panels,opening:unit.opening,count:unit.count,step:unit.step,borders:unit.borders,openingShareOfRepeatedUnit:unit.openingShareOfRepeatedUnit,glazing:unit.glazing}];
    }));
  };
  const a=nominal(old),b=nominal(current),facadeChanges=[];
  for(const id of new Set([...a.keys(),...b.keys()])){
    const prior=a.get(id)??null,now=b.get(id)??null;if(hash(prior)===hash(now))continue;
    facadeChanges.push({id:'facade/'+id,component:id,before:prior,after:now,nominalOpeningAreaDelta:(now?.nominalOpeningArea??0)-(prior?.nominalOpeningArea??0),requiresTradeoffExplanation:!!prior&&((now?.nominalOpeningArea??0)<prior.nominalOpeningArea||(now?.openingShareOfRepeatedUnit??0)<prior.openingShareOfRepeatedUnit||now?.glazing!==prior.glazing)});
  }
  const changedModules=[...new Set([...before.modules.map(m=>m.id),...after.modules.map(m=>m.id)])].filter(id=>hash(before.modules.find(m=>m.id===id)??null)!==hash(after.modules.find(m=>m.id===id)??null));
  const data={version:1,beforeSourceHash:hash(before),afterSourceHash:hash(after),changedComponents,changedModules,facadeChanges,
    requiredTradeoffFacts:facadeChanges.filter(f=>f.requiresTradeoffExplanation).map(f=>f.id),
    geometryChangeVerified:false,aestheticQualityVerified:false,canAuthorizePlacement:false,
    limitations:['These are source changes, not proof of emitted cell changes or aesthetic improvement.',
      'Nominal aperture area counts declared panels minus exclusions. Occlusion, overlap, projections and real glazing visibility are not measured.',
      'storeyFacade derived arrays are listed in architectureEvidence and need compiler-resolved comparison; no invented nominal total is reported here.',
      'A reduction may be an intentional design decision, but the reviewer must explain its effect using the unchanged user brief and before/after evidence.']};
  return {...data,measurementsHash:hash(data)};
}
