import {MATERIALS} from './materials.mjs';
export const DIRECTIONS=['north','east','south','west'];
export function parseState(text){
  const m=/^(minecraft:[a-z0-9_]+)(?:\[([a-z0-9_=,]+)\])?$/.exec(text);if(!m)throw new Error('Invalid block state');
  const properties={};for(const entry of m[2]?.split(',')??[]){const [key,value,...rest]=entry.split('=');if(!value||rest.length||Object.hasOwn(properties,key))throw new Error('Invalid/duplicate block property');properties[key]=value;}
  return {id:m[1],properties};
}
export const stateText=({id,properties})=>id+(Object.keys(properties).length?'['+Object.keys(properties).sort().map(k=>k+'='+properties[k]).join(',')+']':'');
const defaults=new Map(Object.values(MATERIALS).map(s=>{const v=parseState(s);return [v.id,v.properties];}));
function choices(id,key){
  if(key==='waterlogged'||key==='powered')return ['false'];
  if(key==='facing')return DIRECTIONS;
  if(key==='half')return id.endsWith('_door')?['lower','upper']:['bottom','top'];
  if(key==='hinge')return ['left','right'];
  if(key==='open')return ['false','true'];
  if(key==='shape')return ['straight','inner_left','inner_right','outer_left','outer_right'];
  if(key==='type')return ['bottom','top','double'];
  if(key==='axis')return ['x','y','z'];
  return [defaults.get(id)?.[key]];
}
export function validateState(text){
  const {id,properties:p}=parseState(text),base=defaults.get(id);if(!base||Object.keys(base).length!==Object.keys(p).length)throw new Error('Unsupported/unsafe block state: '+text);
  for(const [k,v] of Object.entries(p))if(!Object.hasOwn(base,k)||!choices(id,k).includes(v))throw new Error('Unsupported block property: '+k+'='+v);
  return text;
}
/** Data-only shared validation catalog. Does not authorize target placement. */
export function supportedBlockStateCatalog(){
  return [...defaults].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,base])=>({id,properties:Object.fromEntries(Object.keys(base).sort().map(key=>[key,[...choices(id,key)].sort()]))}));
}
export function resolveState(material,override){
  if(!Object.hasOwn(MATERIALS,material))throw new Error('Unknown material: '+material);
  if(override===undefined||override===null)return MATERIALS[material];
  if(typeof override!=='object'||Array.isArray(override))throw new Error('blockState must be an object or null');
  const state=parseState(MATERIALS[material]);
  for(const [k,value] of Object.entries(override)){
    if(!['facing','half','hinge','open','shape','axis','type'].includes(k))throw new Error('Unknown blockState property: '+k);
    if(value===null)continue;
    if(!Object.hasOwn(state.properties,k))throw new Error(material+' does not support '+k);
    if(k==='open'?typeof value!=='boolean':typeof value!=='string')throw new Error('Invalid blockState property type: '+k);
    state.properties[k]=String(value);
  }
  return validateState(stateText(state));
}
export function transformState(text,rotation=0,mirror=false){
  const state=parseState(text),p=state.properties;
  if(p.facing){let facing=DIRECTIONS.indexOf(p.facing);if(mirror){if(facing===1)facing=3;else if(facing===3)facing=1;}p.facing=DIRECTIONS[(facing+rotation)%4];}
  if(mirror&&p.hinge)p.hinge=p.hinge==='left'?'right':'left';
  if(mirror&&p.shape&&p.shape!=='straight')p.shape=p.shape.endsWith('_left')?p.shape.replace('_left','_right'):p.shape.replace('_right','_left');
  if(rotation%2&&['x','z'].includes(p.axis))p.axis=p.axis==='x'?'z':'x';
  return stateText(state);
}
export const isDoor=s=>/^minecraft:[a-z_]+_door\[/.test(s);
export const isPartial=s=>/_(?:stairs|slab|door|trapdoor)\[/.test(s);
export const fullSupport=s=>!isPartial(s)&&!s.startsWith('minecraft:light[')||/_slab\[/.test(s)&&/type=(?:top|double)/.test(s);
export function validateDoorPairs(cells,palette,{width:w,height:h,length:d},{requireSupport=false}={}){
  const issues=[];
  const plane=w*d,doors=palette.map(s=>isDoor(s)?parseState(s):null);for(let i=0;i<cells.length;i++)if(doors[cells[i]]){
    const a=doors[cells[i]],lower=a.properties.half==='lower',y=Math.floor(i/plane),other=i+(lower?plane:-plane);
    if(y+(lower?1:-1)<0||y+(lower?1:-1)>=h||cells[other]<2)throw new Error('Door is missing its matching half at cell '+i);
    const b=parseState(palette[cells[other]]);if(a.id!==b.id||b.properties.half!==(lower?'upper':'lower')||['facing','hinge','open','powered'].some(k=>a.properties[k]!==b.properties[k]))throw new Error('Door halves disagree at cell '+i);
    if(lower&&(y===0||cells[i-plane]<2||!fullSupport(palette[cells[i-plane]]))){
      if(requireSupport)throw new Error('Door requires explicit full-block support at cell '+i);
      issues.push({code:'door-support-unverified',message:`门 [${i%w},${y},${Math.floor(i/w)%d}] 下方未提供完整支撑面：可预览，建造前必须通过世界支撑检查；未自动填充或移动。`});
    }
  }
  return issues;
}
