import {hash} from '../src/generation/compiler.mjs';
import {PROTOTYPE_ROLES} from '../contracts/scene-decomposition-roles.mjs';

export {PROTOTYPE_ROLES};
const bounded=(v,min,max,label)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('Invalid decomposition '+label);};

/** A NEW scheduling contract, not a reinterpretation of v4 journals. A slot is
 * a required responsibility, never evidence of geometry or aesthetic quality.
 * Corrections consume genuine spare calls; pending/unknown calls stop dispatch. */
export function decompositionBlueprintBudget({maximumCalls,candidateCount=3,maximumPackages=16,recoveryReserve=7,preludeCalls=0},
 {reservedCalls=0,completedCandidates=0,selectionAccepted=false,completedPrelude=0}={}){
 bounded(maximumCalls,1,26,'call limit');bounded(candidateCount,1,3,'candidate count');
 bounded(maximumPackages,4,16,'package ceiling');bounded(recoveryReserve,0,26,'recovery reserve');
 bounded(reservedCalls,0,maximumCalls,'reserved calls');
 bounded(completedCandidates,0,candidateCount,'completed candidates');
 bounded(preludeCalls,0,1,'prelude calls');bounded(completedPrelude,0,preludeCalls,'completed prelude');
 if((completedCandidates||selectionAccepted)&&completedPrelude!==preludeCalls)throw Error('Decomposition reference prelude is not accepted');
 if(typeof selectionAccepted!=='boolean'||selectionAccepted&&completedCandidates!==candidateCount)throw Error('Invalid decomposition selection progress');
 const completedPrefix=completedPrelude+completedCandidates+(selectionAccepted?1:0);
 if(reservedCalls<completedPrefix)throw Error('Decomposition progress exceeds reserved ledger');
 // Before the blueprint: selection, blueprint, four prototypes, seed review,
 // final review. Candidate slots already dispatched remain counted.
 const fixedCalls=preludeCalls+candidateCount+8;
 const consumedRecovery=reservedCalls-completedPrefix,remainingRecovery=Math.max(0,recoveryReserve-consumedRecovery);
 const fixedRemaining=fixedCalls-completedPrefix;
 const packageCeiling=Math.min(maximumPackages,maximumCalls-reservedCalls-fixedRemaining-remainingRecovery);
 return {version:preludeCalls?2:1,...(preludeCalls?{preludeCalls,completedPrelude}:{}),maximumCalls,candidateCount,reservedCalls,fixedCalls,recoveryReserve,
  consumedRecovery,remainingRecovery,fixedRemaining,maximumPackages:Math.max(0,packageCeiling),canStart:packageCeiling>=4,
  canAuthorizePlacement:false};
}

export function createDecompositionSchedule({maximumCalls,candidateCount=3,packageIds,recoveryReserve=7,preludeCalls=0}){
 bounded(maximumCalls,1,26,'call limit');bounded(candidateCount,1,3,'candidate count');bounded(recoveryReserve,0,26,'recovery reserve');
 bounded(preludeCalls,0,1,'prelude calls');
 if(!Array.isArray(packageIds)||packageIds.length<4||packageIds.length>16||new Set(packageIds).size!==packageIds.length||
  packageIds.some(id=>typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(id)))throw Error('Invalid decomposition packages');
 const stages=[...(preludeCalls?[{id:'reference-analysis',phase:'reference-analysis'}]:[]),...Array.from({length:candidateCount},(_,i)=>({id:'concept-'+(i+1),phase:'concept-candidate'})),
  {id:'selection',phase:'select-concept'},{id:'blueprint',phase:'assembly-blueprint'},
  ...PROTOTYPE_ROLES.map(role=>({id:role,phase:'prototype-role'})),
  {id:'seed-review',phase:'prototype-review'},...packageIds.map(task=>({id:'package:'+task,phase:'component',task})),
  {id:'final-review',phase:'review'}];
 if(stages.length+recoveryReserve>maximumCalls)throw Error('Decomposition cannot fund every required stage and recovery reserve');
 const data={version:preludeCalls?2:1,...(preludeCalls?{preludeCalls}:{}),maximumCalls,candidateCount,packageIds:[...packageIds],recoveryReserve,stages};
 return {...data,scheduleHash:hash(data)};
}

export function decompositionCallBudget(schedule,records){
 const {scheduleHash,...data}=schedule;
 if(scheduleHash!==hash(data)||![1,2].includes(data.version))throw Error('Decomposition schedule identity changed');
 // Reconstruct the declared schedule to reject a newly hashed corrupt shape.
 if(createDecompositionSchedule(data).scheduleHash!==scheduleHash)throw Error('Invalid decomposition schedule');
 if(!Array.isArray(records)||records.length>schedule.maximumCalls)throw Error('Invalid decomposition ledger');
 let completed=0,rejected=false,terminal=null;
 for(const [i,record] of records.entries()){
  const expected=schedule.stages[completed];
  if(terminal||!expected||record.index!==i+1||record.stageId!==expected.id||record.kind!==(rejected?'correction':'primary')||
   !['accepted','rejected','pending','unknown','failed','cancelled'].includes(record.outcome))throw Error('Decomposition ledger order/outcome violated');
  if(record.outcome==='accepted'){completed++;rejected=false;}
  else if(record.outcome==='rejected')rejected=true;
  else terminal=record.outcome;
 }
 const remaining=schedule.maximumCalls-records.length,mandatoryRemaining=schedule.stages.length-completed;
 const spare=remaining-mandatoryRemaining,finished=completed===schedule.stages.length;
 const canStart=!terminal&&!finished&&spare>=0;
 return {version:schedule.version,scheduleHash,reservedCalls:records.length,completedStages:completed,remaining,mandatoryRemaining,
  recoveryCallsUsed:records.length-completed-(terminal?1:0),availableRecoveryCalls:Math.max(0,spare),
  nextStage:finished?null:structuredClone(schedule.stages[completed]),nextKind:rejected?'correction':'primary',
  canStart,finished,stopReason:terminal?'provider-'+terminal:finished?'schedule-complete':canStart?null:'required-path-unfunded',
  // Completing bookkeeping must not masquerade as finished building quality.
  canAuthorizePlacement:false};
}

export function decompositionConfiguration(tier){
 return {maximumCalls:tier.maximumCalls,candidateCount:tier.prototypes.candidateCount,
  maximumPackages:tier.maxPackages,recoveryReserve:tier.prototypes.recoveryReserve,
  ...(tier.referenceAnalysis?{preludeCalls:tier.referenceAnalysis.requiredCalls}:{})};
}

export function decompositionPreludeProgress(tier,records){
 if(!tier.referenceAnalysis)return {};
 const prefix=[];
 for(const record of records){
  if(!['reference-analysis','correct-reference-analysis'].includes(record.phase))break;
  prefix.push(record);
 }
 if(!prefix.length||prefix.at(-1).state!=='accepted'||prefix.filter(r=>r.state==='accepted').length!==1||
  prefix.some(r=>r.decompositionStageId!=='reference-analysis'||
    !['accepted','rejected'].includes(r.state)&&!(r.state==='failed'&&r.invocationOutcome==='completed-invalid-json')))
  throw Error('Decomposition requires one accepted durable reference prelude');
 return {completedPrelude:1};
}
