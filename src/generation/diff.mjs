export function compareCompiled(before,after){
  const a=before.manifest.dimensions,b=after.manifest.dimensions;
  if(a.width!==b.width||a.height!==b.height||a.length!==b.length)return {sameBounds:false,requiresFullReview:true,reason:'Building dimensions changed'};
  let added=0,removed=0,replaced=0,maskChanged=0;const chunks=new Map();
  for(let i=0;i<before.cells.length;i++){
    const old=before.cells[i],next=after.cells[i],oldState=before.manifest.palette[old],nextState=after.manifest.palette[next];if(oldState===nextState)continue;
    if(old>=2&&next>=2)replaced++;else if(next>=2)added++;else if(old>=2)removed++;else maskChanged++;
    const x=i%a.width,y=Math.floor(i/(a.width*a.length)),z=Math.floor(i/a.width)%a.length,key=`${x>>4},${y>>4},${z>>4}`;chunks.set(key,(chunks.get(key)??0)+1);
  }
  return {sameBounds:true,added,removed,replaced,maskChanged,changed:added+removed+replaced+maskChanged,chunks:[...chunks].map(([key,count])=>({key,count})),beforeHash:before.manifest.assetHash,afterHash:after.manifest.assetHash};
}
