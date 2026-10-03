import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {assemblyPlan,packageEdit,acceptReview,planEdit} from '../design/assembly-fixtures.mjs';
import {conceptReviewSchemaV4,assemblyReviewSchemaV4} from '../../bridge/quality-review-v4.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {requestNativeEvidence,acceptNativeEvidence,validateModelImageFiles} from '../../bridge/native-evidence.mjs';
import {fixtureUpload} from './native-evidence-fixtures.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';

// Synthetic transport fixtures, NEVER architectural/native-render evidence.
export const v4Request={agent:'codex',model:'offline',prompt:'16×10×16格边界内设计建筑，保留内饰和通路',generationMode:'scene',sceneWorkflow:'components',qualityTier:'ultra',assemblyQuality:'v4',assemblyDesignReview:'native',assemblyRecovery:'safe',assemblyConfirmed:true,maxRepairs:0};
export function v4Review(input,concept=false){
  const evidence=input.designEvidence,schema=concept?conceptReviewSchemaV4:assemblyReviewSchemaV4,views=[evidence.kind==='native-revision'?1:0];
  const proof={evidence:'Offline fixture: cites bound data only, no aesthetic certification',views,components:['main']};
  const base=concept?{format:'SceneConceptReview',version:1,planHash:input.planHash,sourceHash:input.sourceHash,evidenceHash:evidence.evidenceHash,verdict:'accept',summary:'Fixture only',issues:[]}:acceptReview(input);
  return {...base,version:2,findings:schema.properties.issues.items.properties.criterion.enum.map(criterion=>({criterion,status:'adequate',...structuredClone(proof)})),
    previousIssues:(input.previousReview?.issues??[]).map(issue=>({id:issue.id,status:'resolved',...structuredClone(proof)})),
    comparison:evidence.kind==='native-revision'?{evidenceHash:evidence.evidenceHash,beforeSourceHash:evidence.subjects[0].sourceHash,afterSourceHash:evidence.subjects[1].sourceHash,verdict:'improved',
      gains:[{criterion:'coherence',...structuredClone(proof)}],losses:[],tradeoffs:(input.revisionMeasurements?.requiredTradeoffFacts??[]).map(factId=>({factId,...structuredClone(proof)}))}:null};
}
export function v4Response(input,options){
  const kind=options.outputSchema.properties.format.enum[0];
  if(kind==='SceneConceptSet')return {format:kind,version:1,candidates:Array.from({length:input.count},(_,i)=>{const scene=assemblyPlan().scene;scene.constraints={...scene.constraints,interior:false,walkable:false,passages:[]};scene.components[0].size[0]-=i;return {id:'candidate-'+i,rationale:'Transport fixture only',scene};})};
  if(kind==='SceneConceptSelection')return {format:kind,version:1,candidateSetHash:input.candidateSetHash,evidenceHash:input.designEvidence.evidenceHash,selected:input.candidates[0].id,reason:'Fixture only',comparisons:input.designEvidence.subjects.map(s=>({id:s.id,strength:'Test receipt exists',weakness:'No quality evidence',views:[input.designEvidence.views.findIndex(v=>v.subjectId===s.id)]}))};
  if(kind==='SceneAssemblyPlan')return assemblyPlan();
  if(kind==='SceneAssemblyPlanEdit')return planEdit(input.priorPlan,input.priorPlan);
  if(kind==='SceneConceptReview'||kind==='SceneAssemblyReview')return v4Review(input,kind==='SceneConceptReview');
  if(kind==='SceneCoordinatedEdit'){const edit=packageEdit(input);return {...edit,format:kind,scopeHash:input.coordinatedScope.scopeHash};}
  return packageEdit(input);
}
export async function setupV4(payload=v4Request){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-quality-v4-')),calls=[],uploads=[];
  const rules=await fs.readFile(new URL('../../prompts/scene-v1.md',import.meta.url),'utf8');
  return {directory,calls,uploads,options:{directory,prompt:payload.prompt,rules,policy:generationPreflight(payload),signal:new AbortController().signal,onStage:async()=>{},
    nativeEvidence:o=>requestNativeEvidence({...o,jobDirectory:directory,timeoutMs:2000,onWaiting:async s=>{if(s.state==='waiting'){uploads.push(s.id);await acceptNativeEvidence(directory,s.id,fixtureUpload(s.request));}}}),
    invoke:async(prompt,index,options)=>{assert.ok(!calls.some(c=>c.index===index),'Duplicate invocation');const input=JSON.parse(prompt.split('Assembly input (data):\n').at(-1));calls.push({index,phase:options.stageName,input,images:[...options.images],instructions:prompt.split('Assembly input (data):\n')[0]});await validateModelImageFiles(options.images,directory);const response=v4Response(input,options);assert.equal(schemaFeedback(response,options.outputSchema).valid,true);return response;}}};
}
