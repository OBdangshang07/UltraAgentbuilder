import {rectangularFacadeLayout,rectangularFacadePanels,rectangularPanelProblems} from './facade-validation.mjs';

/** A data-only placement layer, not a building template or repair heuristic.
 * A rule owns one stable component ID. All bands keep that ID and permissions.
 * Explicit counts never shrink; fit is a designer-selected distribution mode.
 */
export function expandStoreyFacade(c,host,r,bounds){
  const fail=(rule,message,facts={})=>{
    const feedback={component:c.id,host:c.host,code:'storey-layout',rule,message,...facts,canAuthorizePlacement:false};
    throw Object.assign(new Error(`${c.id}: ${message}`),{layoutFeedback:feedback});
  };
  if(host?.kind!=='mass'||host.repeat.count!==1)fail('host','storeyFacade requires one rectangular mass; split setbacks into explicitly designed hosts');
  if(c.insets[0]<1)fail('insets','bottom inset must be at least one block above the host floor');
  const span=r.size[c.face==='north'||c.face==='south'?0:2],available=span-2*c.margin;
  const {width,gap,align}=c.columns,step=width+gap;
  const count=c.columns.count==='fit'?Math.floor((available+gap)/step):c.columns.count;
  const used=count*width+(count-1)*gap,slack=available-used;
  if(count<1||count>64||slack<0)fail('columns','column rule cannot fit within margins and the 64-column limit; nothing was clipped',{span,margin:c.margin,available,count,used});
  const start=c.margin+(align==='center'?Math.floor(slack/2):align==='end'?slack:0);
  const levels=[...new Set([0,...host.levels])].sort((a,b)=>a-b);
  if(c.floors.first+c.floors.count>levels.length)fail('floors','floor selection exceeds actual host slabs',{availableFloors:levels.length,selection:c.floors});
  if(c.exclude.some(([col,row])=>col>=count||row>=c.floors.count))fail('exclude','excluded bay is outside the derived column/floor selection',{count,rows:c.floors.count});
  const rows=[];
  for(let row=0;row<c.floors.count;row++){
    const floorIndex=c.floors.first+row,base=levels[floorIndex],ceiling=levels[floorIndex+1]??r.size[1]-1;
    const y=base+c.insets[0],end=ceiling-c.insets[1],height=end-y;
    if(height<1||height>64||base<0||ceiling>r.size[1]-1||y<1||end>r.size[1]-1)
      fail('insets','storey insets leave an invalid panel; redesign this exceptional floor explicitly',{row,floorIndex,base,ceiling,y,endExclusive:end,height});
    rows.push({row,floorIndex,base,ceiling,y,height});
  }
  // Compact only equal-height, equally spaced consecutive rows. Transfer/top
  // floors remain separate bands; exclusions retain original selected-row IDs.
  const bands=[];
  for(let first=0;first<rows.length;){
    let last=first,dy=0;
    if(first+1<rows.length&&rows[first+1].height===rows[first].height){
      dy=rows[first+1].y-rows[first].y;last++;
      while(last+1<rows.length&&rows[last+1].height===rows[first].height&&rows[last+1].y-rows[last].y===dy)last++;
    }
    const panel={id:c.id,kind:'panelFacade',host:c.host,face:c.face,allowOverwrite:[...c.allowOverwrite],margin:c.margin,
      start:[start,rows[first].y],count:[count,last-first+1],step:[step,dy],size:[width,rows[first].height],
      borders:[...c.borders],recess:c.recess,frame:c.frame,glazing:c.glazing,lattice:c.lattice,projection:c.projection,sill:c.sill,shade:c.shade,
      exclude:c.exclude.filter(([,row])=>row>=first&&row<=last).map(([col,row])=>[col,row-first])};
    bands.push({panel,rowOffset:first});first=last+1;
  }
  const evidence={component:c.id,host:c.host,rule:'storeyFacade',columns:{count,start,step,width,endExclusive:start+used,span,margin:c.margin},rows,
    rowBands:bands.map(b=>({firstRow:b.rowOffset,lastRow:b.rowOffset+b.panel.count[1]-1,startY:b.panel.start[1],stepY:b.panel.step[1],height:b.panel.size[1]})),
    representatives:[],representativeChecks:0,expandedPanelChecks:0,checksComplete:false,canAuthorizePlacement:false,
    limitations:['Placement arithmetic only; ownership, complete scene geometry and navigation still require the unchanged compiler.']};
  const layouts=bands.map(b=>{
    try{return rectangularFacadeLayout(b.panel,host,r);}catch(error){fail('panel',error.message,{rowOffset:b.rowOffset});}
  });
  const check=(band,layout,panel)=>{
    const problem=rectangularPanelProblems(band.panel,host,r,bounds,layout,panel).find(p=>p.severity!=='review');
    if(problem)fail('panel',problem.message,{row:panel.row+band.rowOffset,column:panel.column,problem});
  };
  // Validate each band at its first/last emitted row, and each distinct
  // exclusion pattern's edge columns before the complete expansion pass.
  for(const [i,band] of bands.entries()){
    const layout=layouts[i],byPattern=new Map(),rowsWithPanels=[];
    for(let row=0;row<band.panel.count[1];row++){
      const columns=Array.from({length:count},(_,col)=>col).filter(col=>!layout.excludes.has(`${col},${row}`));
      if(!columns.length)continue;
      rowsWithPanels.push({row,columns});const key=columns.join(',');
      if(!byPattern.has(key))byPattern.set(key,{row,columns});
    }
    const selected=new Map([...byPattern.values(),...rowsWithPanels.slice(0,1),...rowsWithPanels.slice(-1)].map(v=>[v.row,v]));
    for(const {row,columns} of selected.values())for(const col of new Set([columns[0],columns.at(-1)])){
      const panel={column:col,row,u:band.panel.start[0]+col*step,y:band.panel.start[1]+row*band.panel.step[1]};
      check(band,layout,panel);evidence.representativeChecks++;
      evidence.representatives.push({column:col,row:row+band.rowOffset,floorIndex:rows[row+band.rowOffset].floorIndex});
    }
  }
  // A representative pass is never substituted for a full-scene pass.
  for(const [i,band] of bands.entries())for(const panel of rectangularFacadePanels(band.panel,layouts[i])){check(band,layouts[i],panel);evidence.expandedPanelChecks++;}
  if(!evidence.expandedPanelChecks)fail('exclude','all panels are excluded; no facade geometry was specified');
  evidence.checksComplete=true;
  return {bands,evidence};
}
