import {parseState,validateState,isDoor,fullSupport} from './block-states.mjs';

// Minecraft Java 1.20.1 DoorBlock collision, independently checked by the
// native Java oracle. A standing 0.6-wide centred player clears a 3/16 edge
// slab, but cannot cross that edge. Closed/unknown doors are NOT air.
export function staticOpenDoorCollision(state){
 try{
  if(!isDoor(state))return null;validateState(state);
  const parsed=parseState(state),p=parsed.properties;if(p.open!=='true')return null;
  const face={east:{left:1,right:4},south:{left:2,right:8},west:{left:4,right:1},north:{left:8,right:2}}[p.facing]?.[p.hinge];
  if(!face)return null;
  const box={1:[0,0,0,1,1,3/16],2:[13/16,0,0,1,1,1],4:[0,0,13/16,1,1,1],8:[0,0,0,3/16,1,1]}[face];
  return {...parsed,face,box};
 }catch{return null;}
}

export function staticOpenDoorCells(cells,palette,w,h,d){
 const states=palette.map(staticOpenDoorCollision),faces=new Uint8Array(cells.length),plane=w*d;let pairedCells=0;
 if(states.some(Boolean))for(let i=0;i<cells.length;i++){
  const a=states[cells[i]];if(!a)continue;
  const lower=a.properties.half==='lower',y=Math.floor(i/plane),other=i+(lower?plane:-plane),floor=i-(lower?plane:2*plane);
  if(y<(lower?1:2)||other<0||other>=cells.length||cells[floor]<2||!fullSupport(palette[cells[floor]]))continue;
  const b=states[cells[other]];
  if(!b||b.id!==a.id||b.properties.half!==(lower?'upper':'lower')||['facing','hinge','open','powered'].some(k=>a.properties[k]!==b.properties[k]))continue;
  faces[i]=a.face;pairedCells++;
 }
 return {faces,pairedCells};
}
