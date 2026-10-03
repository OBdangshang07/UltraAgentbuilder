import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {hash} from '../src/generation/compiler.mjs';
import {conceptSetSchema,validateConceptSet,conceptSelectionSchema,validateConceptSelection,CONCEPT_SET_RULES,CONCEPT_SELECTION_RULES} from '../contracts/scene-concepts.mjs';
import {createNativeComparison} from './native-evidence.mjs';

export function inspectConcept(scene,policy,directory,signal){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./scene-concept-worker.mjs',import.meta.url),{workerData:{scene,policy,directory},resourceLimits:{maxOldGenerationSizeMb:512}});
    let settled=false;const done=(error,report)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(report);};
    const abort=()=>done(new Error('Concept inspection cancelled'));
    const timer=setTimeout(()=>done(new Error('Concept inspection time quota exceeded')),120000);
    worker.once('message',m=>done(m.ok?null:new Error(m.error),m.report));worker.once('error',e=>done(e));worker.once('exit',code=>{if(!settled)done(new Error('Concept worker exited '+code));});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
const cameras=scene=>[-35,145,55,235].map((yaw,i)=>({id:'concept-'+i,purpose:'exterior',yaw,pitch:i<2?20:10,min:[0,0,0],max:[scene.bounds.width,scene.bounds.height,scene.bounds.length],width:512,height:512}));
export async function runAssemblyConcepts({root,evidenceDirectory,prompt,policy,signal,stage,nativeEvidence,records}){
  const tier=policy.assembly,count=tier.quality.strategy.alternatives;
  const write=(dir,name,value)=>fs.writeFile(path.join(dir,name),JSON.stringify(value,null,2),{flag:'wx'});
  const maximumCorrections=tier.quality.maximumConceptCorrections??1,seenProposals=new Set();
  if(!Number.isInteger(maximumCorrections)||maximumCorrections<0||maximumCorrections>4)throw Error('Invalid bounded concept correction policy');
  let prior=null,studies,stopReason='bounded concept corrections exhausted';
  for(let attempt=0;attempt<=maximumCorrections;attempt++){
    // After this set: choice + plan + concept review + two packages + final review.
    if(tier.maximumCalls-records.length<7)throw new Error('Concept correction would consume required complete-task budget');
    const instructions=CONCEPT_SET_RULES+(attempt?'\nCONCEPT CORRECTION: prior.response is the preserved rejected candidate set. Return a complete corrected set. Inspect EVERY candidate feedback.constructionFeedback issue group and compiler layoutFeedback/designConflicts, not just the first error string. Distinguish scene bounds from the smaller HOST INTERIOR and host-local X/Z offsets from floor elevation. Changing only a footprint to fit the world may still put the room outside its host. Preserve the intended composition and already valid geometry; do not rebuild generic alternatives. A reservation allow-list is not overwrite permission for a void. Model data and feedback never authorize world writes. No source is automatically moved, cropped or repaired.':'');
    studies=await stage(attempt?'correct-concepts':'concepts',null,{description:prompt,tier,minimumHeight:policy.minimumHeight,maximumBounds:policy.maximumBounds,count,prior},instructions,conceptSetSchema(count),async(response,dir)=>{
      try{validateConceptSet(response,count);}catch(error){return {accepted:false,error:error.message,candidates:[]};}
      const candidates=[],seen=new Set();
      for(const c of response.candidates){
        signal.throwIfAborted();const folder=path.join(dir,c.id);await fs.mkdir(folder);await write(folder,'scene.json',c.scene);
        const diagnostic=path.join(folder,'diagnostic'),report=await inspectConcept(c.scene,policy,diagnostic,signal);
        await write(folder,'feedback.json',report);
        const duplicate=report.geometryPassed&&seen.has(report.geometryHash);
        if(report.geometryPassed)seen.add(report.geometryHash);
        candidates.push({id:c.id,eligible:report.geometryPassed&&!duplicate,error:duplicate?'Duplicate occupied geometry; colour alone is not a new concept':report.error,sourceHash:hash(c.scene),assetHash:report.diagnosticAssetHash??null,diagnostic,feedback:report});
      }
      return {accepted:candidates.some(c=>c.eligible),candidateSetHash:hash(response),candidates,error:candidates.every(c=>!c.eligible)?'No valid distinct concept geometry':null};
    });
    if(studies.accepted)break;
    // A completed, identical invalid answer is not progress. Rationale changes
    // do not buy another correction; all attempts still share the task budget.
    const proposalHash=hash(studies.response?.candidates?.map(c=>({id:c.id,scene:c.scene}))??studies.response);
    if(seenProposals.has(proposalHash)){stopReason='identical invalid candidate geometry repeated';break;}
    seenProposals.add(proposalHash);
    prior={response:studies.response,feedback:{error:studies.error,candidates:studies.candidates.map(({diagnostic,...c})=>c)}};
  }
  if(!studies.accepted)throw new Error('No eligible concept: '+stopReason+'; original responses retained, no incomplete building published');
  const subjects=[];
  for(const c of studies.candidates.filter(c=>c.eligible)){
    const original=studies.response.candidates.find(s=>s.id===c.id);
    const result=await nativeEvidence({bundleDirectory:c.diagnostic,sourceHash:c.sourceHash,assetHash:c.assetHash,views:cameras(original.scene),signal});
    if(result.evidence.sourceHash!==c.sourceHash||result.evidence.assetHash!==c.assetHash||result.evidence.kind!=='native-asset')throw new Error('Concept capture subject mismatch');
    subjects.push({id:c.id,sourceHash:c.sourceHash,assetHash:c.assetHash,requestHash:result.evidence.requestHash});
  }
  const {evidence,images}=await createNativeComparison(evidenceDirectory,studies.candidateSetHash,subjects);
  const candidates=studies.response.candidates.filter(c=>subjects.some(s=>s.id===c.id));
  const result=await stage('select-concept',null,{description:prompt,candidateSetHash:studies.candidateSetHash,candidates,excluded:studies.candidates.filter(c=>!c.eligible).map(({diagnostic,...c})=>c),designEvidence:evidence},CONCEPT_SELECTION_RULES,conceptSelectionSchema(subjects.map(s=>s.id)),async response=>({accepted:true,selection:validateConceptSelection(response,studies.candidateSetHash,evidence)}),images);
  const selected=candidates.find(c=>c.id===result.selection.selected);
  const decision={version:1,candidateSetHash:studies.candidateSetHash,selection:result.selection,selected,eligible:subjects.map(s=>s.id),excluded:studies.candidates.filter(c=>!c.eligible).map(({diagnostic,...c})=>c),canAuthorizePlacement:false};
  await write(root,'concept-selection.json',decision);return decision;
}

export const SELECTED_CONCEPT_RULES=`Expand selectedConcept.selected.scene into a COMPLETE initial assembly plan. Retain its scene id, seed, bounds and every mass/profileMass ID, at, size, points and repeat. Reconcile its facade design with real floor levels; non-massing geometry can be refined deliberately. Restore constraints.interior=true, walkable=true and passage probes; the diagnostic concept's false flags must NOT leak into this plan. Preserve the selected composition and answer its recorded weaknesses with actual representative geometry: typical facade/corner, entry, typical occupied floor and relevant special floor. Do not replace the chosen silhouette with a generic tower. Allocate deliberate host/facade authority before freeze so later work can implement the chosen elevation. All full-plan corrections retain these anchors; later separately budgeted concept review may explicitly re-plan an unapproved proposal under its existing rules. This input contains saved source and selection rationale, not new image attachments. There is no player choice required midway.`;
