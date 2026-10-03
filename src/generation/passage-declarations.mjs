/** Correct AI assertion metadata only. Never adds/removes a geometry node or changes a keep/clear/set cell. */
export function normalizePassages(spec, cells, palette) {
  const {width:w,height:h,length:d}=spec.bounds, index=(x,y,z)=>x+z*w+y*w*d;
  const standing=(x,y,z)=>y>=1&&y+1<h&&cells[index(x,y,z)]===1&&cells[index(x,y+1,z)]===1&&cells[index(x,y-1,z)]>=2&&!palette[cells[index(x,y-1,z)]].includes('minecraft:light[');
  const passages=[];
  for(const original of spec.constraints.passages){
    const [x,y,z]=original.origin,[sx,sy,sz]=original.size;
    if(![x,y,z,sx,sy,sz].every(Number.isInteger)||x<0||y<0||z<0||sx<1||sy<1||sz<1||x+sx>w||y+sy>h||z+sz>d)throw new Error('Passage declaration is outside bounds; geometry was not repaired');
    // Preserve each requested checkpoint's X/Z; only permit the common floor-vs-feet off-by-one.
    const feet=standing(x,y,z)?y:standing(x,y+1,z)?y+1:null;
    if(feet===null)throw new Error(`Passage checkpoint [${x},${y},${z}] is blocked or unknown; geometry was not repaired`);
    const region=[];
    for(let zz=z;zz<z+sz;zz++)for(let xx=x;xx<x+sx;){
      if(!standing(xx,feet,zz)){xx++;continue;}
      const start=xx;while(xx<x+sx&&standing(xx,feet,zz))xx++;
      region.push({origin:[start,feet,zz],size:[xx-start,2,1]});
    }
    // The first region starts at the original checkpoint; full connected-interior validation still follows.
    passages.push(...region);
    if(passages.length>256)throw new Error('Normalized passage quota exceeded');
  }
  return {...spec,constraints:{...spec.constraints,passages}};
}
