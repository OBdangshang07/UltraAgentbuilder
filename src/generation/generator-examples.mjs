// Trusted, strictly compiled teaching examples. Not a fixed template for generated designs.
const palette={wall:'quartz',floor:'spruce',roof:'blue',glass:'glass',lamp:'sea_lantern',beam:'dark_oak'};
const node=(nodeId,op,origin,size,material='wall',count=1,step=[0,0,0])=>({nodeId,op,origin,size,material,thickness:1,axis:'x',repeat:{count,step},points:[]});
export function generatorExamples(){return [
  {schemaVersion:1,id:'example-open-entry',seed:1,units:'block',bounds:{width:9,height:6,length:9},palette:{...palette},
    nodes:[node('room','room',[0,0,0],[9,6,9]),node('door-clear','clear',[4,1,0],[1,2,1])],
    constraints:{interior:true,walkable:true,passages:[{origin:[4,1,0],size:[1,2,1]}]}},
  {schemaVersion:1,id:'example-connected-floors',seed:2,units:'block',bounds:{width:13,height:16,length:12},palette:{...palette},
    nodes:[node('outer','shell',[0,0,0],[13,16,12]),node('floors','box',[1,4,1],[11,1,10],'floor',3,[0,4,0]),
      node('slab-openings','clear',[2,4,3],[4,1,2],'wall',3,[0,4,0]),
      ...Array.from({length:4},(_,i)=>node('tread-'+i,'box',[2+i,1+i,3],[1,1,2],'floor',3,[0,4,0])),
      node('entry','clear',[1,1,0],[1,2,1])],
    constraints:{interior:true,walkable:true,passages:[{origin:[1,1,0],size:[1,2,1]},{origin:[6,13,3],size:[1,2,1]}]}}
];}
