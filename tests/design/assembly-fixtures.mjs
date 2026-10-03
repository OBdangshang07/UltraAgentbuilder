import {basicScene,mass,shape,worldHighrise} from './fixtures.mjs';
import {hash} from '../../src/generation/compiler.mjs';
export function assemblyPlan(tall=false){
 const scene=tall?worldHighrise():basicScene('assembly-study');
 if(!tall){scene.bounds={width:16,height:10,length:16};scene.components=[mass('main',[2,0,2],[12,10,12],[])];scene.constraints.passages=[{origin:[4,1,4],size:[1,2,1]}];}
 const packages=[{id:'exterior',name:'Exterior study',purpose:'Bounded facade accent engineering fixture',dependsOn:[],regions:[{origin:[0,0,0],size:[2,3,2]}],editableComponents:[],interfaces:[]},
  {id:'interior',name:'Interior study',purpose:'Bounded interior detail engineering fixture',dependsOn:['exterior'],regions:[{origin:tall?[20,1,20]:[8,1,8],size:[3,2,3]}],editableComponents:[],interfaces:[0]}];
 return {format:'SceneAssemblyPlan',version:1,designIntent:'Test fixture only, no model quality evidence',scene,packages};
}
export function packageEdit(input){
 const source=input.previousDraft,task=input.task,exterior=task.id==='exterior',id=task.id+'__detail',old=source.components.find(c=>c.id===id);
 const part=shape(id,task.regions[0].origin,exterior?[1,2,1]:[2,1,1],old?.material==='frame'?'wall':'frame');
 return {format:'SceneDraftEdit',version:1,sourceHash:hash(source),components:{put:[part],remove:[]},modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null};
}
export function acceptReview(input){return {format:'SceneAssemblyReview',version:1,sourceHash:input.sourceHash,verdict:'accept',task:null,summary:'Offline text review fixture, no visual validation',issues:[]};}
// Offline adapters explicitly speak the candidate-patch protocol when offered.
export function packageResponse(input,edit){
 if(!input.repairBase)return edit;
 return {format:'ScenePackageRepair',version:1,sourceHash:input.sourceHash,candidateHash:input.repairBase.candidateHash,
   edit:{...edit,sourceHash:input.repairBase.candidateHash}};
}
// Test/engineering-only converter, never a provider response or automatic repair.
export function planEdit(source,target){
 const delta=(a,b,key)=>({put:b.filter(v=>!a.some(p=>p[key]===v[key]&&hash(p)===hash(v))),remove:a.filter(p=>!b.some(v=>v[key]===p[key])).map(v=>v[key])});
 const sceneEdit={format:'SceneDraftEdit',version:1,sourceHash:hash(source.scene)};
 for(const field of ['components','modules','palette','reservations'])sceneEdit[field]=delta(source.scene[field],target.scene[field],field==='palette'?'role':'id');
 for(const field of ['design','featureBindings','constraints'])sceneEdit[field]=hash(source.scene[field])===hash(target.scene[field])?null:target.scene[field];
 return {format:'SceneAssemblyPlanEdit',version:1,planHash:hash(source),sceneEdit,packages:delta(source.packages,target.packages,'id')};
}
