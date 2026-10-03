import { createHash } from 'node:crypto';
import { MATERIALS, MATERIAL_VERSION } from './materials.mjs';
import {lowerComponent} from './components.mjs';
import {inspectNavigation} from './navigation.mjs';
import {normalizePassages} from './passage-declarations.mjs';
import {BUILDING_LIMITS} from '../../contracts/building-limits.mjs';
import {NavigationQualityError,navigationIssue,UNVERIFIED_NOTE} from './quality.mjs';
import {resolveState,transformState,validateDoorPairs,isPartial,fullSupport} from './block-states.mjs';
import {expandGroups,transformPoint} from './groups.mjs';

export const LIMITS = BUILDING_LIMITS;
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stable(value)).digest('hex');
function integer(n, min, max, label) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}: expected integer ${min}..${max}`);
  return n;
}
function vec(v, label, min = 0, max = LIMITS.height) {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${label}: expected [x,y,z]`);
  return v.map((n, i) => integer(n, min, max, `${label}[${i}]`));
}
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  for (const k of Object.keys(value)) if (!allowed.includes(k)) throw new Error(`${label}: unknown field ${k}`);
}

/** Finite data-only operations. Last node wins; 0=keep, 1=clear, >=2=set. */
export function compileSpec(spec, {normalizeGeneratedPassages=false,navigationPolicy='strict',traceNodes=false,onWrite,floorNodeIds}={}) {
  if(!['strict','review'].includes(navigationPolicy))throw new Error('Invalid navigation policy');
  const qualityIssues=[],compatibilityNotes=[];
  if (Buffer.byteLength(JSON.stringify(spec)) > LIMITS.bytes) throw new Error('Spec byte quota exceeded');
  keys(spec, ['schemaVersion', 'id', 'seed', 'units', 'bounds', 'palette', 'nodes', 'constraints',...(spec.schemaVersion===2?['design','groups','instances']:[])], 'spec');
  if (![1,2].includes(spec.schemaVersion) || spec.units !== 'block') throw new Error('Unsupported schemaVersion/units');
  if(spec.design){keys(spec.design,['style','concept','silhouette','paletteIntent','features'],'design');for(const k of ['style','concept','silhouette','paletteIntent'])if(typeof spec.design[k]!=='string'||spec.design[k].length>1200)throw new Error('Invalid design brief');if(!Array.isArray(spec.design.features)||spec.design.features.length>16||spec.design.features.some(s=>typeof s!=='string'||s.length>300))throw new Error('Invalid design features');}
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(spec.id)) throw new Error('Invalid asset id');
  integer(spec.seed, 0, 2147483647, 'seed');
  keys(spec.bounds, ['width', 'height', 'length'], 'bounds');
  const { width: w, height: h, length: d } = spec.bounds;
  integer(w, 1, LIMITS.width, 'width'); integer(h, 1, LIMITS.height, 'height'); integer(d, 1, LIMITS.length, 'length');
  if (w * h * d > LIMITS.cells) throw new Error('Volume quota exceeded');
  keys(spec.constraints, ['interior', 'walkable', 'passages'], 'constraints');
  if (typeof spec.constraints.interior !== 'boolean' || typeof spec.constraints.walkable !== 'boolean') throw new Error('constraints require interior/walkable booleans');
  if (!spec.palette || Array.isArray(spec.palette) || typeof spec.palette !== 'object') throw new Error('palette must be object');
  const palette = ['@keep', 'minecraft:air'], lookup = new Map();
  const paletteId=state=>{if(!palette.includes(state)){if(palette.length>=256)throw new Error('Palette state quota exceeded (254 materials/states)');palette.push(state);}return palette.indexOf(state);};
  for (const [role, material] of Object.entries(spec.palette)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(role) || !Object.hasOwn(MATERIALS, material)) throw new Error(`Unknown material: ${role}=${material}`);
    const state = MATERIALS[material];
    lookup.set(role, paletteId(state));
  }
  if (!Array.isArray(spec.nodes) || !spec.nodes.length&&!spec.instances?.length || spec.nodes.length > LIMITS.nodes) throw new Error('Invalid node count');
  const cells = new Uint16Array(w * h * d), ids = new Set();
  // Optional trusted compiler instrumentation. No callback ever comes from model data.
  const owners=traceNodes||onWrite?new Uint16Array(cells.length):null, traceIds=[''];
  // Intent is positional, not palette-based: a floor and a table may use the same block.
  const floorCells = spec.constraints.walkable ? new Uint8Array(cells.length) : null;
  const lowered=expandGroups(spec).flatMap(n=>lowerComponent(n,{review:navigationPolicy==='review',onIssue:e=>qualityIssues.push(navigationIssue(e)),onCompatibility:n=>compatibilityNotes.push(n)}));if(lowered.length>LIMITS.nodes)throw new Error('Expanded component node quota exceeded');
  let visits = 0;
  for (const loweredNode of lowered) {
    const {_group:group,_door:doorComponent,...n}=loweredNode;
    keys(n, ['nodeId', 'op', 'origin', 'size', 'material', 'thickness', 'axis', 'repeat', 'points',...(spec.schemaVersion===2?['blockState']:[])], 'node');
    if (typeof n.nodeId !== 'string' || !/^[\w-]{1,64}$/.test(n.nodeId) || ids.has(n.nodeId)) throw new Error(`Duplicate/invalid nodeId: ${n.nodeId}`);
    ids.add(n.nodeId);
    const traceId=owners?traceIds.push(n.nodeId)-1:0;
    if (!['box', 'shell', 'clear', 'keep', 'cylinder', 'stair', 'arch', 'polygonExtrude'].includes(n.op)) throw new Error(`Unsupported op: ${n.op}`);
    const o = vec(n.origin, `${n.nodeId}.origin`), s = vec(n.size, `${n.nodeId}.size`, 1);
    const material=Object.hasOwn(spec.palette,n.material)?spec.palette[n.material]:Object.hasOwn(MATERIALS,n.material)?n.material:undefined;
    let value = n.op === 'clear' ? 1 : n.op === 'keep' ? 0 : lookup.get(n.material)??(material?paletteId(MATERIALS[material]):undefined);
    if (value === undefined) throw new Error(`Unknown palette role: ${n.material}`);
    if(value>=2){let state=resolveState(material,n.blockState);if(doorComponent&&!/_door\[/.test(state))throw new Error('door component requires a door material');if(group)state=transformState(state,group.rotation,group.mirror);value=paletteId(state);}
    const thickness = n.thickness === undefined ? 1 : integer(n.thickness, 1, 64, 'thickness');
    const axis = n.axis ?? 'x';
    if (!['x', 'z'].includes(axis)) throw new Error('axis must be x or z');
    let count = 1, step = [0, 0, 0];
    if (n.repeat) {
      keys(n.repeat, ['count', 'step'], 'repeat');
      count = integer(n.repeat.count, 1, 256, 'repeat.count'); step = vec(n.repeat.step, 'repeat.step', -LIMITS.height);
    }
    visits += s[0] * s[1] * s[2] * count;
    if (visits > LIMITS.visits) throw new Error('Expansion work quota exceeded');
    if (n.op === 'polygonExtrude') {
      if (!Array.isArray(n.points) || n.points.length < 3 || n.points.length > 64) throw new Error('polygon requires 3..64 points');
      for (const p of n.points) if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger) || p[0] < 0 || p[0] > s[0] || p[1] < 0 || p[1] > s[2]) throw new Error('Invalid polygon point');
    }
    for (let r = 0; r < count; r++) {
      const start = o.map((v, i) => v + step[i] * r);
      if (start.some((v, i) => v < 0 || v + s[i] > (group?.size??[w,h,d])[i])) throw new Error(`Out of bounds: ${n.nodeId}`);
      for (let y = 0; y < s[1]; y++) for (let z = 0; z < s[2]; z++) for (let x = 0; x < s[0]; x++) {
        let selected = true, cellValue = value;
        if (n.op === 'shell') {
          const edge = x < thickness || x >= s[0] - thickness || y < thickness || y >= s[1] - thickness || z < thickness || z >= s[2] - thickness;
          // Hollow shells explicitly excavate their interior, not keep existing terrain.
          if (!edge) cellValue = 1;
        } else if (n.op === 'cylinder') {
          selected = ((x + 0.5 - s[0] / 2) / (s[0] / 2)) ** 2 + ((z + 0.5 - s[2] / 2) / (s[2] / 2)) ** 2 <= 1;
        } else if (n.op === 'stair') {
          const run = axis === 'x' ? x : z, len = axis === 'x' ? s[0] : s[2];
          selected = y < Math.ceil((run + 1) * s[1] / len);
        } else if (n.op === 'arch') {
          const u = axis === 'x' ? x : z, len = axis === 'x' ? s[0] : s[2];
          const curve = s[1] - 1 - Math.floor(((u + 0.5 - len / 2) / (len / 2)) ** 2 * Math.min(s[1] - 1, len / 3));
          selected = u < thickness || u >= len - thickness || (y <= curve && y > curve - thickness);
        } else if (n.op === 'polygonExtrude') selected = insidePolygon(x + 0.5, z + 0.5, n.points);
        if (selected) {
          let point=[start[0]+x,start[1]+y,start[2]+z];if(group)point=transformPoint(point,group.size,group.rotation,group.mirror).map((v,i)=>v+group.origin[i]);
          const i=point[0]+point[2]*w+point[1]*w*d;
          if(onWrite)onWrite({index:i,point,nodeId:n.nodeId,value:cellValue,previous:cells[i],previousNodeId:traceIds[owners[i]]});
          cells[i]=cellValue;
          if(owners)owners[i]=traceId;
          if(floorCells && cellValue>=2 && (n.material==='floor'||n.op==='shell'&&y<thickness||floorNodeIds?.has(n.nodeId)))floorCells[i]=1;
        }
      }
    }
  }
  let setCount = 0, clearCount = 0;
  for (const c of cells) { if (c >= 2) setCount++; else if (c === 1) clearCount++; }
  if (!setCount || setCount > LIMITS.occupied) throw new Error(`Occupied count outside 1..${LIMITS.occupied}: ${setCount}`);
  qualityIssues.push(...validateDoorPairs(cells,palette,spec.bounds,{requireSupport:navigationPolicy==='strict'}));
  const specialIds=new Set(palette.map((s,i)=>i>=2&&isPartial(s)?i:-1));
  if(cells.some(v=>specialIds.has(v)))qualityIssues.push({code:'partial-block-collision',message:'包含门、活板门、楼梯或半砖：方块状态已校验，但动态开合和半格碰撞未做完整通行认证，请检查预览；不会自动更改形状。'});
  const passages = spec.constraints.passages ?? [];
  if (!Array.isArray(passages) || passages.length > 256) throw new Error('Invalid passages');
  // Malformed/out-of-bounds declarations remain hard errors, not quality warnings.
  for(const p of passages){keys(p,['origin','size'],'passage');const o=vec(p.origin,'passage.origin'),s=vec(p.size,'passage.size',1);if(o.some((v,i)=>v+s[i]>[w,h,d][i]))throw new Error('Passage declaration is outside bounds');}
  let navigation;
  try {
  if (spec.constraints.walkable && !passages.length) throw new NavigationQualityError('Walkable requires explicit passage checks');
  for (const [passageIndex,passage] of passages.entries()) {
    keys(passage, ['origin', 'size'], 'passage');
    const o = vec(passage.origin, 'passage.origin'), s = vec(passage.size, 'passage.size', 1);
    if (s[1] < 2 || o[1] < 1) throw new NavigationQualityError(`Passage needs valid bounds, floor and two-block headroom: passage[${passageIndex}] origin=[${o}] size=[${s}]; feet Y must be floor Y+1, clearance height >=2`);
    for (let x = o[0]; x < o[0] + s[0]; x++) for (let z = o[2]; z < o[2] + s[2]; z++) {
      const floor = cells[x + z * w + (o[1] - 1) * w * d];
      if (floor < 2 || !fullSupport(palette[floor])) throw new NavigationQualityError(`Passage missing floor: passage[${passageIndex}] at [${x},${o[1]-1},${z}]`);
      for (let y = o[1]; y < o[1] + s[1]; y++) if (cells[x + z * w + y * w * d] !== 1) throw new NavigationQualityError(`Passage obstructed or not explicitly cleared: passage[${passageIndex}] at [${x},${y},${z}] = ${palette[cells[x+z*w+y*w*d]]}`);
    }
  }
  if(spec.constraints.walkable)navigation=inspectNavigation({cells,palette,width:w,height:h,length:d,passages,floorCells,requireConnected:spec.constraints.interior});
  } catch(error) {
    if(!(error instanceof NavigationQualityError))throw error;
    let corrected;
    if(normalizeGeneratedPassages&&spec.constraints.walkable&&error.message.startsWith('Passage'))try{corrected=normalizePassages(spec,cells,palette);}catch{}
    if(corrected){
      const compiled=compileSpec(corrected,{navigationPolicy,traceNodes,onWrite,floorNodeIds});
      if(!compiled.cells.every((cell,i)=>cell===cells[i]))throw new Error('Passage normalization changed geometry');
      const {assetHash,...metadata}=compiled.manifest;
      metadata.validationNotes=[...(metadata.validationNotes??[]),'已按实际可站立区域校正 AI 的通道声明；仅修正站立高度/净空及避开家具，建筑方块与保留/挖空掩码未改动。'];
      return {...compiled,spec:corrected,manifest:{...metadata,assetHash:hash(metadata)}};
    }
    if(navigationPolicy!=='review')throw error;
    qualityIssues.push(navigationIssue(error));
  }
  const binary = Buffer.alloc(cells.length * 2);
  for (let i = 0; i < cells.length; i++) binary.writeUInt16LE(cells[i], i * 2);
  const metadata = { schemaVersion: 1, compiler: '2.0.0', materialVersion: MATERIAL_VERSION, minecraft: '1.20.1', dataVersion: 3465, id: spec.id, dimensions: { ...spec.bounds }, palette, setCount, clearCount, specHash: hash(spec), cellsHash: hash(binary) };
  if(spec.design)metadata.design=structuredClone(spec.design);
  if(navigation){metadata.navigation=navigation;if(navigation.warnings.length)metadata.validationNotes=navigation.warnings;}
  const status=qualityIssues.length?'unverified':spec.constraints.walkable?'verified':'not-requested';
  metadata.quality={version:1,navigation:status,requiresAcknowledgement:status!=='verified',issues:qualityIssues,geometryChanged:false};
  metadata.validationNotes=[...(metadata.validationNotes??[]),...compatibilityNotes,...(status==='verified'?[]:[UNVERIFIED_NOTE,...qualityIssues.map(e=>e.message)])];
  return { manifest: { ...metadata, assetHash: hash(metadata) }, cells, binary, spec,...(traceNodes?{trace:{nodeIds:traceIds,owners}}:{}) };
}

function insidePolygon(x, z, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function patchSpec(spec, patch, options={}) {
  keys(patch, ['baseHash', 'replaceNodes', 'removeNodes', 'palette'], 'patch');
  if (patch.baseHash !== hash(spec)) throw new Error('Stale base revision');
  const next = structuredClone(spec), replace = new Map((patch.replaceNodes ?? []).map(n => [n.nodeId, n]));
  if (replace.size !== (patch.replaceNodes ?? []).length) throw new Error('Duplicate patch nodes');
  const remove = new Set(patch.removeNodes ?? []);
  for (const id of remove) if (!next.nodes.some(n => n.nodeId === id) || replace.has(id)) throw new Error(`Invalid remove: ${id}`);
  next.nodes = next.nodes.filter(n => !remove.has(n.nodeId)).map(n => { const v = replace.get(n.nodeId) ?? n; replace.delete(n.nodeId); return v; });
  next.nodes.push(...replace.values());
  if (patch.palette) Object.assign(next.palette, patch.palette);
  compileSpec(next,options);
  return next;
}
