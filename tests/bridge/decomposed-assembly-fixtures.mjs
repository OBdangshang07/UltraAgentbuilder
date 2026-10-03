import {PROTOTYPE_ROLES} from '../../contracts/scene-decomposition-roles.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {worldHighrise,shape} from '../design/fixtures.mjs';
import {v4Request,setupV4,v4Response} from './quality-v4-fixtures.mjs';

// SYNTHETIC model answers and image transport fixtures. Real compiler/cells,
// not complete designed prototype studies or AI/native aesthetic evidence.
export const stagedRequest={...v4Request,prompt:'32×224×32格边界内的224米办公塔楼，离线完整流程测试',assemblyPrototypes:'staged'};
const kinds=[['typical-floor','core-interface'],['facade-row','corner'],['entry-lobby','street-interface'],['special-floor','crown']];
export function stagedResponse(input,options){
 const format=options.outputSchema.properties.format.enum[0];
 if(format==='SceneConceptSet'){
  const scene=worldHighrise();scene.components=scene.components.filter(c=>c.kind==='mass');scene.components[0].levels=[];
  scene.components[0].size[0]-=2*(input.slot-1);scene.constraints={interior:false,walkable:false,passages:[]};
  return {format,version:1,candidates:[{id:input.candidateId,rationale:'Offline distinct geometry fixture, not quality evidence',scene}]};
 }
 if(format==='SceneAssemblyBlueprint'){
  const selected=input.selectedConcept.selected.scene,scene=worldHighrise();scene.components[0].size=structuredClone(selected.components[0].size);
  const packages=Array.from({length:input.callBudget.maximumPackages},(_,i)=>({id:'task'+i,name:'Protocol package '+i,purpose:'Offline scoped cell delta fixture, not architectural quality',dependsOn:i?['task'+(i-1)]:[],
   regions:[{origin:[12+(i%4)*2,0,20+Math.floor(i/4)*3],size:[2,224,2]}],editableComponents:[],interfaces:[0]}));
  return {format,version:1,sourceHash:input.sourceHash,designIntent:'Offline staged flow engineering evidence only',
   sceneEdit:planEdit({scene:selected,packages:[]},{scene,packages:[]}).sceneEdit,packages,prototypes:PROTOTYPE_ROLES.map((role,i)=>({role,task:'task'+i}))};
 }
 if(format==='ScenePrototypeRoleEdit'){
  const index=PROTOTYPE_ROLES.indexOf(input.role),task=input.task,x=task.regions[0].origin[0];
  const parts=[shape(task.id+'__a',[x,1,20],[1,1,1],'frame'),shape(task.id+'__b',[x,1,21],[1,1,1],'frame')];
  return {format,version:1,role:input.role,task:task.id,planHash:input.planHash,programHash:input.programHash,
   edit:{format:'SceneDraftEdit',version:1,sourceHash:input.sourceHash,components:{put:parts,remove:[]},modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null},
   recipes:index<2?[{component:parts[0].id,mode:'repeat',count:2,step:[0,5,0]}]:[],representatives:kinds[index].map((kind,i)=>({kind,components:[parts[i].id]}))};
 }
 if(format==='SceneDraftEdit'){
  const task=input.task,origin=task.regions[0].origin,id=task.id+'__detail',old=input.previousDraft.components.find(c=>c.id===id);
  return {format,version:1,sourceHash:input.sourceHash,components:{put:[shape(id,[origin[0]+1,1,origin[2]],[1,1,1],old?.material==='frame'?'wall':'frame')],remove:[]},
   modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null};
 }
 if(format==='ScenePackageRepair'){
  const edit=stagedResponse({...input,sourceHash:input.repairBase.candidateHash,previousDraft:input.repairBase.scene},
    {outputSchema:{properties:{format:{enum:['SceneDraftEdit']}}}});
  return {format,version:1,sourceHash:input.sourceHash,candidateHash:input.repairBase.candidateHash,edit};
 }
 if(format==='ScenePrototypePlanEdit'){
  const target=structuredClone(input.priorPlan),component=target.scene.components.find(c=>c.id==='task0__a');
  component.material=component.material==='frame'?'wall':'frame';
  return {format,version:1,programHash:input.prototypeProgramHash,edit:planEdit(input.priorPlan,target),recipes:structuredClone(input.prototypeRecipes)};
 }
 if(format==='SceneCoordinatedEdit'){
  const owned=input.previousDraft.components.find(c=>input.task.editableComponents.includes(c.id)&&c.id.endsWith('__detail'));
  const part={...structuredClone(owned),material:owned.material==='frame'?'wall':'frame'};
  return {format,version:1,sourceHash:input.sourceHash,scopeHash:input.coordinatedScope.scopeHash,components:{put:[part],remove:[]},
   modules:{put:[],remove:[]},palette:{put:[],remove:[]},reservations:{put:[],remove:[]},design:null,featureBindings:null,constraints:null};
 }
 return v4Response(input,options);
}
export async function setupStaged(change=null,payload=stagedRequest,{legacyV3=false,legacyV4=false}={}){
 const h=await setupV4(payload);
 // Explicit LEGACY fixture, never a production policy or journal upgrade.
 // Existing v3 orchestration/replay tests retain their original 8 packages.
 if(legacyV3){
  h.options.policy.assembly.prototypes={version:3,mode:'staged',candidateCount:3,recoveryReserve:7,newBuildingOnly:true,seedVisualGate:true,expansionCalls:0,
   roleCorrections:{version:1,mode:'tail-funded',reservedTailCorrections:2}};
  h.options.policy.assembly.maxPackages=8;
 }
 if(legacyV4){h.options.policy.assembly.prototypes.version=4;delete h.options.policy.assembly.prototypes.designAllocation;}
 h.options.invoke=async(prompt,index,options)=>{
  // Verify actual attachment files and record invocation inputs. Some tests
  // deliberately return invalid data; the production validator must reject it.
  const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));
  const reply=stagedResponse(input,options),answer=change?.({answer:reply,input,index,options,calls:h.calls})??reply;
  h.calls.push({index,phase:options.stageName,input,images:[...options.images],instructions:prompt.split('Assembly input (data):\n')[0]});
  const {validateModelImageFiles}=await import('../../bridge/native-evidence.mjs');await validateModelImageFiles(options.images,h.directory);
  return answer;
 };
 return h;
}
export const setupLegacyStaged=(change=null,payload=stagedRequest)=>setupStaged(change,payload,{legacyV3:true});
