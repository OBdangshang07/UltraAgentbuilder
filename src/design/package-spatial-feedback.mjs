import {hash} from '../generation/compiler.mjs';

const LIMITS={groups:4,radiusX:6,radiusZ:3,layers:4,sampledCells:4096};
const inside=(p,b)=>p.every((v,a)=>v>=b.origin[a]&&v<b.origin[a]+b.size[a]);
const rle=row=>{const out=[];for(const id of row){const last=out.at(-1);if(last?.[0]===id)last[1]++;else out.push([id,1]);}return out;};

/** Read-only, bounded spatial witnesses, not repair proposals or permission.
 * Both snapshots retain every component. Candidate final cells can conceal an
 * earlier conflicting write, so show the accepted snapshot separately too. */
export function packageSpatialFeedback(base,candidate,task,feedback){
  if(!base.manifest.diagnosticOnly||!candidate.manifest.diagnosticOnly||candidate.designSources.sourceHash!==feedback.sourceHash||
    hash(base.manifest.dimensions)!==hash(candidate.manifest.dimensions))throw new Error('Spatial feedback identity mismatch');
  const conflicts=(feedback.diagnostics??[]).filter(d=>d.severity==='blocked'&&Array.isArray(d.point));
  for(const d of feedback.packageScopeFeedback?.groups??[])if(d.samples?.length)conflicts.push({code:d.code,from:d.after,to:d.before,point:d.samples[0]});
  if(!conflicts.length)return null;
  const {width:w,height:h,length:d}=candidate.manifest.dimensions;
  const legend=[],legendIds=new Map();let sampledCells=0;
  const code=(snapshot,p)=>{
    const index=p[0]+p[2]*w+p[1]*w*d,value=snapshot.cells[index],owner=snapshot.designSources.traceSources[snapshot.sourceOwners[index]];
    const item={mask:value===0?'keep':value===1?'clear':'set',owner:owner?.component??null,kind:owner?.kind??null,
      ...(value>=2?{state:snapshot.manifest.palette[value]}:{})};
    const key=JSON.stringify(item);if(!legendIds.has(key)){legendIds.set(key,legend.length);legend.push(item);}return legendIds.get(key);
  };
  const groups=[];
  for(const conflict of conflicts.slice(0,LIMITS.groups)){
    const p=conflict.point;if(!p.every((v,a)=>Number.isSafeInteger(v)&&v>=0&&v<[w,h,d][a]))continue;
    const all=candidate.designSources.componentBounds[conflict.from]??[],hit=all.find(b=>inside(p,b));
    const selected=[...new Set([all[0],all.at(-1),hit].filter(Boolean))];
    const elevations=[...new Set([p[1],Math.min(h-1,p[1]+1),hit?.origin[1],hit?hit.origin[1]+hit.size[1]-1:undefined].filter(Number.isSafeInteger))].slice(0,LIMITS.layers);
    const minX=Math.max(0,p[0]-LIMITS.radiusX),maxX=Math.min(w-1,p[0]+LIMITS.radiusX),minZ=Math.max(0,p[2]-LIMITS.radiusZ),maxZ=Math.min(d-1,p[2]+LIMITS.radiusZ);
    const layers=[];
    for(const y of elevations){
      const count=(maxX-minX+1)*(maxZ-minZ+1)*2;if(sampledCells+count>LIMITS.sampledCells)break;
      const layer={y,accepted:[],candidate:[]};
      for(let z=minZ;z<=maxZ;z++)for(const [key,snapshot] of [['accepted',base],['candidate',candidate]]){
        const row=[];for(let x=minX;x<=maxX;x++)row.push(code(snapshot,[x,y,z]));layer[key].push(rle(row));
      }
      sampledCells+=count;layers.push(layer);
    }
    groups.push({code:conflict.code,producer:conflict.from,receiver:conflict.to,point:p,
      producerInstanceCount:all.length,producerBoundsSamples:selected,producerBoundsTruncated:selected.length<all.length,
      x:[minX,maxX],z:[minZ,maxZ],layers});
  }
  return {version:1,acceptedSourceHash:base.designSources.sourceHash,candidateSourceHash:feedback.sourceHash,
    acceptedAssetHash:base.manifest.assetHash,candidateAssetHash:candidate.manifest.assetHash,
    task:task.id,canAuthorizePlacement:false,geometryChanged:false,checksComplete:false,
    encoding:'WORLD XYZ. x/z endpoints inclusive. Each layer has rows in increasing Z; each row is [legendIndex,runLength] pairs in increasing X. accepted and candidate are separate final-state snapshots, NOT before/after a proposed repair.',
    limits:LIMITS,sampledCells,totalConflictGroups:conflicts.length,groupsTruncated:groups.length<conflicts.length,legend,groups,
    limitations:['Only selected nearby cells/elevations/instances are shown; unseen cells are unknown, not free.',
      'KEEP is unspecified world intent, not verified empty air. CLEAR can be a protected void/circulation reservation; the owner and original rules still apply.',
      'A candidate producer may hide an earlier receiver. Moving it does not necessarily leave air; inspect the accepted snapshot and source too.',
      'These are whole-cell material/ownership witnesses, not partial-block collision shapes, navigation, structural support or design certification.',
      'No candidate position is recommended or approved. Check every repeated instance, the full occupied volume and package regions; strict compilation and scope checks remain authoritative.']};
}
