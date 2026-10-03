import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexAdapter,findCodex,compareVersions} from '../../bridge/codex-adapter.mjs';

test('newer Desktop CLI wins over stale PATH; an explicit path never switches',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-codex-discovery-'));
  const old=path.join(root,'old'),desktop=path.join(root,'OpenAI/Codex/bin/release');
  await fs.mkdir(old);await fs.mkdir(desktop,{recursive:true});
  const oldExe=path.join(old,'codex.exe'),newExe=path.join(desktop,'codex.exe');
  await fs.writeFile(oldExe,'fixture');await fs.writeFile(newExe,'fixture');
  const options={env:{LOCALAPPDATA:root},directories:[old],version:async p=>p===oldExe?'0.147.0':'0.153.4'};
  assert.equal(await findCodex(undefined,options),newExe);assert.equal(await findCodex(oldExe,options),oldExe);
  assert.ok(compareVersions('0.153.4','0.147.0')>0);
  await assert.rejects(findCodex(path.join(root,'missing.exe'),options),/no automatic fallback/);
});
test('Astra and efforts are returned only from live catalog; hidden models stay hidden',async()=>{
  const a=new CodexAdapter();a.connect=async()=>{};
  a.request=async(method,params)=>{assert.equal(method,'model/list');assert.equal(params.includeHidden,false);return {data:[{model:'gpt-6-astra',displayName:'GPT-6-Astra',supportedReasoningEfforts:[{reasoningEffort:'ultra'}],defaultReasoningEffort:'medium'},{model:'hidden-test',hidden:true}],nextCursor:null};};
  const models=await a.models();assert.equal(models.length,1);assert.equal(models[0].id,'gpt-6-astra');assert.equal(models[0].efforts[0].reasoningEffort,'ultra');
  a.request=async()=>({data:[],nextCursor:'loop'});await assert.rejects(a.models(),/pagination/);
});
