import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Called only after the parent assessor has verified every frozen runtime
// source. Runtime snapshot hash and assembly runtime identity are DIFFERENT
// protocols: recompute the latter using the original frozen module and Node.
export async function assessReferenceTerminalEvidence({runtime,directory,root,job}){
  if(!job.referenceGeneration)return null;
  assert.ok(['preview-ready','failed','cancelled','interrupted'].includes(job.state),'Reference task must be terminal');
  runtime=path.resolve(runtime);directory=path.resolve(directory);
  assert.equal(path.basename(directory),job.id);assert.equal(path.basename(path.dirname(directory)),'jobs');
  const mod=file=>import(pathToFileURL(path.join(runtime,file)));
  const {hash}=await mod('src/generation/compiler.mjs'),{assemblyRuntimeIdentity}=await mod('bridge/assembly-durability.mjs');
  const {referenceGenerationOperation}=await mod('bridge/reference-generation-worker.mjs');
  const {auditAssemblyReferenceAnalysis}=await mod('bridge/assembly-reference-analysis.mjs');
  const {safeEvidenceFile}=await mod('bridge/native-evidence.mjs');
  const runtimeHash=await assemblyRuntimeIdentity(pathToFileURL(runtime+path.sep));
  let providerRecoveryAudit=null;
  if(job.preflight?.assembly?.providerRecovery){
    const {auditAssemblyProviderRecovery}=await mod('bridge/assembly-provider-recovery-audit.mjs');
    providerRecoveryAudit=await auditAssemblyProviderRecovery({directory,root,records:job.assemblyStages??[],policy:job.preflight,
      requestHash:job.requestHash,runtimeHash,model:job.model,effort:job.effort,summary:job.assemblySummary});
  }
  const original=await referenceGenerationOperation({dataDir:path.dirname(path.dirname(directory)),operation:'recover',jobId:job.id,runtimeHash});
  assert.equal(original.requestHash,job.requestHash,'Reference original SEND request changed');
  assert.equal(hash(original.policy),hash(job.preflight),'Reference original shared budget changed');
  assert.deepEqual(job.referenceGeneration,{version:1,preparationHash:original.submission.preparationHash,input:original.referenceInput});
  const records=job.assemblyStages??[];assert.equal(records.length,job.assemblyCallsReserved??0);
  assert.ok(records.length<=original.policy.maximumCalls,'Reference task exceeded its original call cap');
  if(records.length){
    const identity=JSON.parse((await safeEvidenceFile(directory,'assembly-journal/identity.json',32768)).toString('utf8'));
    assert.equal(hash(identity.value),identity.sha256);
    assert.deepEqual(identity.value,{version:1,requestHash:job.requestHash,policyHash:hash(original.policy),runtimeHash,maximumCalls:original.policy.maximumCalls});
  }
  const accepted=records.find(r=>['reference-analysis','correct-reference-analysis'].includes(r.phase)&&r.state==='accepted');
  let audit=null;
  if(accepted){
    audit=await auditAssemblyReferenceAnalysis({root,directory,records,referenceInput:original.referenceInput,
      policy:original.policy,prompt:original.request.prompt,runtimeHash,providerRecoveryAudit});
    if(job.state==='preview-ready'){
      const summary=job.assemblySummary?.referenceAnalysis;assert.ok(summary,'Published reference task has no reference summary');
      assert.deepEqual(summary,{version:1,analysisHash:audit.analysisHash,briefHash:audit.briefHash,
        referenceBindingHash:original.referenceInput.bindingHash,referenceSetHash:original.submission.sendConfirmation.setHash,
        stage:accepted.index,sharedTaskBudget:true,referenceAngleComparisonVerified:false,geometryVerified:false,canAuthorizePlacement:false});
    }
  }else{
    assert.notEqual(job.state,'preview-ready','No accepted analysis; a text-only building cannot be published');
    assert.ok(records.every(r=>['reference-analysis','correct-reference-analysis'].includes(r.phase)),'Building advanced without accepted reference analysis');
    // Rejected prelude responses remain original evidence too. Never treat
    // their presence as accepted image understanding or geometry.
    for(const record of records){
      const input=JSON.parse((await safeEvidenceFile(root,record.index+'/input.json',16*1024*1024)).toString('utf8'));
      assert.equal(record.referenceBindingHash,original.referenceInput.bindingHash);assert.equal(input.referenceBindingHash,original.referenceInput.bindingHash);
      const receipt=JSON.parse((await safeEvidenceFile(directory,'assembly-journal/call-'+record.index+'.json',16*1024*1024)).toString('utf8'));
      assert.equal(hash(receipt.value),receipt.sha256);
      if(record.responseReceived){
        assert.equal(receipt.value.state,'response');
        const response=JSON.parse((await safeEvidenceFile(root,record.index+'/response.json',16*1024*1024)).toString('utf8'));
        assert.deepEqual(response,receipt.value.response,'Rejected original analysis response replaced');
      }
    }
  }
  return {version:1,originalSendAndJobImagesVerified:true,assemblyRuntimeHash:runtimeHash,
    originalMaximumCalls:original.policy.maximumCalls,reservedCalls:records.length,analysisAccepted:!!accepted,
    providerRecoveryAudit:providerRecoveryAudit?.report??null,
    analysisAudit:audit,realImageUnderstandingVerified:false,referenceAngleComparisonVerified:false,
    additionalModelCalls:0,worldWrites:0,canAuthorizePlacement:false};
}
