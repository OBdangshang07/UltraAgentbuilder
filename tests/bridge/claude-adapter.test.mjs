import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ClaudeAdapter,claudeArguments,parseClaudeResult} from '../../bridge/claude-adapter.mjs';
import {sampleSpec} from '../../src/generation/sample.mjs';
import {compileSpec} from '../../src/generation/compiler.mjs';

test('Claude data-only flags disable tools, MCP, customizations and fallback',()=>{
  const args=claudeArguments('user-selected-model');assert.equal(args[args.indexOf('--tools')+1],'');
  for(const flag of ['--safe-mode','--strict-mcp-config','--disable-slash-commands','--no-chrome','--no-session-persistence','--json-schema'])assert.ok(args.includes(flag));
  assert.ok(!args.includes('--dangerously-skip-permissions'));assert.ok(!args.includes('--fallback-model'));assert.throws(()=>claudeArguments(''));
});
test('Claude structured result compiles through the same verified kernel',()=>{
  const r=parseClaudeResult(JSON.stringify({subtype:'success',structured_output:sampleSpec(),session_id:'fixture',total_cost_usd:0}));assert.equal(compileSpec(r.spec).manifest.setCount,1937);
  assert.throws(()=>parseClaudeResult('{"is_error":true}'));assert.throws(()=>parseClaudeResult('not json'));
});
test('Claude cancellation interrupts owned subprocess and status redacts account fields',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voxel-claude-fixture-')),cli=path.join(dir,'claude.exe');await fs.writeFile(cli,'fixture only');
  let killed=false,startedResolve;const started=new Promise(r=>startedResolve=r);
  const spawnProcess=(_file,args)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{killed=true;queueMicrotask(()=>child.emit('close',1));};
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      if(args.includes('--print')){startedResolve();return;}
      child.stdout.end(args.includes('--help')?'--safe-mode --json-schema --tools --strict-mcp-config --no-session-persistence':args.includes('--version')?'fixture-1':JSON.stringify({loggedIn:true,email:'must-not-leak@example.invalid',token:'must-not-leak'}));child.emit('close',0);
    }));return child;
  };
  const adapter=new ClaudeAdapter({claudePath:cli,spawnProcess});const status=await adapter.status();assert.equal(status.available,true);assert.ok(!JSON.stringify(status).includes('must-not-leak'));assert.deepEqual(await adapter.models(),[]);
  const controller=new AbortController();const running=adapter.generate({prompt:'fixture',model:'user-selected-model',signal:controller.signal});await started;controller.abort();await assert.rejects(running,/cancelled/);assert.ok(killed);adapter.close();
});
