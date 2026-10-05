import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../src/generation/compiler.mjs';
import {assemblyCorrectionInput,correctionFeedback} from '../../src/design/correction-feedback.mjs';
import {inspectConstruction} from '../../src/design/construction-feedback.mjs';
import {floorWorldTower} from './floor-components-fixtures.mjs';

// Hand-authored failure context. No provider, model session or world access.
function fixture(){
  const scene=floorWorldTower(),construction=inspectConstruction(scene);assert.equal(construction.status,'passed');
  const feedback={sourceHash:hash(scene),constructionFeedback:construction,geometryPassed:false,error:'Protected host conflict',
    packageScopeFeedback:{conflictCells:3,truncated:false,groups:[{code:'protected-owner',before:'host',after:'skin',cells:3,samples:[[1,1,1],[1,2,1],[1,3,1]]}],canAuthorizePlacement:false},
    navigationFeedback:{checksComplete:false,truncated:true,issues:[{code:'unverified'}]},canAuthorizePlacement:false};
  const response={format:'ScenePrototypeRoleEdit',edit:{sourceHash:hash(scene),components:{put:[],remove:[]}},recipes:[{component:'skin',mode:'repeat',count:3,step:[0,5,0]}]};
  return {previousDraft:scene,task:{id:'skin',editableComponents:['skin'],regions:[{origin:[1,0,1],size:[3,16,3]}],interfaces:[]},
    prior:{response,feedback,overallAccepted:false,error:feedback.error,interpretation:'Original rejected output; not adopted'}};
}
test('prior feedback uses the same compiler summary, retaining exact rejected output, recipes, scope and navigation',()=>{
  const input=fixture(),before=hash(input),r=assemblyCorrectionInput(input);
  assert.equal(hash(input),before);assert.equal(r.previousDraft,input.previousDraft);assert.equal(r.task,input.task);
  assert.equal(r.prior.response,input.prior.response);assert.equal(r.prior.overallAccepted,false);assert.equal(r.prior.error,input.prior.error);
  assert.deepEqual(r.prior.feedback,correctionFeedback(input.prior.feedback));
  assert.equal(r.prior.feedback.packageScopeFeedback,input.prior.feedback.packageScopeFeedback);
  assert.equal(r.prior.feedback.navigationFeedback,input.prior.feedback.navigationFeedback);
  assert.equal(r.prior.feedback.geometryPassed,false);assert.equal(r.prior.feedback.canAuthorizePlacement,false);
  assert.ok(Buffer.byteLength(JSON.stringify(r))<Buffer.byteLength(JSON.stringify(input)));
});
test('all floor components, last floors, exceptional bands and check counts survive successful-arithmetic compaction',()=>{
  const input=fixture(),raw=input.prior.feedback.constructionFeedback,r=assemblyCorrectionInput(input).prior.feedback.constructionFeedback;
  assert.deepEqual(r.parametricLayouts.map(l=>l.component),raw.parametricLayouts.map(l=>l.component));
  for(let i=0;i<raw.parametricLayouts.length;i++){
    const a=r.parametricLayouts[i],b=raw.parametricLayouts[i];assert.deepEqual(a.rowBands,b.rowBands);assert.deepEqual(a.firstFloor,b.rows[0]);
    assert.deepEqual(a.lastFloor??a.firstFloor,b.rows.at(-1));assert.equal(a.expandedInstanceChecks,b.expandedInstanceChecks);assert.equal(a.canAuthorizePlacement,false);
  }
});
test('incomplete or erroneous arithmetic is never described as a complete successful pass',()=>{
  for(const mutate of [c=>c.checksComplete=false,c=>c.status='errors',c=>c.issueCount=1,c=>c.groupsTruncated=true,
    c=>c.truncated=true,c=>c.issueGroups=[{code:'bad-last-floor'}],c=>c.parametricLayouts[0].checksComplete=false]){
    const input=fixture();mutate(input.prior.feedback.constructionFeedback);const r=assemblyCorrectionInput(input);
    assert.notEqual(r.prior.feedback.constructionFeedback.parametricLayoutFormat,'complete-arithmetic-pass-summaries');
    assert.equal(r.prior.feedback.geometryPassed,false);assert.equal(r.prior.feedback.canAuthorizePlacement,false);
  }
});
test('candidate-set priors keep their separate per-candidate path and all response objects',()=>{
  const input=fixture(),candidate=input.prior.feedback;
  input.prior.feedback={candidates:[{id:'one',feedback:candidate},{id:'two',feedback:{geometryPassed:false,error:'Original error'}}]};
  const r=assemblyCorrectionInput(input);assert.equal(r.prior.response,input.prior.response);
  assert.deepEqual(r.prior.feedback.candidates[0].feedback,correctionFeedback(candidate));
  assert.deepEqual(r.prior.feedback.candidates[1],input.prior.feedback.candidates[1]);
});
test('absent and opaque prior feedback is not fabricated or interpreted',()=>{
  for(const prior of [undefined,{response:{opaque:true}},{feedback:{error:'Opaque original',geometryPassed:false}}]){
    const input={marker:'unchanged',...(prior?{prior}:{})},before=hash(input),r=assemblyCorrectionInput(input);
    assert.equal(hash(input),before);assert.deepEqual(r,input);
  }
});
test('summary is idempotent and provider recovery metadata stays the exact final suffix',()=>{
  const input={...fixture(),providerRetryOf:2,providerRecovery:{originalMarker:'synthetic'}},r=assemblyCorrectionInput(input);
  assert.deepEqual(assemblyCorrectionInput(r),r);assert.equal(r.providerRecovery,input.providerRecovery);
  assert.deepEqual(Object.keys(r).slice(-2),['providerRetryOf','providerRecovery']);
  assert.equal(r.prior.response,input.prior.response);assert.equal(r.prior.overallAccepted,false);
});
