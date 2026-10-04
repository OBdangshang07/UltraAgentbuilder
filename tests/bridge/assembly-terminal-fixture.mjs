import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {hash} from '../../src/generation/compiler.mjs';
import {compileScene} from '../../src/design/compiler.mjs';
import {freezeSceneRuntime} from '../../scripts/scene-runtime-snapshot.mjs';

// Synthetic transport/replies; reconstruct exact real compiled fixture cells.
// This never invokes a provider, renderer or Minecraft world transaction.
export async function terminalFixture(h,result){
  const project=fileURLToPath(new URL('../../',import.meta.url));
  const snapshot=await freezeSceneRuntime(project,path.join(h.directory,'runtime'));
  const records=result.records,compiled=compileScene(result.scene,{navigationPolicy:'review'});
  for(const [name,value] of Object.entries({'manifest.json':compiled.manifest,'scene.json':compiled.scene,
    'spec.json':compiled.spec,'design-sources.json':compiled.designSources}))
    await fs.writeFile(path.join(h.directory,name),JSON.stringify(value),{flag:'wx'});
  const owners=Buffer.alloc(compiled.sourceOwners.length*2);
  compiled.sourceOwners.forEach((v,i)=>owners.writeUInt16LE(v,i*2));
  await fs.writeFile(path.join(h.directory,'source-owners.bin'),owners,{flag:'wx'});
  await fs.writeFile(path.join(h.directory,'cells.bin'),compiled.binary,{flag:'wx'});
  const visual=result.summary.finalVisualReview;
  const job={id:'synthetic-candidate-correction-audit',state:'preview-ready',model:'offline',
    preflight:structuredClone(h.options.policy),
    assemblyCallsReserved:records.length,assemblyStages:records,assemblySummary:result.summary,
    assetHash:compiled.manifest.assetHash,recoveryEnabled:false,
    generations:records.filter(r=>r.responseReceived).map(r=>({stage:r.index,usage:null,diagnostic:null})),
    visualEvidenceBinding:{sourceHash:visual.sourceHash,cellsHash:compiled.manifest.cellsHash,
      renderedDiagnosticAssetHash:visual.assetHash,finalAssetHash:compiled.manifest.assetHash,
      evidenceHash:visual.evidenceHash,canAuthorizePlacement:false}};
  const finishedAt=new Date().toISOString(),protocol={type:'synthetic-candidate-correction-audit',realModelCalls:0};
  const ledger={protocol,protocolHash:hash(protocol),...snapshot,maximumCalls:26,
    reservedCalls:records.length,finishedAt,results:[{jobId:job.id,state:job.state,
      assemblyCallsReserved:records.length,assemblyStages:records,assetDirectory:h.directory,
      startedAt:finishedAt,finishedAt}]};
  await fs.writeFile(path.join(h.directory,'job.json'),JSON.stringify(job),{flag:'wx'});
  const ledgerFile=path.join(h.directory,'ledger.json');
  await fs.writeFile(ledgerFile,JSON.stringify(ledger),{flag:'wx'});
  return {async audit(name){
    const reportFile=path.join(h.directory,name+'.json');
    const child=spawn(process.execPath,[path.join(project,'scripts/scene-assembly-assessment.mjs'),ledgerFile,reportFile],
      {windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    return {code,output,report:code===0?JSON.parse(await fs.readFile(reportFile)):null};
  }};
}
