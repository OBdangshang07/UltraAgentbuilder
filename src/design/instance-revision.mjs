import {hash} from '../generation/compiler.mjs';

const intersects=(a,b)=>a.origin.every((v,i)=>v<b.origin[i]+b.size[i]&&b.origin[i]<v+a.size[i]);
const shifted=(c,first,count)=>{
 const next=structuredClone(c);next.at.offset=next.at.offset.map((v,i)=>v+first*c.repeat.step[i]);next.repeat.count=count;return next;
};

/** Split a finite array without changing its data dialect or executing generated code.
 * The original ID keeps instance zero, so existing anchors retain their meaning.
 * Every other instance's complete emitted region remains protected, including air.
 */
export function forkInstanceReplacements(scene,replacements,scope,base){
 let next=structuredClone(scene);const created=[],changed=[],forks=[],protectedRegions=[];
 const selections=new Map((scope.instances??[]).map(s=>[s.component,s.index]));
 const handled=new Set(),aliases=new Map();
 for(const item of replacements){
  if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['component','index','replacement','module'].includes(k)))throw new Error('Invalid instance replacement');
  const {component:id,index,replacement}=item;
  if(!selections.has(id)||selections.get(id)!==index||handled.has(id))throw new Error('Instance replacement outside approved selection');
  handled.add(id);
  const original=scene.components.find(c=>c.id===id),bounds=base.designSources.componentBounds[id];
  if(!original?.at||!original.repeat||index>=original.repeat.count||index<0)throw new Error('Unknown repeated instance');
  if(bounds.some((r,i)=>i!==index&&intersects(bounds[index],r)))throw new Error('Overlapping instance regions require an explicit component-wide revision');
  if(!replacement||replacement.id!==id||replacement.repeat?.count!==1||replacement.repeat.step.some(v=>v!==0))throw new Error('An instance replacement retains its source ID and uses repeat count 1 / zero step');
  const used=new Set([...next.components,...next.modules].map(c=>c.id));
  const identity=kind=>{const value='i'+hash({base:base.manifest.assetHash,id,index,kind}).slice(0,25);if(used.has(value))throw new Error('Derived instance identity collision');used.add(value);return value;};
  const pieces=[],selected=structuredClone(replacement);
  if(index>0){pieces.push(shifted(original,0,index));selected.id=identity('selected');created.push(selected.id);}else changed.push(id);
  selected.repeat={count:1,step:[0,0,0]};
  if(item.module!==undefined&&item.module!==null){
   if(original.kind!=='module'||selected.kind!=='module'||selected.module!==original.module||item.module.id!==original.module)throw new Error('Private module fork must refine the selected original template');
   const module=structuredClone(item.module);module.id=identity('private-module');next.modules.push(module);selected.module=module.id;
  }
  pieces.push(selected);
  if(index+1<original.repeat.count){const tail=shifted(original,index+1,original.repeat.count-index-1);tail.id=identity('tail');created.push(tail.id);pieces.push(tail);}
  next.components=next.components.flatMap(c=>c.id===id?pieces:[c]);
  aliases.set(id,pieces.map(c=>c.id));changed.push(selected.id);
  protectedRegions.push(...bounds.filter((_,i)=>i!==index));
  forks.push({component:id,index,selectedComponent:selected.id,privateModule:selected.module!==original.module?selected.module:null,derivedComponents:pieces.map(c=>c.id)});
 }
 // Original permissions already covered these same array members. Expanding the names
 // after a split preserves that meaning; final region/state checks still bound every edit.
 const expand=ids=>[...new Set(ids.flatMap(id=>aliases.get(id)??[id]))];
 for(const c of next.components)c.allowOverwrite=expand(c.allowOverwrite);
 for(const r of next.reservations)r.allowedComponents=expand(r.allowedComponents);
 for(const b of next.featureBindings)b.components=expand(b.components);
 return {scene:next,created,changed:[...new Set(changed)],forks,protectedRegions};
}
