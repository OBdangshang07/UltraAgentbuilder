import test from 'node:test';
import assert from 'node:assert/strict';
import {codexTerminalFailure,codexTerminalOutput} from '../../bridge/codex-terminal-failure.mjs';

const message='Selected model is at capacity. Please try a different model.';
const args={turn:{status:'failed',error:{message}},answer:'',outputObserved:false,completionSource:'notification'};

test('capacity classification is exact and closed, without guessing provider error enums',()=>{
  for(const completionSource of ['notification','stored-original-turn']){
    assert.deepEqual(codexTerminalFailure({...args,completionSource}),{version:1,kind:'model-capacity',
      rule:'codex-capacity-exact-message-v1',closureSource:completionSource==='notification'?'original-turn-completed-event':'closed-original-full-history',outputObserved:false});
  }
  for(const status of ['completed','interrupted','inProgress',undefined])assert.equal(codexTerminalFailure({...args,turn:{...args.turn,status}}),null);
  for(const value of ['at capacity',message+' ',message+'\n',message.toLowerCase(),null,{},'429',undefined]){
    assert.equal(codexTerminalFailure({...args,turn:{status:'failed',error:{message:value,codexErrorInfo:'modelCapacity'}}}),null);
  }
  for(const change of [{answer:' '},{answer:'partial'},{answer:undefined},{outputObserved:true},{outputObserved:undefined},
    {completionSource:'timeout'},{completionSource:'systemError'},{completionSource:'transport-log'},{completionSource:undefined}]){
    assert.equal(codexTerminalFailure({...args,...change}),null);
  }
  // Unallowlisted metadata is neither retained nor interpreted as authority.
  assert.ok(!JSON.stringify(codexTerminalFailure({...args,turn:{...args.turn,error:{message,codexErrorInfo:'PRIVATE',additionalDetails:'PRIVATE'}}})).includes('PRIVATE'));
});

test('terminal output preserves failed data while commentary/reasoning cannot prove an empty turn',()=>{
  assert.deepEqual(codexTerminalOutput({items:[{type:'reasoning',text:'PRIVATE'}]}),{text:'',observed:false});
  assert.deepEqual(codexTerminalOutput({items:[{type:'agentMessage',phase:'commentary',text:'PRIVATE'}]}),{text:'',observed:true});
  assert.deepEqual(codexTerminalOutput({items:[{type:'agentMessage',phase:'final_answer',text:'{"partial":'}]}),{text:'{"partial":',observed:true});
  assert.deepEqual(codexTerminalOutput({items:[{type:'agentMessage',phase:'final_answer',text:''}]}),{text:'',observed:false});
  assert.deepEqual(codexTerminalOutput({items:[{type:'agentMessage',phase:'final_answer'}]}),{text:'',observed:true});
  assert.deepEqual(codexTerminalOutput({items:[{type:'agentMessage',phase:'final_answer',text:'first'},{type:'agentMessage',phase:'final_answer',text:'second'}]}),{text:'first\nsecond',observed:true});
});
