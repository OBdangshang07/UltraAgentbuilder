import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyPlan} from '../design/assembly-fixtures.mjs';
import {conceptReviewSchemaV4,qualityReviewSchemaV4,validateQualityReviewV4} from '../../bridge/quality-review-v4.mjs';
import {schemaFeedback} from '../../contracts/schema-feedback.mjs';
import {revisionMeasurements} from '../../src/design/revision-measurements.mjs';
import {v4Review} from './quality-v4-fixtures.mjs';

function fixture(paired=false){
  const plan=assemblyPlan(),before=structuredClone(plan.scene),scene=structuredClone(before);if(paired)scene.components[0].material='frame';
  const data={kind:paired?'native-revision':'native-asset',sourceHash:hash(scene),views:Array.from({length:paired?8:4},(_,i)=>({id:'view-'+i,...(paired?{subjectId:i%2?'after':'before'}:{})})),
    ...(paired?{subjects:[{id:'before',sourceHash:hash(before)},{id:'after',sourceHash:hash(scene)}]}:{})};
  const evidence={...data,evidenceHash:hash(data)},measurements=paired?revisionMeasurements(before,scene):null;
  const input={sourceHash:hash(scene),planHash:hash({...plan,scene}),designEvidence:evidence,revisionMeasurements:measurements,previousReview:null};
  return {input,context:{scene,plan:{...plan,scene},evidence,measurements},review:v4Review(input),before};
}
test('v4 review enforces every architectural finding without upgrading a text/source claim into aesthetic certification',()=>{
  const f=fixture();assert.equal(validateQualityReviewV4(f.review,f.context),f.review);
  for(const change of [r=>r.findings.pop(),r=>r.findings.push(r.findings[0]),r=>r.findings[0].components=['missing'],r=>r.findings[0].views=[7],r=>r.findings[0].status='weak',r=>{for(const finding of r.findings){finding.status='unseen';finding.views=[];finding.components=[];}}]){
    const r=structuredClone(f.review);change(r);assert.throws(()=>validateQualityReviewV4(r,f.context));
  }
  const concept=v4Review(f.input,true);validateQualityReviewV4(concept,{...f.context,concept:true});
  assert.equal(conceptReviewSchemaV4.properties.version.enum[0],2);
  const wrong=structuredClone(concept);wrong.evidenceHash='0'.repeat(64);assert.throws(()=>validateQualityReviewV4(wrong,{...f.context,concept:true}),/evidence/);
});
test('v4 comparison rejects wrong identities, historical current claims, fabricated comparisons and regressed acceptance',()=>{
  const f=fixture(true);validateQualityReviewV4(f.review,f.context);
  for(const change of [r=>r.comparison.beforeSourceHash='0'.repeat(64),r=>r.comparison.evidenceHash='0'.repeat(64),r=>r.findings[0].views=[0],r=>r.comparison.gains=[],r=>{r.comparison.verdict='regressed';r.comparison.losses=r.comparison.gains;}]){
    const r=structuredClone(f.review);change(r);assert.throws(()=>validateQualityReviewV4(r,f.context));
  }
  const unpaired=fixture();unpaired.review.comparison=f.review.comparison;assert.throws(()=>validateQualityReviewV4(unpaired.review,unpaired.context),/invented/);
  assert.throws(()=>validateQualityReviewV4(f.review,{...f.context,evidence:{...f.context.evidence,sourceHash:hash(f.before)}}),/current scene/);
});
test('v4 stable issue IDs cannot vanish, duplicate, remain actionable after resolution or be resolved using BEFORE pixels',()=>{
  const f=fixture(true),old={id:'facade-rhythm',task:'exterior',criterion:'facade',evidence:'Prior fixture problem',change:'Improve rhythm'};
  f.input.previousReview={issues:[old]};f.context.previousReview=f.input.previousReview;f.review=v4Review(f.input);
  validateQualityReviewV4(f.review,f.context);
  for(const change of [r=>r.previousIssues=[],r=>r.previousIssues.push(r.previousIssues[0]),r=>r.previousIssues[0].views=[0],r=>r.previousIssues[0].status='outside-coverage']){
    const r=structuredClone(f.review);change(r);assert.throws(()=>validateQualityReviewV4(r,f.context));
  }
  const unresolved=structuredClone(f.review);unresolved.verdict='revise';unresolved.task='exterior';unresolved.issues=[old];unresolved.previousIssues[0].status='unresolved';validateQualityReviewV4(unresolved,f.context);
  unresolved.previousIssues[0].status='resolved';assert.throws(()=>validateQualityReviewV4(unresolved,f.context),/still marked/);
});
test('v4 reduced openings require explicit bound design tradeoffs, not a generic aesthetic approval',()=>{
  const f=fixture(true),fact={id:'facade/windows',requiresTradeoffExplanation:true};
  f.context.measurements={...f.context.measurements,facadeChanges:[fact],requiredTradeoffFacts:[fact.id]};
  assert.throws(()=>validateQualityReviewV4(f.review,f.context),/tradeoff explanation/);
  f.review.comparison.tradeoffs=[{factId:fact.id,evidence:'Fixture tradeoff, not a universal glazing rule',views:[0,1],components:['main']}];validateQualityReviewV4(f.review,f.context);
  f.review.comparison.tradeoffs[0].factId='invented';assert.throws(()=>validateQualityReviewV4(f.review,f.context),/Unknown/);
});
test('a later review may retain validated historical resolutions while all latest outstanding IDs remain mandatory',()=>{
  // Synthetic replay of the live call-20 failure shape, not a modified model
  // response and not evidence that the actual CBD passed architectural review.
  const f=fixture(true),proof={evidence:'Current synthetic source/view, not architectural approval',views:[1],components:['main']};
  const outstanding={id:'facade-work-coverage',criterion:'coherence',evidence:'Fixture still needs work',change:'Resolve bounded work allocation'};
  const retained=['facade-page-hierarchy','atrium-gallery-sightline'].map(id=>({id,status:'resolved',...structuredClone(proof)}));
  f.input.previousReview={issues:[outstanding],previousIssues:retained};f.context.previousReview=f.input.previousReview;
  const review=v4Review(f.input,true);review.verdict='revise';review.issues=[outstanding];review.previousIssues[0].status='unresolved';review.previousIssues.push(...structuredClone(retained));
  assert.equal(validateQualityReviewV4(review,{...f.context,concept:true}),review);
  const omitted=structuredClone(review);omitted.previousIssues=omitted.previousIssues.filter(x=>x.id!==outstanding.id);
  assert.throws(()=>validateQualityReviewV4(omitted,{...f.context,concept:true}),/lack explicit resolution/);
  for(const change of [r=>r.previousIssues.push(structuredClone(r.previousIssues[1])),r=>r.previousIssues[1].id='invented-old-id',
    r=>r.previousIssues[1].views=[0],r=>{r.previousIssues[1].views=[];r.previousIssues[1].components=[];},
    r=>r.previousIssues[1].status='unresolved']){
    const invalid=structuredClone(review);change(invalid);assert.throws(()=>validateQualityReviewV4(invalid,{...f.context,concept:true}));
  }
});
test('exact response schema exposes only mandatory latest IDs and optional previously validated resolved IDs',()=>{
  const f=fixture(true),proof={evidence:'Fixture',views:[1],components:['main']};
  const previousReview={issues:[{id:'outstanding'}],previousIssues:[{id:'retained',status:'resolved',...proof},{id:'not-validated-resolved',status:'unresolved',...proof}]};
  const schema=qualityReviewSchemaV4({concept:true,previousReview});
  assert.deepEqual(schema.properties.previousIssues.items.properties.id.enum,['outstanding','retained']);assert.equal(schema.properties.previousIssues.minItems,1);
  const initial=qualityReviewSchemaV4({concept:true});assert.equal(initial.properties.previousIssues.maxItems,0);
  const review=v4Review(f.input,true);assert.equal(schemaFeedback(review,initial).valid,true);
  review.previousIssues=[{id:'fabricated-history',status:'resolved',...proof}];assert.equal(schemaFeedback(review,initial).valid,false);
});
