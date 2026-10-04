import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runSceneAssembly} from '../../bridge/scene-assembly.mjs';
import {hash} from '../../src/generation/compiler.mjs';
import {setupStaged} from './decomposed-assembly-fixtures.mjs';
import {planEdit} from '../design/assembly-fixtures.mjs';
import {terminalFixture} from './assembly-terminal-fixture.mjs';

// Synthetic answers/transport PNGs only. Real cell checks, no paid provider,
// GPU rendering, world writes or claim of architectural quality.
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
for(const subject of ['seed','expanded'])test(subject+' design allocation failure reaches a bounded candidate-local correction and full review',async()=>{
  let reviewed=false,rejected;
  const component=subject==='seed'?'task0__b':'task1__a';
  const task=subject==='seed'?'task0':'task1';
  const point=subject==='seed'?[11,1,21]:[16,6,20];
  const h=await setupStaged(({answer,input,options})=>{
    if(options.stageName==='concept-review'&&!reviewed){
      reviewed=true;answer.verdict='revise';answer.issues=[{id:'bounded-study',criterion:'facade',
        evidence:'Synthetic bounded facade study',change:'Coordinate the study and its actual workspace'}];
    }
    if(options.stageName==='revise-design'){
      if(subject==='seed'){
        const target=structuredClone(input.priorPlan);
        target.scene.components.find(c=>c.id===component).at.offset[0]--;
        answer.edit=planEdit(input.priorPlan,target);
      }else answer.recipes.find(r=>r.component===component).step[0]=2;
      rejected=structuredClone(answer);
    }
    if(options.stageName==='correct-design'){
      assert.ok(input.repairBase);assert.equal(input.repairBase.approved,false);
      assert.equal(input.repairBase.canAuthorizePlacement,false);
      const feedback=input.contractFeedback;
      assert.match(feedback.error,/Design allocation misses actual witness\/expanded cell/);
      assert.equal(feedback.geometryPassed,true);
      assert.equal(feedback.canAuthorizePlacement,false);
      const allocation=feedback.designAllocation;
      assert.ok(allocation,'The model must receive exact saved owner-grid feedback');
      assert.equal(allocation.subject,subject);
      assert.equal(allocation.allRequiredSourceCellsCovered,false);
      assert.equal(allocation.geometryChangedByCheck,false);
      assert.equal(allocation.worldAuthorityChanged,false);
      assert.equal(allocation.canAuthorizePlacement,false);
      const {feedbackHash,...data}=allocation;assert.equal(feedbackHash,hash(data));
      const row=allocation.uncoveredSources.find(s=>s.id===component);
      assert.equal(row.task,task);assert.equal(row.outsideWorkspace,1);
      assert.deepEqual(row.uncoveredSamples,[point]);
      assert.deepEqual(row.uncoveredBounds,{min:point,maxExclusive:point.map(v=>v+1)});
      assert.match(h.calls.at(-1).instructions,/STAGED DESIGN ALLOCATION/);
      assert.match(options.stageName,/correct-design/);
      const target=structuredClone(input.priorPlan);
      target.packages.find(p=>p.id===task).regions.push({origin:point,size:[1,1,1]});
      answer.edit=planEdit(input.priorPlan,target);
      assert.deepEqual(answer.edit.sceneEdit.components,{put:[],remove:[]});
      assert.equal(answer.edit.packages.put.length,1);
      answer.recipes=structuredClone(input.prototypeRecipes);
      assert.deepEqual(answer.recipes,rejected.recipes);
    }
    return answer;
  });
  const result=await runSceneAssembly(h.options),revision=h.calls.find(c=>c.phase==='revise-design');
  const correction=h.calls.find(c=>c.phase==='correct-design'),root=path.join(h.directory,'assembly');
  assert.equal(h.calls.length,19);assert.equal(result.summary.completedPackages.length,5);
  assert.equal(result.summary.finalTextReviewAccepted,true);
  assert.equal(result.records.find(r=>r.index===revision.index).state,'rejected');
  assert.equal(result.records.find(r=>r.index===correction.index).state,'accepted');
  assert.deepEqual(correction.images,[]);
  assert.match(correction.instructions,/contractFeedback\.designAllocation/);
  const saved=await read(path.join(root,String(revision.index),'design-allocation.json'));
  assert.equal(saved.accepted,false);assert.equal(saved.error,correction.input.contractFeedback.error);
  assert.deepEqual(saved.feedback,correction.input.contractFeedback.designAllocation);
  const accepted=await read(path.join(root,String(correction.index),'design-allocation.json'));
  assert.equal(accepted.seed.allRequiredSourceCellsCovered,true);
  assert.equal(accepted.expanded.allRequiredSourceCellsCovered,true);
  assert.deepEqual(await read(path.join(root,String(revision.index),'response.json')),rejected);
  const later=h.calls.find(c=>c.phase==='concept-review'&&c.index>correction.index);
  assert.ok(later);assert.equal(later.input.designAllocationReceipt.receiptHash,accepted.receiptHash);
  assert.equal(later.input.designEvidence.kind,'native-revision');
  assert.deepEqual((await read(path.join(root,String(revision.index),'plan.json'))).scene,
    (await read(path.join(root,String(correction.index),'plan.json'))).scene);
  const terminal=await terminalFixture(h,result),audit=await terminal.audit('allocation-good');
  assert.equal(audit.code,0,audit.output);assert.equal(audit.report.state,'preview-ready');
  assert.equal(audit.report.additionalModelCalls,0);
  assert.equal(audit.report.aestheticQualityConfirmed,false);
  assert.equal(audit.report.final.sourceHash,hash(result.scene));
  const tamper=async(relative,name,change,expected)=>{
    const file=path.join(root,relative),original=await fs.readFile(file),value=JSON.parse(original);
    change(value);await fs.writeFile(file,JSON.stringify(value));
    try{const bad=await terminal.audit(name);assert.notEqual(bad.code,0);assert.match(bad.output,expected);}
    finally{await fs.writeFile(file,original);}
  };
  await tamper(revision.index+'/design-allocation.json','wrong-owner-cell',v=>v.feedback.uncoveredSources[0].uncoveredSamples[0][0]++,/Rejected design allocation differs/);
  await tamper(revision.index+'/result.json','wrong-rejection-feedback',v=>v.feedback.designAllocation.outsideWorkspaceCells++,/Rejected design allocation differs/);
  await tamper(revision.index+'/result.json','wrong-rejected-prototype',v=>{v.prototype.evidence.expandedSourceHash='0'.repeat(64);},/Rejected design prototype differs/);
  await tamper(correction.index+'/input.json','dropped-model-feedback',v=>{delete v.contractFeedback.designAllocation;},/correction feedback differs/);
  assert.equal(h.calls.length,19);
});
