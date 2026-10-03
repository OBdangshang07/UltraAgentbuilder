import {validateRoomZone} from './room-zone.mjs';

export const isFloorComponent=c=>['storeyRoom','storeyOpening'].includes(c.kind);
export const componentReferences=c=>[...new Set([c.at?.relativeTo,c.host,isFloorComponent(c)?c.floors.source:null].filter(Boolean))];
const floors=(host,r)=>[...new Set([0,...host.levels])].sort((a,b)=>a-b).map(y=>y+r.origin[1]);

/** Resolve declared floor relationships, never infer a layout, move a core or
 * grant overwrite authority. Callers validate the bounded SceneSpec first. */
export function expandFloorComponent(c,host,hr,floorHost,fr,bounds){
  const fail=(rule,message,facts={})=>{throw Object.assign(new Error(`${c.id}: ${message}`),{layoutFeedback:{code:'floor-layout',component:c.id,host:c.host,floorSource:c.floors.source,rule,message,...facts,canAuthorizePlacement:false}});};
  for(const [name,h] of [['host',host],['floorSource',floorHost]])if(!h||!['mass','profileMass'].includes(h.kind)||h.repeat.count!==1)fail(name,'floor relationship requires single mass/profileMass hosts');
  if(c.kind==='storeyOpening'&&host.kind!=='mass')fail('host','storeyOpening requires a rectangular wall; polygon openings remain explicitly designed voids');
  const sourceFloors=floors(floorHost,fr),hostFloors=floors(host,hr);
  if(c.floors.first+c.floors.count>sourceFloors.length)fail('floors','selection exceeds actual source floors',{availableFloors:sourceFloors.length,selection:c.floors});
  const rows=[];
  for(let row=0;row<c.floors.count;row++){
    const floorIndex=c.floors.first+row,base=sourceFloors[floorIndex],hostIndex=hostFloors.indexOf(base);
    const ceiling=sourceFloors[floorIndex+1]??fr.origin[1]+fr.size[1]-(floorHost.roof?1:0);
    const hostCeiling=hostFloors[hostIndex+1]??hr.origin[1]+hr.size[1]-(host.roof?1:0);
    if(hostIndex<0||ceiling!==hostCeiling)fail('floor-interface','source and receiving host floor/ceiling do not align; no floor was moved or skipped',{row,floorIndex,base,ceiling,hostIndex,hostCeiling});
    let origin,size;
    if(c.kind==='storeyRoom'){
      origin=[hr.origin[0]+c.offset[0],base,hr.origin[2]+c.offset[1]];
      size=[c.footprint[0],ceiling-base-c.ceilingInset,c.footprint[1]];
      if(size[1]<3)fail('ceilingInset','room needs its floor plus two air cells',{row,base,ceiling,height:size[1]});
    }else{
      const along=c.face==='north'||c.face==='south'?0:2,normal=along===0?2:0;
      if(c.u<1||c.u+c.width>=hr.size[along])fail('opening','opening must retain side margins',{row,u:c.u,width:c.width,span:hr.size[along]});
      if(base+1+c.height>ceiling)fail('opening','opening crosses the next floor/roof',{row,base,height:c.height,ceiling});
      if(c.door!==null&&(c.width>2||c.height!==2))fail('door','a real door is width1/2, height2; larger portals require door=null');
      origin=[...hr.origin];origin[along]+=c.u;origin[1]=base+1;
      if(c.face==='south'||c.face==='east')origin[normal]+=hr.size[normal]-host.thickness;
      size=[1,c.height,1];size[along]=c.width;size[normal]=host.thickness;
    }
    if(origin.some((v,a)=>!Number.isSafeInteger(v)||v<0||!Number.isSafeInteger(size[a])||size[a]<1||v+size[a]>bounds[a]))fail('bounds','derived instance is outside world bounds',{row,origin,size,bounds});
    rows.push({row,floorIndex,base,ceiling,height:size[1],origin,size});
  }
  const bands=[];
  for(let first=0;first<rows.length;){
    let last=first,dy=0;
    if(first+1<rows.length&&rows[first+1].height===rows[first].height){dy=rows[first+1].base-rows[first].base;last++;
      while(last+1<rows.length&&rows[last+1].height===rows[first].height&&rows[last+1].base-rows[last].base===dy)last++;
    }
    const r=rows[first],repeat={count:last-first+1,step:[0,dy,0]},at={relativeTo:c.host,anchor:'min',offset:r.origin.map((v,a)=>v-hr.origin[a])};
    const component=c.kind==='storeyRoom'?{id:c.id,kind:'roomZone',host:c.host,allowOverwrite:[...c.allowOverwrite],at,repeat,size:r.size,use:c.use,purpose:c.purpose,floorMaterial:c.floorMaterial,boundaries:structuredClone(c.boundaries)}:
      {...c,at,repeat,size:r.size,hostThickness:host.thickness};
    bands.push({component,resolved:{origin:r.origin,size:r.size},rowOffset:first});first=last+1;
  }
  const checkRow=index=>{
    const r=rows[index];if(c.kind!=='storeyRoom')return;
    const band=bands.find(b=>index>=b.rowOffset&&index<b.rowOffset+b.component.repeat.count);
    try{validateRoomZone({...band.component,repeat:{count:1,step:[0,0,0]}},host,hr,r.origin);}
    catch(error){fail('room-interface',error.message,{row:index,floorIndex:r.floorIndex,origin:r.origin,size:r.size,...(error.roomZoneFeedback?{roomZoneFeedback:error.roomZoneFeedback}:{})});}
  };
  const representativeRows=[...new Set(bands.flatMap(b=>[b.rowOffset,b.rowOffset+b.component.repeat.count-1]))];
  for(const row of representativeRows)checkRow(row);
  for(let row=0;row<rows.length;row++)checkRow(row);
  const evidence={component:c.id,host:c.host,floorSource:c.floors.source,rule:c.kind,rows,
    rowBands:bands.map(b=>({firstRow:b.rowOffset,lastRow:b.rowOffset+b.component.repeat.count-1,startY:b.resolved.origin[1],stepY:b.component.repeat.step[1],height:b.resolved.size[1]})),
    representatives:representativeRows.map(row=>({row,floorIndex:rows[row].floorIndex})),representativeChecks:representativeRows.length,expandedInstanceChecks:rows.length,
    checksComplete:true,canAuthorizePlacement:false,limitations:['Floor alignment and bounded placement only; full ownership, circulation and geometry checks still apply.']};
  return {bands,evidence};
}
