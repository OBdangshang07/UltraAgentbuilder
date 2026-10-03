import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../src/generation/compiler.mjs';
import {bindPrototypeProgram} from '../contracts/scene-prototype-plan.mjs';
import {applyPrototypeExpansion} from '../contracts/scene-prototype-expansion.mjs';
import {validateAssemblyPlan} from '../contracts/scene-assembly.schema.mjs';
import {readAssemblyBaseline} from '../src/design/assembly-scope.mjs';
import {prototypeSeedWitness,prototypeExpansionWitness} from '../src/design/prototype-expansion.mjs';

const write=(directory,name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2),{flag:'wx'});
const saved=async(directory,feedback,scene)=>({...await readAssemblyBaseline(directory,feedback.diagnosticAssetHash),scene});

/** Check every proposed repeated instance BEFORE asking the model to review
 * its real seed pixels. This result is an unapproved design candidate only. */
export async function inspectAssemblyPrototypes({plan,recipes,checked,directory,policy,signal,inspect}){
 if(!checked.accepted)return checked;
 const root=path.join(directory,'prototype');await fs.mkdir(root,{recursive:false});
 let program,witness;
 const seedCompiled=await saved(checked.diagnostic,checked.feedback,plan.scene);
 try{program=bindPrototypeProgram(plan,recipes);witness=prototypeSeedWitness(plan.scene,program,seedCompiled);}
 catch(error){
  const failure={version:1,geometryPassed:false,canAuthorizePlacement:false,contract:{valid:false,issues:[{path:'$.recipes',code:'prototype-seed',message:error.message}]},error:error.message};
  await write(root,'feedback.json',failure);
  return {...checked,accepted:false,error:error.message,feedback:{...checked.feedback,prototypeExpansion:failure}};
 }
 await write(root,'program.json',program);await write(root,'seed-witness.json',witness);
 const scene=applyPrototypeExpansion(plan.scene,program),expandedPlan={...plan,scene};validateAssemblyPlan(expandedPlan,policy.assembly);
 await write(root,'scene.json',scene);await write(root,'plan.json',expandedPlan);
 const diagnostic=path.join(root,'diagnostic'),feedback=await inspect(scene,policy,diagnostic,signal,{});
 if(feedback.sourceHash!==hash(scene)||feedback.canAuthorizePlacement!==false)throw Error('Prototype full-expansion inspection identity mismatch');
 await write(root,'feedback.json',feedback);
 if(!feedback.geometryPassed)return {...checked,accepted:false,error:'Prototype expansion: '+feedback.error,feedback:{...checked.feedback,prototypeExpansion:feedback}};
 let evidence;const expandedCompiled=await saved(diagnostic,feedback,scene);
 try{evidence=prototypeExpansionWitness({scene:plan.scene,program,witness,seedCompiled,expandedCompiled});}
 catch(error){return {...checked,accepted:false,error:error.message,feedback:{...checked.feedback,prototypeExpansion:{geometryPassed:false,canAuthorizePlacement:false,error:error.message}}};}
 await write(root,'expansion-witness.json',evidence);
 return {...checked,prototype:{program,witness,evidence,plan:expandedPlan,feedback,diagnostic,root}};
}

/** Bind editing to the saved seed, but visual review to the actually expanded
 * diagnostic asset. Neither identity is substituted for the other. */
export function prototypeVisualBinding(plan,prototype){
 const {program,witness,evidence}=prototype;
 if(witness.sourceHash!==hash(plan.scene)||evidence.expandedSourceHash!==hash(prototype.plan.scene)||prototype.feedback.sourceHash!==hash(prototype.plan.scene)||prototype.feedback.geometryPassed!==true||prototype.feedback.canAuthorizePlacement!==false)throw Error('Prototype visual binding differs from checked seed/expansion');
 return {version:2,reviewSubject:'expanded',seedSourceHash:hash(plan.scene),seedAssetHash:witness.seedAssetHash,
  programHash:hash(program),witnessHash:witness.witnessHash,expandedSourceHash:evidence.expandedSourceHash,
  expandedAssetHash:prototype.feedback.diagnosticAssetHash,expandedGeometryHash:evidence.expandedGeometryHash,
  expansionEvidenceHash:evidence.evidenceHash,seedOnly:false,expandedPixelsSupplied:true};
}

/** No paid stage and no placement manifest. Only a current accepted review
 * of the hash-bound expanded pixels may adopt this checked source. */
export async function adoptAssemblyPrototypes({plan,prototype,review,reviewStage,visual,directory}){
 const actual=await readAssemblyPrototypeCandidate({directory:prototype.root,plan,recipes:prototype.program.recipes,seedFeedback:{diagnosticAssetHash:prototype.witness.seedAssetHash}});
 if(hash(actual)!==hash(prototype))throw Error('Prototype expansion candidate changed after seed review');
 const transition=prototypeTransitionRecord({plan,prototype,review,reviewStage,visual,directory});
 await write(directory,'prototype-transition.json',transition);return transition;
}

/** Strict read-only reconstruction for terminal audit and the adoption gate.
 * No model, rendering, compilation, writes or substitute baseline. */
export async function readAssemblyPrototypeCandidate({directory,plan,recipes,seedFeedback}){
 const read=async name=>JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
 const program=bindPrototypeProgram(plan,recipes);
 if(hash(program)!==hash(await read('program.json')))throw Error('Saved prototype program differs from original response');
 const witness=prototypeSeedWitness(plan.scene,program,await saved(path.join(directory,'..','diagnostic'),seedFeedback,plan.scene));
 if(hash(witness)!==hash(await read('seed-witness.json')))throw Error('Saved prototype seed witness differs from actual seed');
 const expandedPlan={...plan,scene:applyPrototypeExpansion(plan.scene,program)},feedback=await read('feedback.json'),diagnostic=path.join(directory,'diagnostic');
 if(hash(expandedPlan)!==hash(await read('plan.json'))||hash(expandedPlan.scene)!==hash(await read('scene.json'))||feedback.sourceHash!==hash(expandedPlan.scene)||feedback.geometryPassed!==true||feedback.canAuthorizePlacement!==false)throw Error('Saved prototype expansion plan/feedback mismatch');
 const evidence=prototypeExpansionWitness({scene:plan.scene,program,witness,seedCompiled:await saved(path.join(directory,'..','diagnostic'),seedFeedback,plan.scene),expandedCompiled:await saved(diagnostic,feedback,expandedPlan.scene)});
 if(hash(evidence)!==hash(await read('expansion-witness.json')))throw Error('Saved prototype expansion witness differs from checked asset');
 return {program,witness,evidence,plan:expandedPlan,feedback,diagnostic,root:directory};
}

export function prototypeTransitionRecord({plan,prototype,review,reviewStage,visual,directory}){
 const {program,witness,evidence}=prototype;
 const binding=prototypeVisualBinding(plan,prototype);
 if(review.verdict!=='accept'||review.planHash!==hash(plan)||review.sourceHash!==hash(plan.scene)||review.evidenceHash!==visual.evidence.evidenceHash||hash(visual.evidence.prototypeExpansion)!==hash(binding)||visual.evidence.sourceHash!==binding.expandedSourceHash||visual.evidence.assetHash!==binding.expandedAssetHash||visual.images.length!==visual.evidence.views?.length||visual.images.length<4)throw Error('Prototype expansion lacks current accepted expanded image review');
 const data={version:1,seedPlanHash:hash(plan),seedSourceHash:hash(plan.scene),seedAssetHash:witness.seedAssetHash,programHash:hash(program),witnessHash:witness.witnessHash,
  expansionEvidenceHash:evidence.evidenceHash,expandedPlanHash:hash(prototype.plan),expandedSourceHash:hash(prototype.plan.scene),expandedAssetHash:prototype.feedback.diagnosticAssetHash,
  reviewStage,reviewHash:hash(review),seedEvidenceHash:visual.evidence.evidenceHash,prototypeDirectory:path.relative(directory,prototype.root).replaceAll('\\','/'),
  visualReviewSubject:'expanded',seedVisualAccepted:false,expandedVisualAccepted:true,additionalModelCalls:0,canAuthorizePlacement:false};
 return {...data,transitionHash:hash(data)};
}
