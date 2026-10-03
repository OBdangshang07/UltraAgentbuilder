import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectQualityJobStatus} from '../../scripts/quality-live-status.mjs';

async function fixture(t,{closed=true,state='failed',savedState=state,connection=false}={}){
 const project=path.resolve('build','status-test-'+randomUUID().replaceAll('-','')),root=path.join(project,'build','quality-native-'+randomUUID().replaceAll('-',''));
 const id=randomUUID(),job={id,state:savedState,assemblyCallsReserved:3,assemblyStages:[{index:3,phase:'plan',state:'failed'}],error:'response-body-decode'};
 await fs.mkdir(path.join(root,'data','jobs',id),{recursive:true});
 await fs.writeFile(path.join(root,'ledger.json'),JSON.stringify({results:[{jobId:id,state}],cleanupCompleted:closed,reservedCalls:3,maximumCalls:26,model:'gpt-6.1-sol',runtimeHash:'a'.repeat(64)}));
 await fs.writeFile(path.join(root,'data','jobs',id,'job.json'),JSON.stringify(job));
 for(let i=1;i<=3;i++){const dir=path.join(root,'data','jobs',id,'codex-response-test'+i);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify({reason:i<3?'completed':'failed',completionSource:'notification'}));}
 if(connection)await fs.writeFile(path.join(root,'data','connection.json'),JSON.stringify({protocol:1,port:3456,token:'b'.repeat(64)}));
 // Test-owned data only. Never remove a project/build root or external path.
 t.after(async()=>{assert.equal(await fs.realpath(project),project);assert.equal(path.dirname(project),path.resolve('build'));assert.match(path.basename(project),/^status-test-[a-f0-9]{32}$/);await fs.rm(project,{recursive:true,force:true});});return {root,projectRoot:project,job};
}
test('closed terminal receipt remains inspectable after the Bridge removes its token file',async t=>{const f=await fixture(t);const r=await inspectQualityJobStatus(f.root,{projectRoot:f.projectRoot,fetcher:()=>assert.fail('No network in terminal fallback')});assert.equal(r.state,'failed');assert.equal(r.observationSource,'saved-terminal-receipt');assert.equal(r.liveObservation,false);assert.equal(r.receiptFiles,3);assert.equal(r.completeReceipts,2);assert.equal(r.additionalModelCalls,0);});
test('missing connection cannot convert an open or generating task into a terminal observation',async t=>{for(const options of [{closed:false},{state:'generating'}]){const f=await fixture(t,options);await assert.rejects(inspectQualityJobStatus(f.root,{projectRoot:f.projectRoot}));}});
test('mismatched saved job outcome is refused',async t=>{const f=await fixture(t,{savedState:'preview-ready'});await assert.rejects(inspectQualityJobStatus(f.root,{projectRoot:f.projectRoot}));});
test('live path is still only a bound loopback GET and never emits its bearer token',async t=>{const f=await fixture(t,{connection:true});let calls=0;const r=await inspectQualityJobStatus(f.root,{projectRoot:f.projectRoot,fetcher:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:3456/v1/jobs/'+f.job.id);assert.equal(options.redirect,'error');assert.equal(options.method,undefined);return {status:200,json:async()=>f.job};}});assert.equal(calls,1);assert.equal(r.observationSource,'live-loopback-get');assert.equal(r.liveObservation,true);assert.equal(JSON.stringify(r).includes('b'.repeat(64)),false);});
