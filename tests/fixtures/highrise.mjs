import {sampleSpec} from '../../src/generation/sample.mjs';
// Deterministic engineering fixture, NOT evidence of live model architectural quality.
export function highriseParts(){
  const base=sampleSpec();base.id='highrise-224-fixture';base.bounds={width:34,height:224,length:34};
  const node=(nodeId,op,origin,size,material='wall',count=1,step=[0,0,0])=>({nodeId,op,origin,size,material,thickness:1,axis:'x',repeat:{count,step},points:[]});
  const envelope={...base,nodes:[node('envelope','shell',[0,0,0],[32,224,32]),node('front-glass','windowRow',[2,2,0],[28,5,1],'glass',28,[0,8,0]),node('back-glass','windowRow',[2,2,31],[28,5,1],'glass',28,[0,8,0])],constraints:{interior:false,walkable:false,passages:[]}};
  const nodes=[node('floor-stack','box',[1,8,1],[30,1,30],'floor',27,[0,8,0]),node('stair-holes','clear',[23,8,5],[6,1,6],'wall',27,[0,8,0]),node('landings','box',[27,4,5],[2,1,5],'floor',27,[0,8,0])];
  for(let i=0;i<4;i++){
    nodes.push(node('up-flight-'+i,'box',[23+i,1+i,5],[1,1,2],'beam',27,[0,8,0]));
    nodes.push(node('return-flight-'+i,'box',[26-i,5+i,8],[1,1,2],'beam',27,[0,8,0]));
  }
  for(let i=0;i<3;i++)nodes.push(node('desks-'+i,'box',[4+i*5,1,10],[3,1,2],'beam',28,[0,8,0]));
  nodes.push(node('lights','lampRow',[8,6,8],[2,1,2],'lamp',28,[0,8,0]),node('entry-door','clear',[14,1,0],[3,3,1]));
  const interior={...base,nodes,constraints:{interior:true,walkable:true,passages:[{origin:[15,1,1],size:[1,2,1]},{origin:[22,217,8],size:[1,2,1]}]}};
  return {envelope,interior:structuredClone(interior)};
}
