// Shared containment arithmetic, not a design repair or navigation certificate.
// Unlike module templates, stairs.size is already a WORLD-axis reservation box.
export function stairBoundsProblem(c,host,hr,origin,size,instance=0){
  const min=hr.origin.map((v,i)=>v+(i===1?0:host.thickness));
  const end=hr.origin.map((v,i)=>v+hr.size[i]-(i===1?0:host.thickness));
  const violations=['x','y','z'].flatMap((axis,i)=>{
    const last=origin[i]+size[i];
    return origin[i]<min[i]||last>end[i]?[{axis,origin:origin[i],endExclusive:last,allowedMin:min[i],allowedEndExclusive:end[i],belowBy:Math.max(0,min[i]-origin[i]),aboveBy:Math.max(0,last-end[i])}]:[];
  });
  if(!violations.length)return null;
  const local=c.rotation%2?[size[2],size[1],size[0]]:[...size];
  return {code:'stairs-host-bounds',component:c.id,host:c.host,instance,origin:[...origin],worldSize:[...size],hostInteriorMin:min,hostInteriorEndExclusive:end,
    rotation:c.rotation,localRun:local[0],localBreadth:local[2],violations,canAuthorizePlacement:false,
    message:`${c.id}: staircase would alter exterior of ${c.host} at instance ${instance}; ${violations.map(v=>`${v.axis.toUpperCase()} [${v.origin},${v.endExclusive}) must fit [${v.allowedMin},${v.allowedEndExclusive})`).join('; ')}. stairs.size=[${size}] is the WORLD-axis box; rotation=${c.rotation} gives local run=${local[0]}, breadth=${local[2]} and does not rotate that box. Revise explicit placement/size or host design; no automatic clipping or permission expansion.`};
}
