import {worldPoint,WORLD_SELECTION_LIMITS} from '../../contracts/world-selection.mjs';

export const WORLD_DIFFERENCES=Object.freeze(['added','removed','replaced']);
const air=state=>['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(state);
const order=(a,b)=>a.y-b.y||a.z-b.z||a.x-b.x;

/** Geometry encoding ONLY. No scope, snapshot, physics, eligibility or write
 * authority is established here. Callers must validate their complete input
 * protocol first; identical layout does not make different policies compatible. */
export function encodeSparseWorldDifference(writes,{signal}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(writes)||!writes.length||writes.length>WORLD_SELECTION_LIMITS.editCells)throw Error('Sparse difference write quota');
  const palette=[...new Set(writes.flatMap(w=>[w.before,w.after]))].sort();
  if(palette.length>WORLD_SELECTION_LIMITS.paletteStates||palette.some(s=>typeof s!=='string'||!s.length||s.length>512))throw Error('Sparse difference palette quota or state');
  const ids=new Map(palette.map((s,i)=>[s,i])),sections=new Map(),counts={added:0,removed:0,replaced:0};
  let bounds=null;
  for(let i=0;i<writes.length;i++){
    if(!(i%1024))signal?.throwIfAborted();
    const w=writes[i],point=worldPoint(w.position),code=WORLD_DIFFERENCES.indexOf(w.difference);
    const expected=air(w.before)?'added':air(w.after)?'removed':'replaced';
    if(code<0||w.difference!==expected||w.before===w.after||air(w.before)&&air(w.after))throw Error('Sparse difference classification or no-op mismatch');
    if(!bounds)bounds={min:[...point],max:point.map(n=>n+1)};
    point.forEach((n,a)=>{bounds.min[a]=Math.min(bounds.min[a],n);bounds.max[a]=Math.max(bounds.max[a],n+1);});counts[w.difference]++;
    const [x,y,z]=point.map(n=>Math.floor(n/16)),key=[x,y,z].join(',');
    let section=sections.get(key);if(!section){section={x,y,z,rows:[]};sections.set(key,section);}
    const local=point.map((n,a)=>n-[x,y,z][a]*16),index=local[1]*256+local[2]*16+local[0];
    section.rows.push([index,ids.get(w.before),ids.get(w.after),code]);
  }
  const sorted=[...sections.values()].sort(order);
  for(const section of sorted){section.rows.sort((a,b)=>a[0]-b[0]);if(section.rows.some((r,i)=>i&&r[0]===section.rows[i-1][0]))throw Error('Sparse difference duplicates a world coordinate');}
  signal?.throwIfAborted();return {palette,sections:sorted,bounds,counts};
}
