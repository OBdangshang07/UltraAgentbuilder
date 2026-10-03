import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {runDurableAssembly} from '../../bridge/assembly-durability.mjs';
import {generationPreflight} from '../../bridge/generation-policy.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {readNativeRevisionComparison} from '../../bridge/native-evidence.mjs';
import {setupV4,v4Request} from './quality-v4-fixtures.mjs';

test('v4 four tiers require explicit native comparison and keep the original call/token budgets',()=>{
  for(const tier of ['lite','pro','max','ultra']){
    const p=generationPreflight({...v4Request,qualityTier:tier});assert.equal(p.maxOutputTokens,null);assert.equal(p.assembly.quality.version,4);
    assert.equal(p.assembly.quality.pairedRevisionReview,true);assert.equal(p.assembly.quality.structuredFindings,true);
    assert.equal(p.assembly.quality.maximumConceptCorrections,p.assembly.maximumPlanCorrections);
  }
  for(const delta of [{assemblyDesignReview:'text'},{assemblyDesignReview:'images'},{assemblyRecovery:undefined},{assemblyCalls:6},{agent:'claude'}])assert.throws(()=>generationPreflight({...v4Request,...delta}));
});
test('v4 whole assembly sends real bound BEFORE/AFTER attachments, fixed cameras and separate current-source findings',async()=>{
  const {options,calls,directory}=await setupV4(),result=await runSceneAssembly(options);
  assert.equal(result.summary.reservedCalls,7);assert.equal(result.summary.qualityVersion,4);assert.equal(result.summary.visualReviewCurrent,true);assert.equal(result.summary.designQuality.nativeMaterialReview,true);
  const concept=calls.find(c=>c.phase==='concept-review'),review=calls.find(c=>c.phase==='review');
  assert.equal(concept.input.previousReview,null);assert.equal(concept.input.revisionMeasurements,null);assert.equal(concept.input.designEvidence.kind,'native-asset');
  assert.equal(review.input.designEvidence.kind,'native-revision');assert.equal(review.images.length,8);assert.match(review.instructions,/native block-model views/);assert.doesNotMatch(review.instructions,/limited geometry-image review/);
  assert.equal(review.input.revisionMeasurements.beforeSourceHash,concept.input.sourceHash);assert.equal(review.input.revisionMeasurements.afterSourceHash,hash(result.scene));
  assert.deepEqual(review.input.designEvidence.views.map(v=>v.subjectId),['before','after','before','after','before','after','before','after']);
  const {measurements,prototypeEvidence,evidenceHash,...transport}=review.input.designEvidence;
  const pair=await readNativeRevisionComparison(directory,hash(transport));assert.equal(pair.evidence.sourceHash,hash(result.scene));
  assert.equal(result.summary.finalVisualReview.evidenceHash,evidenceHash);assert.equal(result.summary.qualityReview.findings.length,6);
});

async function regressionSetup(){
  const testCase=await setupV4(),invoke=testCase.options.invoke;let reviews=0;
  testCase.options.invoke=async(p,i,o)=>{
    const answer=await invoke(p,i,o),input=testCase.calls.at(-1).input;
    if(o.stageName==='review'){
      reviews++;answer.verdict='revise';answer.task='exterior';answer.issues=[{id:'facade-rhythm',task:'exterior',criterion:'facade',evidence:'Unresolved fixture preference',change:'Refine exterior detail'}];
      if(reviews>1){answer.previousIssues[0].status='unresolved';answer.comparison.verdict='regressed';answer.comparison.losses=[...answer.comparison.gains];answer.comparison.gains=[];}
    }
    return answer;
  };
  return testCase;
}
test('v4 regressed optional geometry restores the prior COMPLETE reviewed asset and retains both original decisions',async()=>{
  const {options,calls,directory}=await regressionSetup(),result=await runSceneAssembly(options);
  assert.equal(result.summary.stopReason,'candidate-regressed-previous-preserved');assert.equal(result.summary.reservedCalls,9);assert.equal(result.summary.reviewRounds,2);
  const reviews=calls.filter(c=>c.phase==='review'),selection=result.summary.qualitySelection;
  assert.equal(hash(result.scene),reviews[0].input.sourceHash);assert.notEqual(hash(result.scene),reviews[1].input.sourceHash);
  assert.equal(result.summary.finalTextReviewCurrent,true);assert.equal(result.summary.finalTextReviewAccepted,false);assert.equal(result.summary.visualReviewCurrent,true);assert.equal(result.summary.visualReviewAccepted,false);
  assert.equal(result.summary.unresolvedReviewIssues[0].id,'facade-rhythm');assert.equal(selection.selectedReviewStage,7);assert.equal(selection.rejectedReviewStage,9);
  const refinement=calls.find(c=>c.phase==='refine-coordinated');assert.equal(refinement.images.length,8);assert.equal(refinement.input.designEvidence.evidenceHash,reviews[0].input.designEvidence.evidenceHash);assert.doesNotMatch(refinement.instructions,/No images attached/);
  assert.equal(selection.selectedEvidenceHash,result.summary.finalVisualReview.evidenceHash);assert.deepEqual(selection.completedPackages,['exterior','interior']);
  assert.equal(result.summary.lastAcceptedDirectory,path.join(directory,'assembly','6','diagnostic'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'assembly','9','quality-selection.json'),'utf8')),selection);
  const lastDecision=JSON.parse(await fs.readFile(path.join(directory,'assembly','9','response.json'),'utf8'));assert.equal(lastDecision.comparison.verdict,'regressed');assert.equal(lastDecision.verdict,'revise');
  assert.equal(result.summary.reviewHistory.at(-1).comparison.verdict,'regressed');assert.equal(result.summary.qualityReview.comparison.verdict,'improved');
});
test('v4 durable replay restores the same selection without reissuing any completed model call or recapturing PNGs',async()=>{
  const {options,calls,uploads}=await regressionSetup(),abort=new AbortController(),identity={requestHash:hash(v4Request),runtimeHash:'v4-transport-test-fixture'};
  await assert.rejects(runDurableAssembly({...options,...identity,signal:abort.signal,onStage:async records=>{if(records.at(-1).phase==='refine-coordinated'&&records.at(-1).state==='accepted')abort.abort();}}),/abort/i);
  assert.equal(calls.length,8);const priorUploads=uploads.length;
  const result=await runDurableAssembly({...options,...identity});assert.equal(calls.length,9);assert.equal(uploads.length,priorUploads+1);
  assert.equal(result.summary.stopReason,'candidate-regressed-previous-preserved');assert.equal(result.summary.qualitySelection.selectedReviewStage,7);
  assert.equal(result.summary.finalTextReviewCurrent,true);assert.equal(result.summary.visualReviewCurrent,true);
});
