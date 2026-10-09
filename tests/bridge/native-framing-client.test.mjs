import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {makeNativeEvidenceClientFixtures} from '../../scripts/native-evidence-client-fixtures.mjs';
import {MAX_NATIVE_FRAMING_LENGTH,validateEvidenceRequest} from '../../bridge/native-evidence.mjs';
import {hash} from '../../src/generation/compiler.mjs';

test('actual representative camera producer retains framing in the native request consumed by Java',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-framing-client-')),{directory,request,basis}=await makeNativeEvidenceClientFixtures(root);
 assert.equal(request.views.length,8);assert.equal(request.dimensions.height,224);
 assert.deepEqual(request.views,basis.views);assert.match(request.views.find(v=>v.purpose==='typical-floor').framing,/Saved staged representative officeZone/);
 assert.equal(validateEvidenceRequest(request),request);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'request.json'),'utf8')),request);
 const changed=structuredClone(request);changed.views.find(v=>v.framing).framing+=' Different framing.';
 assert.throws(()=>validateEvidenceRequest(changed),/identity/);
 delete changed.requestHash;changed.requestHash=hash(changed);assert.notEqual(changed.requestHash,request.requestHash);
 assert.equal(validateEvidenceRequest(changed),changed);
 const noFraming=structuredClone(request);for(const view of noFraming.views)delete view.framing;
 delete noFraming.requestHash;noFraming.requestHash=hash(noFraming);assert.equal(validateEvidenceRequest(noFraming),noFraming);
 const values=[null,true,1,{},[],'','  ','x'.repeat(MAX_NATIVE_FRAMING_LENGTH+1)];
 for(let code=0;code<160;code++)if(code<32||code>=127)values.push('Description'+String.fromCharCode(code));
 for(const value of values){const bad=structuredClone(request);bad.views[0].framing=value;delete bad.requestHash;bad.requestHash=hash(bad);assert.throws(()=>validateEvidenceRequest(bad),/framing/);}
 const maximum=structuredClone(request);maximum.views[0].framing='x'.repeat(MAX_NATIVE_FRAMING_LENGTH);delete maximum.requestHash;maximum.requestHash=hash(maximum);
 assert.equal(validateEvidenceRequest(maximum),maximum);
});

