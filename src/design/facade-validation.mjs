import {boxViolations} from './spatial.mjs';

// The compiler and read-only feedback share these exact panel rules. Nothing
// is cropped, moved, excluded or assigned overwrite permission by this module.
export function rectangularFacadeLayout(c,host,r){
  const fail=message=>{throw new Error(`${c.id}: ${message}`);};
  if(host?.kind!=='mass'||host.repeat.count!==1)fail('facade/entry host must be a single mass');
  const borders=c.kind==='panelFacade'?c.borders:[1,1,1,1],recess=c.kind==='panelFacade'?c.recess:host.thickness-1;
  const [left,right,bottom,top]=borders;
  if(c.size[0]-left-right<1||c.size[1]-bottom-top<1)fail('facade borders consume its opening; reduce borders or enlarge the explicitly declared panel');
  if(recess>=host.thickness)fail('glazing recess must stay inside host thickness');
  if(c.sill&&!bottom||c.shade&&!top)fail('sill/shade requires a bottom/top border; never silently fill a frameless opening');
  if(c.count.some((v,i)=>v>1&&c.step[i]<c.size[i]))fail('overlapping window rhythm');
  if(c.exclude.some(p=>p.some((v,i)=>v>=c.count[i])))fail('invalid array exclusion');
  const along=c.face==='north'||c.face==='south'?0:2,normal=along===0?2:0,sign=c.face==='north'||c.face==='west'?-1:1;
  return {borders,recess,along,normal,sign,span:r.size[along],plane:r.origin[normal]+(sign===1?r.size[normal]-1:0),excludes:new Set(c.exclude.map(p=>p.join(',')))};
}
export function* rectangularFacadePanels(c,layout){
  for(let col=0;col<c.count[0];col++)for(let row=0;row<c.count[1];row++){
    if(layout.excludes.has(`${col},${row}`))continue;
    yield {column:col,row,u:c.start[0]+col*c.step[0],y:c.start[1]+row*c.step[1]};
  }
}
export function rectangularPanelProblems(c,host,r,bounds,layout,panel){
  const {u,y}=panel,[w,h]=c.size,[left,right,bottom,top]=layout.borders,issues=[];
  const violations=[];
  if(u<c.margin)violations.push({axis:'u',edge:'start',actual:u,minimum:c.margin});
  if(u+w>layout.span-c.margin)violations.push({axis:'u',edge:'endExclusive',actual:u+w,maximum:layout.span-c.margin});
  if(y<1)violations.push({axis:'y',edge:'start',actual:y,minimum:1});
  if(y+h>=r.size[1])violations.push({axis:'y',edge:'endExclusive',actual:y+h,maximum:r.size[1]-1});
  if(violations.length)issues.push({code:'facade-wall-margins',message:'window exceeds wall margins/floor/roof; '+violations.map(v=>`${v.axis}.${v.edge}=${v.actual} must be ${v.minimum!==undefined?'>='+v.minimum:'<='+v.maximum}`).join('; '),
    violations,panelRange:{u:[u,u+w],y:[y,y+h]},hostSpan:layout.span,margin:c.margin,allowedU:[c.margin,layout.span-c.margin],allowedY:[1,r.size[1]-1],hostHeight:r.size[1],roofLayer:host.roof?r.size[1]-1:null,maximumEndExclusive:r.size[1]-1});
  const floors=host.levels.filter(f=>f>=y+bottom&&f<y+h-top);
  // Legacy rectangular facades allow slab-edge apertures. Surface them for
  // design review without retroactively rejecting previously valid scenes.
  if(floors.length)issues.push({code:'facade-floor-cut',severity:'review',message:'window opening intersects a declared floor edge; review the explicit rhythm and support',floors,openingY:[y+bottom,y+h-top]});
  // Exact union bounds of emitted operations (glass may be inset, while an
  // all-zero, unglazed panel emits only its host-wall clear operation).
  const depths=[0];if(left||right||bottom||top||c.lattice&&w-left-right>1)depths.push(c.projection);
  if(c.sill)depths.push(c.sill);if(c.shade)depths.push(c.shade);
  const depth=Math.max(...depths),origin=[...r.origin],size=[1,h,1];
  origin[layout.along]+=u;origin[1]+=y;size[layout.along]=w;
  origin[layout.normal]=layout.plane+(layout.sign<0?-depth:-(host.thickness-1));size[layout.normal]=host.thickness+depth;
  const projectionViolations=boxViolations(origin,size,bounds);
  if(projectionViolations.length)issues.push({code:'facade-projection-bounds',message:'facade projection outside scene; reserve space explicitly',origin,size,violations:projectionViolations});
  return issues;
}
export function validateRectangularFacade(c,host,r,bounds){
  const layout=rectangularFacadeLayout(c,host,r);
  for(const panel of rectangularFacadePanels(c,layout)){
    const problem=rectangularPanelProblems(c,host,r,bounds,layout,panel).find(p=>p.severity!=='review');
    if(problem)throw new Error(`${c.id}: ${problem.message}`);
  }
  return layout;
}
