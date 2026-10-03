import path from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '../src/generation/compiler.mjs';
import {safeEvidenceFile} from './native-evidence.mjs';
import {auditAssemblyReferenceAnalysis} from './assembly-reference-analysis.mjs';
import {REFERENCE_LIMITS} from '../contracts/reference-attachments.mjs';
import {auditAssemblyProviderRecovery} from './assembly-provider-recovery-audit.mjs';

// Historical reads deliberately use the ORIGINAL capsule runtime identity,
// not the current process's runtime. They never recover/publish/run a task.
export async function readReferenceJobHistory({directory,intent,reference,imageId}){
  const job=JSON.parse((await safeEvidenceFile(directory,'job.json',16*1024*1024)).toString('utf8'));
  assert.equal(job.id,intent.jobId);assert.equal(job.key,intent.ownerId);assert.equal(job.requestHash,intent.requestHash);
  assert.equal(job.agent,'codex');assert.equal(job.model,reference.preparation.model);
  assert.equal(hash(job.preflight),hash(reference.preparation.policy),'Original reference task budget changed');
  assert.deepEqual(job.referenceGeneration,{version:1,preparationHash:reference.preparation.preparationHash,input:reference.input});
  if(imageId!==undefined){
    assert.match(imageId,/^[a-f0-9]{64}$/);const index=reference.manifest.references.findIndex(r=>r.id===imageId);
    assert.ok(index>=0,'Image is not in this original job');
    const record=reference.manifest.references[index],relative=`reference-input/${intent.ownerId}/reference-sets/${reference.manifest.setHash}/${record.file}`;
    const png=await safeEvidenceFile(directory,relative,REFERENCE_LIMITS.bytesPerImage);
    assert.equal(hash(png),record.sha256);return {png,sha256:record.sha256};
  }
  let analysis={status:'pending',reason:'No accepted original reference analysis yet'};
  const records=job.assemblyStages??[];
  assert.ok(Array.isArray(records)&&records.length<=reference.preparation.policy.maximumCalls);
  const accepted=records.find(r=>['reference-analysis','correct-reference-analysis'].includes(r.phase)&&r.state==='accepted');
  if(accepted){
    try{
      const branch=job.recovery?.branch;
      assert.ok(typeof branch==='string'&&/^assembly-run-[A-Za-z0-9_-]{6,32}$/.test(branch),'Original analysis branch missing or unsafe');
      const root=path.join(directory,branch,'assembly');
      const providerRecoveryAudit=reference.preparation.policy.assembly.providerRecovery?await auditAssemblyProviderRecovery({directory,root,records,
        policy:reference.preparation.policy,requestHash:job.requestHash,runtimeHash:intent.runtimeHash,model:job.model,effort:job.effort,
        summary:job.assemblySummary}):null;
      const audit=await auditAssemblyReferenceAnalysis({directory,root,referenceInput:reference.input,records,
        policy:reference.preparation.policy,prompt:reference.preparation.generation.prompt,runtimeHash:intent.runtimeHash,providerRecoveryAudit});
      const evidence=JSON.parse((await safeEvidenceFile(root,'reference-analysis.json',16*1024*1024)).toString('utf8'));
      analysis={status:'accepted',evidence,audit};
    }catch(error){analysis={status:'unavailable',reason:'Original analysis audit did not pass: '+error.message};}
  }
  const content={format:'ReferenceJobHistory',version:1,jobId:job.id,state:job.state,requestHash:intent.requestHash,
    preparation:reference.preparation,binding:reference.binding,sendConfirmation:intent.submission.sendConfirmation,
    manifest:reference.manifest,analysis,additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
  const result={...content,historyHash:hash(content)};
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=1048576,'Original reference history metadata quota');return result;
}
