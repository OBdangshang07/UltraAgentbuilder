import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash} from '../src/generation/compiler.mjs';
import {verifyInterruptionObservation} from './scene-assembly-interruption-snapshot.mjs';
import {verifyReplacementBudget} from './scene-replacement-budget.mjs';
import {assessReferenceTerminalEvidence} from './reference-terminal-evidence.mjs';

// Read-only evaluation of frozen, terminal paid evidence. Never invokes an Agent.
const [ledgerFile,target]=process.argv.slice(2);
if(!ledgerFile||!target)throw new Error('Usage: scene-assembly-assessment.mjs TERMINAL_LEDGER NEW_REPORT.json');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const optional=async file=>{try{return await read(file);}catch(e){if(e.code!=='ENOENT')throw e;return null;}};
const ledger=await read(ledgerFile),r=ledger.results[0];
await verifyInterruptionObservation(ledger);
if(!ledger.finishedAt||ledger.results.length!==1||!['preview-ready','failed','cancelled','interrupted'].includes(r?.state))throw new Error('Incomplete/unknown task; inspect only, never resubmit');
if(hash(ledger.protocol)!==ledger.protocolHash||ledger.reservedCalls>ledger.maximumCalls)throw new Error('Protocol/budget mismatch');
const snapshot=await read(path.join(ledger.runtime,'snapshot.json'));
if(hash(snapshot.files)!==ledger.runtimeHash||snapshot.hash!==ledger.runtimeHash)throw new Error('Frozen manifest identity mismatch');
for(const f of snapshot.files)if(hash(await fs.readFile(path.join(ledger.runtime,f.path)))!==f.hash)throw new Error('Frozen runtime changed: '+f.path);
const mod=file=>import(pathToFileURL(path.join(ledger.runtime,file)));
const {applyPackageEdit,applyAssemblyPlanEdit,applyAssemblyPlanRepair,AssemblyCandidateError,validateAssemblyReview}=await mod('contracts/scene-assembly.schema.mjs');
const {readAssemblyBaseline}=await mod('src/design/assembly-scope.mjs');
const {checkpointGeometryHash}=await mod('src/design/checkpoint.mjs');
const {readNativeBundle}=await mod('src/generation/bundle.mjs');
const {validateConceptReview}=await mod('bridge/assembly-design-review.mjs');
const job=await read(path.join(r.assetDirectory,'job.json'));
if(job.state!==r.state||job.assemblyCallsReserved!==r.assemblyCallsReserved||hash(job.assemblyStages)!==hash(r.assemblyStages))throw new Error('Job/ledger mismatch');
if(job.recoveryEnabled&&!/^assembly-run-[a-zA-Z0-9_-]+$/.test(job.recovery?.branch??''))throw new Error('Invalid durable evidence branch');
const assemblyRoot=path.join(r.assetDirectory,...(job.recoveryEnabled?[job.recovery.branch]:[]),'assembly');
let providerRecoveryAudit=null;
if(job.preflight?.assembly?.providerRecovery){
 const {auditAssemblyProviderRecovery}=await mod('bridge/assembly-provider-recovery-audit.mjs');
 const {assemblyRuntimeIdentity}=await mod('bridge/assembly-durability.mjs');
 providerRecoveryAudit=await auditAssemblyProviderRecovery({directory:r.assetDirectory,root:assemblyRoot,records:job.assemblyStages,
  policy:job.preflight,requestHash:job.requestHash,runtimeHash:await assemblyRuntimeIdentity(),model:job.model,effort:job.effort,
  summary:job.assemblySummary});
}
const predecessorIndex=stage=>{
 let prepared=providerRecoveryAudit?.preparedStageIndex(stage)??stage.index;
 const original=job.assemblyStages[prepared-1];
 if(original.formatCorrectionOf){const malformed=job.assemblyStages[original.formatCorrectionOf-1];
  prepared=providerRecoveryAudit?.preparedStageIndex(malformed)??malformed.index;}
 return prepared-1;
};
const referenceAudit=await assessReferenceTerminalEvidence({runtime:ledger.runtime,directory:r.assetDirectory,root:assemblyRoot,job});
let cumulativeBudget;
if(referenceAudit){
 if(ledger.replacement||ledger.resumedFrom||ledger.maximumCalls!==referenceAudit.originalMaximumCalls||
   ledger.protocol.maximumCalls!==referenceAudit.originalMaximumCalls||ledger.reservedCalls!==referenceAudit.reservedCalls)
   throw Error('Reference budget does not match its original confirmed task; no replacement or enlarged cap permitted');
 cumulativeBudget={priorCalls:0,cumulativeMaximumCalls:referenceAudit.originalMaximumCalls,cumulativeReservedCalls:referenceAudit.reservedCalls};
}else cumulativeBudget=await verifyReplacementBudget(ledger);
const recordedPrototypeTransition=await optional(path.join(assemblyRoot,'prototype-transition.json'));
let acceptedPrototype=null,acceptedPrototypeRecipes=null,verifiedPrototypeTransition=null;
let decomposedAudit=null,auditedCameraBasis=null;
const stages=[],proposedPlans=[],conceptStudies=[],conceptReviewHistory=[],sourceHistory=new Map(),completeReviews=new Map(),completedPackages=new Set();let acceptedSource=null,acceptedGeometry=null,acceptedAssetHash=null,plan=null,conceptDecision=null,lastRevisionContext=null,previousQualityReview=null,lastFinalQualityReview=null,qualitySelection=null;
const visualRevisionContextEnabled=snapshot.files.some(f=>f.path==='bridge/design-revision-context.mjs');
for(const stage of job.assemblyStages??[]){
 const dir=path.join(assemblyRoot,String(stage.index)),input=await read(path.join(dir,'input.json')),rawResponse=await optional(path.join(dir,'response.json')),scene=await optional(path.join(dir,'scene.json')),feedback=await optional(path.join(dir,'feedback.json'));
 let response=rawResponse;
 const stagedPrototype=input.tier?.prototypes?.mode==='staged',decomposedStage=stagedPrototype&&['assembly-blueprint','correct-blueprint','prototype-role','correct-prototype-role'].includes(stage.phase);
 const prototypeEnabled=['verified','staged'].includes(input.tier?.prototypes?.mode);
 if(input.unapprovedPrototypeProposal!==undefined){
  if(!prototypeEnabled||stage.phase!=='correct-design')throw Error('Rejected prototype evidence appeared outside its correction stage');
  const previous=job.assemblyStages[predecessorIndex(stage)-1];
  if(!previous||previous.state!=='rejected'||!['revise-design','correct-design'].includes(previous.phase))throw Error('Rejected prototype evidence lacks its original predecessor');
  const original=await read(path.join(assemblyRoot,String(previous.index),'response.json'));
  const {unapprovedPrototypeProposal}=await mod('src/design/correction-feedback.mjs');
  if(hash(input.unapprovedPrototypeProposal)!==hash(unapprovedPrototypeProposal(original)))throw Error('Rejected prototype wrapper/recipes differ from the preserved predecessor');
 }
 if(stagedPrototype&&!decomposedAudit){const {createDecomposedAudit}=await mod('bridge/assembly-decomposed-audit.mjs');decomposedAudit=createDecomposedAudit(assemblyRoot,{providerRecoveryAudit});}
 if(stagedPrototype&&['concept-review','correct-concept-review','revise-design','correct-design'].includes(stage.phase)&&decomposedAudit.verifyAllocationInput){
  await decomposedAudit.verifyAllocationInput(input,plan,acceptedPrototype);
 }
 if(prototypeEnabled&&['plan','correct-plan','repair-plan','revise-design','correct-design'].includes(stage.phase)){
  const {prototypePlanKey,prototypeProgramHash,prototypePlanSchemas}=await mod('contracts/scene-prototype-plan.mjs');
  const expectedFormat=stage.phase==='plan'?'SceneAssemblyPlan':stage.phase==='repair-plan'?'SceneAssemblyPlanRepair':'SceneAssemblyPlanEdit';
  const schema=prototypePlanSchemas[expectedFormat],key=prototypePlanKey(schema.properties.format.enum[0]);
  if(input.prototypeProgramHash!==prototypeProgramHash(input.priorPlan,input.prototypeRecipes))throw Error('Prototype input program identity mismatch');
  if(['revise-design','correct-design'].includes(stage.phase)&&!input.repairBase&&hash(input.prototypeRecipes)!==hash(acceptedPrototypeRecipes))throw Error('Prototype revision changed its accepted recipe baseline');
  if(stage.state==='accepted'){
   const {schemaFeedback}=await mod('contracts/schema-feedback.mjs');
   if(!schemaFeedback(rawResponse,schema).valid||(stage.phase!=='plan'&&rawResponse.programHash!==input.prototypeProgramHash))throw Error('Accepted prototype response contract/identity mismatch');
  }
  response=rawResponse?.[key]??null;
 }
 const sourceHash=acceptedSource?hash(acceptedSource):null;
 if(visualRevisionContextEnabled&&[3,4].includes(input.tier?.quality?.version)&&['revise-design','correct-design'].includes(stage.phase)){
  if(!input.designRevisionContext)throw new Error('Missing v3 design revision context');
  if(stage.phase==='revise-design'){
   if(hash(input.priorPlan)!==hash(plan))throw new Error('Visual revision does not target the last accepted plan');
   const {designRevisionContext}=await mod('bridge/design-revision-context.mjs');
   const expected=designRevisionContext(plan,input.designEvidence,conceptReviewHistory,input.callBudget);
   if(hash(expected)!==hash(input.designRevisionContext))throw new Error('Design revision history/budget context mismatch');
   // A pre-invocation image-integrity rejection has no provider receipt. It
   // is valid failure evidence, never proof that images reached the model.
   if(stage.invocationOutcome!=='not-started'&&stage.imageCount!==input.designEvidence.views.length)throw new Error('Visual revision lacks its image attachment receipt');
   lastRevisionContext=expected;
  }else if(!lastRevisionContext||hash(lastRevisionContext)!==hash(input.designRevisionContext))throw new Error('Design correction changed the original visual revision context');
 }
 if(['concepts','correct-concepts','concept-candidate','correct-concept-candidate'].includes(stage.phase)&&response){
  const result=await optional(path.join(dir,'result.json'));
  if(result?.candidates?.length){
   const {validateConceptSet}=await mod('contracts/scene-concepts.mjs');validateConceptSet(response,input.count);
   if(result.candidateSetHash!==hash(response))throw Error('Concept set hash mismatch');
   const candidates=[];
   for(const candidate of response.candidates){
    const folder=path.join(dir,candidate.id),saved=await read(path.join(folder,'scene.json')),report=await read(path.join(folder,'feedback.json'));
    if(hash(saved)!==hash(candidate.scene)||report.sourceHash!==hash(saved)||report.canAuthorizePlacement!==false)throw Error('Concept source/feedback mismatch');
    if(report.geometryPassed){
     const manifest=await read(path.join(folder,'diagnostic/manifest.json')),{assetHash,...data}=manifest,cells=await fs.readFile(path.join(folder,'diagnostic/cells.bin'));
     if(assetHash!==hash(data)||assetHash!==report.diagnosticAssetHash||manifest.scene.sourceHash!==hash(saved)||manifest.diagnosticOnly!==true||manifest.conceptOnly!==true||hash(cells)!==manifest.cellsHash)throw Error('Concept diagnostic asset mismatch');
    }
    candidates.push({id:candidate.id,sourceHash:report.sourceHash,geometryPassed:report.geometryPassed,geometryHash:report.geometryHash??null,assetHash:report.diagnosticAssetHash??null,eligible:result.candidates.find(c=>c.id===candidate.id)?.eligible??false});
   }
   conceptStudies.push({stage:stage.index,accepted:stage.state==='accepted',candidateSetHash:hash(response),candidates});
  }
 }
 if(input.designEvidence?.kind==='native-comparison'){
  const evidence=input.designEvidence,{readNativeComparison}=await mod('bridge/native-evidence.mjs'),actual=await readNativeComparison(r.assetDirectory,evidence.evidenceHash);
  if(hash(actual.evidence)!==hash(evidence)||stage.imageEvidenceHash!==evidence.evidenceHash||stage.imageCount!==actual.images.length||input.candidateSetHash!==evidence.candidateSetHash)throw Error('Concept comparison attachment mismatch');
  const study=stagedPrototype?await decomposedAudit.comparison(input,conceptStudies,stage):conceptStudies.find(s=>s.candidateSetHash===input.candidateSetHash);
  if(!study||hash(study.candidates.filter(c=>c.eligible).map(c=>c.id))!==hash(evidence.subjects.map(s=>s.id)))throw Error('Selection does not reference eligible saved candidates');
  for(const c of input.candidates){const saved=study.candidates.find(s=>s.id===c.id),subject=evidence.subjects.find(s=>s.id===c.id);if(!saved||!subject||saved.sourceHash!==hash(c.scene)||saved.sourceHash!==subject.sourceHash||saved.assetHash!==subject.assetHash)throw Error('Compared candidate/pixels differ from saved study');}
  if(stage.state==='accepted'){const {validateConceptSelection}=await mod('contracts/scene-concepts.mjs');conceptDecision=validateConceptSelection(response,input.candidateSetHash,evidence);}
 }
 if(stage.engineeringReplay){
  const proof=await read(path.join(dir,'engineering-replay.json')),originalJob=await read(path.join(proof.originalSourceDirectory,'job.json'));
  if(hash(proof.originalRecord)!==hash(originalJob.assemblyStages[stage.index-1])||proof.additionalModelCalls!==0||stage.engineeringReplay.additionalModelCalls!==0||proof.responseHash!==hash(response)||stage.engineeringReplay.responseHash!==hash(response)||hash(await read(path.join(proof.originalSourceDirectory,'assembly',String(stage.index),'response.json')))!==hash(response))throw new Error('Engineering replay changed original answer/record');
  if(proof.accepted!==(stage.state==='accepted'))throw new Error('Engineering replay outcome mismatch');
 }
 const designRevision=['revise-design','correct-design'].includes(stage.phase);
 const planStage=designRevision||decomposedStage||['plan','correct-plan','repair-plan'].includes(stage.phase),mergedPlan=planStage?await optional(path.join(dir,'plan.json')):null;
 const decomposedCandidate=decomposedStage&&scene?await decomposedAudit.reconstruct({stage,input,response,scene,feedback}):null;
 // A rejected contract repair may never reach plan.json; retain its proposal
 // statistics without treating that unvalidated source as accepted geometry.
 const proposed=planStage?(mergedPlan??(response?.scene?response:response?.format==='SceneAssemblyPlanRepair'?response.proposal:null)):null;
 if(mergedPlan&&!decomposedStage){
  if(stage.state==='accepted'&&input.selectedConcept){
   if(!conceptDecision||hash(input.selectedConcept.selection)!==hash(conceptDecision))throw Error('Full plan changed concept selection');
   const {checkSelectedConceptPlan}=await mod('contracts/scene-concepts.mjs');checkSelectedConceptPlan(input.selectedConcept.selected,mergedPlan);
  }
  if(input.repairBase?.candidatePlanHash){
   if(!designRevision||stage.phase!=='correct-design'||input.repairBase.authorityPlanHash!==hash(plan))throw new Error('Design candidate repair has no matching original plan');
   const previous=job.assemblyStages[predecessorIndex(stage)-1];
   if(!previous||previous.state!=='rejected'||!['revise-design','correct-design'].includes(previous.phase))throw new Error('Design candidate repair lacks rejected predecessor');
   const previousDir=path.join(assemblyRoot,String(previous.index));
   const {planCandidateBase,applyPlanCandidateCorrection}=await mod('contracts/scene-plan-candidate.mjs');
   const previousRaw=await read(path.join(previousDir,'response.json'));
   const previousResult=await read(path.join(previousDir,'result.json'));
   if(hash(input.contractFeedback)!==hash(previousResult.feedback))throw new Error('Design candidate correction feedback differs from preserved rejection');
   const base=planCandidateBase(plan,{plan:await read(path.join(previousDir,'plan.json')),effectiveEdit:await optional(path.join(previousDir,'effective-edit.json')),response:prototypeEnabled?previousRaw.edit:previousRaw},input.tier);
   if(!base)throw new Error('Design candidate baseline cannot be reconstructed');
   const {plan:candidatePlan,...repairIdentity}=base;
   if(hash(repairIdentity)!==hash(input.repairBase)||hash(candidatePlan)!==hash(input.priorPlan))throw new Error('Design candidate baseline differs from preserved predecessor');
   const repaired=applyPlanCandidateCorrection(plan,base,response,input.tier);
   if(hash(repaired.plan)!==hash(mergedPlan)||hash(repaired.effectiveEdit)!==hash(await read(path.join(dir,'effective-edit.json'))))throw new Error('Design candidate cumulative edit mismatch');
  }
  let reconstructed;try{reconstructed=response.format==='SceneAssemblyPlanRepair'?applyAssemblyPlanRepair(input.priorPlan,response,input.tier).plan:response.format==='SceneAssemblyPlanEdit'?applyAssemblyPlanEdit(input.priorPlan,response,input.tier,{designReview:designRevision}).plan:response;}catch(error){if(!AssemblyCandidateError||!(error instanceof AssemblyCandidateError))throw error;reconstructed=error.plan;}
  if(hash(reconstructed)!==hash(mergedPlan))throw new Error('Plan edit/merged proposal mismatch');
 }
 if(designRevision&&stagedPrototype&&stage.state==='rejected'){
  const rejected=await read(path.join(dir,'result.json'));
  const allocation=await optional(path.join(dir,'design-allocation.json'));
  if(rejected.feedback?.designAllocation||allocation?.accepted===false){
   if(!mergedPlan||!feedback||!rejected.prototype)throw new Error('Rejected design allocation lacks original plan/geometry evidence');
   await decomposedAudit.verifyRejectedAllocation(mergedPlan,dir,feedback,input,rejected.prototype,rejected);
  }
 }
 if(proposed)proposedPlans.push({stage:stage.index,accepted:stage.state==='accepted',designIntent:proposed.designIntent,bounds:proposed.scene?.bounds??null,componentCount:proposed.scene?.components?.length??0,componentKinds:(Array.isArray(proposed.scene?.components)?proposed.scene.components:[]).reduce((counts,c)=>{const kind=typeof c?.kind==='string'?c.kind:'invalid';counts[kind]=(counts[kind]??0)+1;return counts;},Object.create(null)),moduleCount:proposed.scene?.modules?.length??0,packages:(Array.isArray(proposed.packages)?proposed.packages:[]).map(p=>({id:p?.id,name:p?.name,purpose:p?.purpose,dependsOn:p?.dependsOn}))});
 if(input.previousDraft&&(hash(input.previousDraft)!==sourceHash||input.sourceHash!==sourceHash))throw new Error('Edit input does not use last accepted source');
 if(input.assembledScene&&(hash(input.assembledScene)!==sourceHash||input.sourceHash!==sourceHash))throw new Error('Review does not target last accepted source');
 if(scene){
  let reconstructed;
  if(response?.format==='ScenePackageRepair'){
   const previous=job.assemblyStages[predecessorIndex(stage)-1];
   if(!previous||previous.state!=='rejected'||previous.task!==stage.task)throw new Error('Package repair lacks its immediately rejected predecessor');
   const previousDir=path.join(assemblyRoot,String(previous.index));
   const previousEdit=await optional(path.join(previousDir,'effective-edit.json'))??await read(path.join(previousDir,'response.json'));
   const previousSource=await read(path.join(previousDir,'scene.json'));
   const {packageRepairBase,applyPackageRepair}=await mod('contracts/scene-package-repair.mjs');
   const base=packageRepairBase(acceptedSource,{rejectedSource:previousSource,rejectedEdit:previousEdit},input.task);
   if(!base||hash(base)!==hash(input.repairBase))throw new Error('Package repair base differs from preserved predecessor');
   const repaired=applyPackageRepair(acceptedSource,base,response,input.task);
   if(hash(repaired.effectiveEdit)!==hash(await read(path.join(dir,'effective-edit.json'))))throw new Error('Package repair effective delta mismatch');
   reconstructed=repaired.scene;
  }else if(response?.format==='SceneCoordinatedEdit'){
   const {coordinatedScope,applyCoordinatedEdit}=await mod('contracts/scene-coordinated-edit.mjs');
   const scope=coordinatedScope(plan,acceptedSource,input.critique);
   if(hash(scope)!==hash(input.coordinatedScope)||hash(scope)!==hash(await read(path.join(dir,'scope.json'))))throw new Error('Coordinated scope differs from approved package union');
   reconstructed=applyCoordinatedEdit(plan,acceptedSource,scope,response).scene;
  }else reconstructed=decomposedStage?decomposedCandidate.plan.scene:planStage?proposed.scene:applyPackageEdit(acceptedSource,response,input.task).scene;
  if(hash(reconstructed)!==hash(scene)||feedback?.sourceHash!==hash(scene))throw new Error('Raw response/source/feedback identity mismatch');
 }
 const finalReviewStage=['review','correct-review'].includes(stage.phase),conceptReviewStage=['concept-review','correct-concept-review'].includes(stage.phase),qualityV4=input.tier?.quality?.version===4;
 if(qualityV4&&(finalReviewStage||conceptReviewStage)){
  if(!Object.hasOwn(input,'previousReview')||hash(input.previousReview)!==hash(previousQualityReview))throw new Error('Quality v4 previous review differs from original recorded decision');
  if(stage.state==='accepted'){
   const {validateQualityReviewV4}=await mod('bridge/quality-review-v4.mjs');
   validateQualityReviewV4(response,{scene:acceptedSource,visualScene:input.designEvidence.prototypeExpansion?.version===2?acceptedPrototype.plan.scene:acceptedSource,plan,evidence:input.designEvidence,previousReview:previousQualityReview,measurements:input.revisionMeasurements,concept:conceptReviewStage});
  }
 }
 if(finalReviewStage&&stage.state==='accepted'&&!qualityV4)validateAssemblyReview(response,acceptedSource,plan);
 if(['concept-review','correct-concept-review'].includes(stage.phase)&&stage.state==='accepted'){
  if(!qualityV4)validateConceptReview(response,plan,input.designEvidence);
  conceptReviewHistory.push({phase:'concept-review',...response,mode:input.designEvidence.mode,round:conceptReviewHistory.length+1});
 }
 if(['native-asset','native-revision'].includes(input.designEvidence?.kind)){
  const evidence=input.designEvidence,{evidenceHash,...data}=evidence;
  if(hash(data)!==evidenceHash)throw new Error('Native model input evidence mismatch');
  // Earlier frozen runtimes sent design edits metadata only. New v3 revisions
  // attach the same accepted-baseline pixels; candidate-local geometry repairs
  // remain text-only. Verify actual receipts, not merely an image-capable tier.
  if(stage.imageCount!==undefined){if(stage.imageEvidenceHash!==evidenceHash||stage.imageCount!==evidence.views.length)throw new Error('Native attachment identity mismatch');}
  else if(['concept-review','correct-concept-review','review','correct-review'].includes(stage.phase))throw new Error('Native review lacks its image attachment receipt');
  const {readNativeEvidence,readNativeRevisionComparison}=await mod('bridge/native-evidence.mjs');
  const {measurements,prototypeEvidence,prototypeExpansion,cameraBasis,...transport}=evidence;delete transport.evidenceHash;
  const paired=evidence.kind==='native-revision',actual=paired?await readNativeRevisionComparison(r.assetDirectory,hash(transport)):await readNativeEvidence(r.assetDirectory,evidence.requestHash);
  const {evidenceHash:transportHash,...stored}=actual.evidence;
  const expandedReview=prototypeExpansion?.version===2;
  const reviewedSource=expandedReview?hash(acceptedPrototype.plan.scene):stage.imageCount!==undefined?input.sourceHash:sourceHash;
  if(hash(transport)!==hash(stored)||evidence.sourceHash!==reviewedSource||prototypeEvidence.sourceHash!==reviewedSource)throw new Error('Native pixels or prototypes differ from reviewed source');
  if(job.preflight?.assembly?.cameraEvidence||input.tier?.cameraEvidence||cameraBasis){
   if(!snapshot.files.some(f=>f.path==='bridge/assembly-camera-evidence.mjs'))throw Error('Frozen runtime did not select representative cameras');
   const {representativeEvidenceEnabled}=await mod('contracts/assembly-evidence-policy.mjs');
   if(!representativeEvidenceEnabled(job.preflight?.assembly)||!representativeEvidenceEnabled(input.tier)||
    hash(job.preflight.assembly)!==hash(input.tier)||!cameraBasis)throw Error('Representative camera evidence lacks its original confirmed policy');
   if(!auditedCameraBasis){
    if(!expandedReview||!acceptedPrototype||!decomposedAudit)throw Error('First representative basis is not the actual initial staged expansion');
    if(cameraBasis.sourceHash!==hash(acceptedPrototype.plan.scene)||
     cameraBasis.assetHash!==acceptedPrototype.feedback.diagnosticAssetHash)throw Error('Representative basis changed its first reviewed saved subject');
    auditedCameraBasis=structuredClone(cameraBasis);
   }else if(hash(cameraBasis)!==hash(auditedCameraBasis))throw Error('Representative comparison basis was replaced across revisions');
   const {verifyAssemblyCameraBasis}=await mod('bridge/assembly-camera-evidence.mjs');
   await verifyAssemblyCameraBasis({directory:r.assetDirectory,basis:cameraBasis,tier:input.tier,
    representatives:decomposedAudit.cameraResponsibilities(),views:evidence.views});
   const fullCaptures=paired?await Promise.all(actual.evidence.subjects.map(s=>readNativeEvidence(r.assetDirectory,s.requestHash))):[actual];
   for(const capture of fullCaptures)if(hash(capture.evidence.views.map(v=>v.camera))!==hash(cameraBasis.views))throw Error('Full native capture changed its original representative comparison cameras');
  }
  if(prototypeExpansion){
   const expected=acceptedPrototype&&(expandedReview?(await mod('bridge/assembly-prototypes.mjs')).prototypeVisualBinding(plan,acceptedPrototype):{programHash:hash(acceptedPrototype.program),witnessHash:acceptedPrototype.witness.witnessHash,expandedSourceHash:acceptedPrototype.evidence.expandedSourceHash,expandedGeometryHash:acceptedPrototype.evidence.expandedGeometryHash,expansionEvidenceHash:acceptedPrototype.evidence.evidenceHash,seedOnly:true,expandedPixelsSupplied:false});
   if(!prototypeEnabled||verifiedPrototypeTransition||!expected||hash(expected)!==hash(prototypeExpansion))throw Error('Native prototype recipe/seed evidence differs from accepted proposal');
  }else if(prototypeEnabled&&conceptReviewStage)throw Error('Prototype seed review is missing its expansion binding');
  if(paired){
   const before=sourceHistory.get(evidence.subjects[0].sourceHash),after=sourceHistory.get(reviewedSource);
   if(!before||!after)throw new Error('Revision comparison lacks saved accepted source history');
   const {revisionMeasurements}=await mod('src/design/revision-measurements.mjs');
   if(Object.hasOwn(input,'revisionMeasurements')&&hash(revisionMeasurements(before,after))!==hash(input.revisionMeasurements))throw new Error('Quality revision facts differ from saved source geometry');
  }else if(qualityV4&&(finalReviewStage||conceptReviewStage)&&input.revisionMeasurements!==null)throw new Error('Unpaired quality review invented revision measurements');
 }
 let geometry=null;const manifest=await optional(path.join(dir,'diagnostic/manifest.json'));
 if(manifest){
  const compiled=await readAssemblyBaseline(path.join(dir,'diagnostic'),feedback.diagnosticAssetHash);
  if(hash(scene)!==manifest.scene.sourceHash)throw new Error('Diagnostic/source mismatch');
  geometry={assetHash:manifest.assetHash,semanticHash:checkpointGeometryHash(compiled),diagnosticOnly:true,placeable:false,occupiedBounds:feedback.occupiedBounds,solidCount:feedback.solidCount,quality:manifest.quality};
 }
 if(stage.state==='accepted'&&scene){acceptedSource=scene;acceptedGeometry=geometry?.semanticHash;acceptedAssetHash=geometry?.assetHash;sourceHistory.set(hash(scene),scene);if(planStage)plan=proposed;
  if(prototypeEnabled&&planStage){
   if(decomposedStage){
    const checked=await decomposedAudit.commit({stage,input,candidate:decomposedCandidate,feedback});acceptedPrototypeRecipes=checked.recipes;acceptedPrototype=checked.prototype;
   }else{
    const {readAssemblyPrototypeCandidate}=await mod('bridge/assembly-prototypes.mjs');
    acceptedPrototypeRecipes=rawResponse.recipes;
    acceptedPrototype=await readAssemblyPrototypeCandidate({directory:path.join(dir,'prototype'),plan,recipes:acceptedPrototypeRecipes,seedFeedback:feedback});
    const outcome=await read(path.join(dir,'result.json'));
    if(hash(outcome.prototype)!==hash(acceptedPrototype)||hash(outcome.prototypeRecipes)!==hash(acceptedPrototypeRecipes))throw Error('Prototype stage outcome differs from saved checked candidate');
    if(stagedPrototype)await decomposedAudit.verifyRevision(plan,dir,feedback,input,acceptedPrototype);
   }
   // Both complete-plan and staged-role candidates have now independently
   // verified saved expansion bundles. Revision pairs can reference that
   // exact expanded source without compiling a substitute or accepting it
   // as a final building. Do not admit rejected candidate sources here.
   if(acceptedPrototype)sourceHistory.set(hash(acceptedPrototype.plan.scene),acceptedPrototype.plan.scene);
  }
  if(['component','correct-component'].includes(stage.phase)&&!input.refinement)completedPackages.add(stage.task);
 }
 if(recordedPrototypeTransition?.reviewStage===stage.index){
  if(!prototypeEnabled||!conceptReviewStage||stage.state!=='accepted'||!acceptedPrototype||verifiedPrototypeTransition)throw Error('Prototype transition has no accepted current seed review');
  const {prototypeTransitionRecord}=await mod('bridge/assembly-prototypes.mjs');
  const actual=prototypeTransitionRecord({plan,prototype:acceptedPrototype,review:response,reviewStage:stage.index,visual:{evidence:input.designEvidence,images:Array(stage.imageCount).fill('bound-receipt')},directory:assemblyRoot});
  if(hash(actual)!==hash(recordedPrototypeTransition))throw Error('Prototype transition differs from original response, assets or seed review');
  verifiedPrototypeTransition=actual;plan=acceptedPrototype.plan;acceptedSource=plan.scene;acceptedGeometry=acceptedPrototype.evidence.expandedGeometryHash;acceptedAssetHash=acceptedPrototype.feedback.diagnosticAssetHash;sourceHistory.set(hash(acceptedSource),acceptedSource);
 }
 if(qualityV4&&(finalReviewStage||conceptReviewStage)&&stage.state==='accepted'){
  previousQualityReview=response;
  if(finalReviewStage){
   lastFinalQualityReview=response;
   const selection=await optional(path.join(dir,'quality-selection.json'));
   if(selection){
    const prior=completeReviews.get(selection.selectedReviewStage),comparison=response.comparison;
    if(qualitySelection||!prior||completedPackages.size!==plan.packages.length||comparison?.verdict!=='regressed'||selection.reason!=='regressed-optional-candidate'||selection.version!==1||selection.selectedSourceHash!==hash(prior.source)||selection.selectedAssetHash!==prior.assetHash||selection.selectedEvidenceHash!==prior.evidenceHash||selection.rejectedSourceHash!==hash(acceptedSource)||selection.rejectedAssetHash!==acceptedAssetHash||selection.rejectedReviewStage!==stage.index||selection.rejectedEvidenceHash!==input.designEvidence.evidenceHash||comparison.beforeSourceHash!==hash(prior.source)||comparison.afterSourceHash!==hash(acceptedSource)||selection.previousReviewRetained!==true||selection.canAuthorizePlacement!==false||selection.aestheticQualityVerified!==false||hash([...selection.completedPackages].sort())!==hash([...completedPackages].sort()))throw new Error('Quality selection cannot restore an unreviewed, incomplete or unrelated building');
    if(stage.index!==job.assemblyStages.at(-1).index)throw new Error('Quality selection must terminate optional refinement');
    acceptedSource=prior.source;acceptedGeometry=prior.geometryHash;acceptedAssetHash=prior.assetHash;lastFinalQualityReview=prior.review;qualitySelection=selection;
   }else if(completedPackages.size===plan.packages.length)completeReviews.set(stage.index,{source:acceptedSource,geometryHash:acceptedGeometry,assetHash:acceptedAssetHash,evidenceHash:input.designEvidence.evidenceHash,review:response});
  }
 }
 const receipt=job.generations?.find(g=>g.stage===stage.index),failureUsage=stage.index===job.assemblyCallsReserved&&!receipt?job.generationDiagnostic?.usage:null;
 const diagnostic=providerRecoveryAudit?providerRecoveryAudit.diagnosticFor(stage.index):receipt?.diagnostic??(stage.index===job.assemblyCallsReserved?job.generationDiagnostic:null),e=diagnostic?.responseEvidence;
 let rawEvidence=null;
 if(e?.persisted){
  if(!/^(?:deepseek|codex|claude)-response-[\w-]+$/.test(e.directory)||!/^answer-\d+\.txt$/.test(e.file))throw new Error('Unsafe response evidence path');
  const evidenceDir=path.join(r.assetDirectory,e.directory),raw=await fs.readFile(path.join(evidenceDir,e.file));
  const saved=await read(path.join(evidenceDir,'receipt.json'));
  if(hash(raw)!==diagnostic.receivedTextSha256||raw.length!==diagnostic.receivedTextBytes||hash(saved)!==hash(diagnostic))throw new Error('Raw response/receipt identity mismatch');
  if(diagnostic.json){const facts=await read(path.join(evidenceDir,'json-validation.json')),candidate=await fs.readFile(path.join(evidenceDir,'candidate.txt'));if(hash(facts)!==hash(diagnostic.json)||hash(raw)!==facts.originalSha256||hash(candidate)!==facts.candidateSha256)throw new Error('JSON normalization evidence mismatch');}
  rawEvidence={directory:e.directory,file:e.file,bytes:raw.length,sha256:hash(raw),verified:true,json:diagnostic.json??null};
 }
 if(stage.formatCorrectionOf){
  const previous=stages.find(s=>s.index===stage.formatCorrectionOf),correction=input.formatCorrection;
  if(!previous?.rawEvidence?.verified||previous.invocationOutcome!=='completed-invalid-json'||correction.stage!==previous.index||hash(correction.originalText)!==previous.rawEvidence.sha256)throw new Error('Unverified format correction source');
 }
 stages.push({...stage,responsePreserved:!!rawResponse,sourcePreserved:!!scene,responseHash:rawResponse?hash(rawResponse):null,rawEvidence,diagnostic,
  generationObservations:job.generations?.filter(g=>g.stage===stage.index)??[],feedback,geometry,usage:diagnostic?.usage??receipt?.usage??failureUsage??null});
}
if(recordedPrototypeTransition&&!verifiedPrototypeTransition)throw Error('Prototype transition review was not verified');
let final=null;
if(job.state==='preview-ready'){
 if(providerRecoveryAudit&&!providerRecoveryAudit.report.allReservedCallsClosed)throw Error('Unknown original recovery call cannot produce an accepted final asset');
 const compiled=await readNativeBundle(r.nativeDirectory??r.assetDirectory),geometryHash=checkpointGeometryHash(compiled);
 if(compiled.manifest.assetHash!==job.assetHash||compiled.manifest.scene.sourceHash!==hash(acceptedSource)||geometryHash!==acceptedGeometry)throw new Error('Final output differs from accepted saved assembly');
 if(job.visualEvidenceBinding){const binding=job.visualEvidenceBinding;if(binding.finalAssetHash!==job.assetHash||binding.sourceHash!==hash(acceptedSource)||binding.cellsHash!==compiled.manifest.cellsHash||binding.evidenceHash!==job.assemblySummary.finalVisualReview.evidenceHash||binding.canAuthorizePlacement!==false)throw new Error('Final native image/placement identity mismatch');}
 if(job.assemblySummary?.qualityVersion===4){
  const summary=job.assemblySummary,review=lastFinalQualityReview;
  if(!review||summary.sourceHash!==hash(acceptedSource)||summary.finalTextReviewSourceHash!==review.sourceHash||summary.finalTextReviewCurrent!==(review.sourceHash===hash(acceptedSource))||summary.finalTextReviewAccepted!==(review.sourceHash===hash(acceptedSource)&&review.verdict==='accept')||hash(summary.unresolvedReviewIssues)!==hash(review.issues)||hash(summary.qualitySelection??null)!==hash(qualitySelection)||hash(summary.qualityReview)!==hash({version:4,findings:review.findings,previousIssues:review.previousIssues,comparison:review.comparison,qualityGuaranteed:false}))throw new Error('Final quality summary differs from selected original review');
 }
 if(verifiedPrototypeTransition){
  const expected={...verifiedPrototypeTransition,finalSourceHash:hash(acceptedSource),finalVisualReviewCurrent:job.assemblySummary.finalVisualReview?.sourceHash===hash(acceptedSource),qualityGuaranteed:false};
  if(hash(expected)!==hash(job.assemblySummary.prototypeExpansion))throw Error('Final prototype summary differs from verified transition');
 }else if(job.assemblySummary?.prototypeExpansion)throw Error('Final summary invented a prototype transition');
 if(decomposedAudit)await decomposedAudit.final(job.assemblySummary,hash(acceptedSource));
 if(auditedCameraBasis){
  const expected={mode:job.preflight.assembly.cameraEvidence.mode,basisHash:auditedCameraBasis.basisHash,
   status:auditedCameraBasis.selection.status,initialSourceHash:auditedCameraBasis.sourceHash,
   selectedFloorY:auditedCameraBasis.selection.selected?.base??null,fixedAcrossRevisions:true,
   functionVerified:false,aestheticQualityVerified:false,canAuthorizePlacement:false};
  if(hash(expected)!==hash(job.assemblySummary.cameraEvidence))throw Error('Final camera summary differs from its original verified basis');
 }else if(job.assemblySummary?.cameraEvidence)throw Error('Final summary invented representative camera evidence');
 final={assetHash:job.assetHash,sourceHash:hash(acceptedSource),geometryHash,dimensions:compiled.manifest.dimensions,solidCount:compiled.manifest.setCount,quality:compiled.manifest.quality,components:compiled.scene.components.length,modules:compiled.scene.modules.length};
}
const known=stages.filter(s=>Number.isSafeInteger(s.usage?.totalTokens));
await providerRecoveryAudit?.verifyUnchanged();
const report={type:'single-ultra-cbd-assessment',jobId:job.id,state:job.state,error:job.error??null,protocolHash:ledger.protocolHash,runtimeHash:ledger.runtimeHash,runtimeFilesVerified:snapshot.files.length,seconds:(Date.parse(r.finishedAt)-Date.parse(r.startedAt))/1000,maximumCalls:ledger.maximumCalls,reservedCalls:stages.length,returnedGenerationReceipts:job.generations?.length??0,knownUsageCalls:known.length,knownReportedTokens:known.reduce((n,s)=>n+s.usage.totalTokens,0),allReservedCallsHaveUsage:known.length===stages.length,model:job.model,effort:job.effort,additionalModelCalls:0,geometryChangedByAssessment:false,worldLoaded:false,resumedFrom:ledger.resumedFrom??null,inheritedCalls:ledger.inheritedCalls??0,newKnownReportedTokens:known.filter(s=>s.index>(ledger.inheritedCalls??0)).reduce((n,s)=>n+s.usage.totalTokens,0),
 modelChange:ledger.modelChange??null,interruptionObservation:ledger.interruptionObservation??null,replacement:ledger.replacement??null,cumulativeBudget,goalAuthorization:ledger.protocol.goalAuthorization??null,referenceAudit,providerRecoveryAudit:providerRecoveryAudit?.report??null,
 plan:plan?{designIntent:plan.designIntent,packages:plan.packages.map(p=>({id:p.id,name:p.name,purpose:p.purpose,dependsOn:p.dependsOn})),bounds:plan.scene.bounds}:null,proposedPlans,conceptStudies,conceptDecision,assemblySummary:job.assemblySummary??null,stages,final,aestheticQualityConfirmed:false,realisticCoreVerified:false,
 limitations:['This is one exploratory multi-call task, not an A/B or first-attempt single-call success rate.','Model text acceptance is not a visual or building-code certificate.','No usage receipt does not prove a call was free; actual fees are not estimated.','Failed diagnostics remain unplaceable; assessment does not repair or relabel them.']};
await fs.writeFile(target,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({report:path.resolve(target),jobId:job.id,state:report.state,error:report.error,reservedCalls:report.reservedCalls,knownUsageCalls:report.knownUsageCalls,knownReportedTokens:report.knownReportedTokens,seconds:report.seconds,planPackages:report.plan?.packages.length??0,final},null,2));
