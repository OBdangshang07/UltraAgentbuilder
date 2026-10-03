import {assemblyPlan,planEdit} from '../design/assembly-fixtures.mjs';
import {shape} from '../design/fixtures.mjs';
import {setupV4,v4Request,v4Response} from './quality-v4-fixtures.mjs';
import {validateModelImageFiles} from '../../bridge/native-evidence.mjs';

// Real compiler/assets, SYNTHETIC replies and transport PNGs. No AI-design,
// native-render, aesthetic or whole-floor-function certification.
export const prototypeRequest={...v4Request,assemblyPrototypes:'verified'};
export const prototypeRecipes=count=>[{component:'designSeed',mode:'repeat',count,step:[1,0,0]}];
export function prototypeSeedPlan(){const plan=assemblyPlan();plan.scene.components.push(shape('designSeed',[4,1,5],[1,1,1],'frame'));return plan;}
export async function setupPrototypes(change){
 const h=await setupV4(prototypeRequest);h.options.invoke=async(p,index,o)=>{
  await validateModelImageFiles(o.images,h.directory);
  const input=JSON.parse(p.split('Assembly input (data):\n').at(-1));h.calls.push({index,phase:o.stageName,input,images:o.images});
  const format=o.outputSchema.properties.format.enum[0];
  let answer=format==='ScenePrototypePlan'?{format,version:1,plan:prototypeSeedPlan(),recipes:prototypeRecipes(3)}:
   format==='ScenePrototypePlanEdit'?{format,version:1,programHash:input.prototypeProgramHash,edit:planEdit(input.priorPlan,input.priorPlan),recipes:prototypeRecipes(3)}:
   format==='ScenePrototypePlanRepair'?{format,version:1,programHash:input.prototypeProgramHash,repair:{format:'SceneAssemblyPlanRepair',version:1,planHash:input.planHash,proposal:prototypeSeedPlan()},recipes:prototypeRecipes(3)}:v4Response(input,o);
  if(change)answer=change({answer,input,index,options:o,calls:h.calls})??answer;
  return answer;
 };return h;
}
