// FREE SYNTHETIC HTTP test observer only; not bundled production policy.
// A progressing 17-call Ultra fixture must not be cancelled by an arbitrary
// three-minute total wait. Remain bounded by real progress AND a fixed ceiling.
export function syntheticJointTaskWait({clock=Date.now,noProgressMs=180000,maximumMs=900000}={}){
  if(typeof clock!=='function'||!Number.isSafeInteger(noProgressMs)||noProgressMs<1
    ||!Number.isSafeInteger(maximumMs)||maximumMs<noProgressMs||maximumMs>900000)throw Error('Bounded synthetic wait budgets required');
  const started=clock();if(!Number.isSafeInteger(started)||started<0)throw Error('Synthetic observer clock required');
  let lastClock=started,progressAt=started,fingerprint=null,reason=null;
  function now(){const n=clock();if(!Number.isSafeInteger(n)||n<lastClock){reason??='clock-invalid';return lastClock;}lastClock=n;return n;}
  function snapshot(){
    const n=now();if(n-started>=maximumMs)reason??='absolute-test-budget';else if(n-progressAt>=noProgressMs)reason??='no-observed-progress';
    return {elapsedMs:n-started,noProgressMs:n-progressAt,maximumMs,stallBudgetMs:noProgressMs,reason};
  }
  function observe(status,{syntheticCalls=0,uploadedNativeRequests=0}={}){
    const n=now();if(reason!==null)return snapshot();
    const next=JSON.stringify({state:status?.state,stageEventsObserved:status?.stageEventsObserved,reservedCalls:status?.reservedCalls,
      nativeEvidence:status?.nativeEvidence,candidateHash:status?.candidate?.candidateHash,syntheticCalls,uploadedNativeRequests});
    if(next!==fingerprint){fingerprint=next;progressAt=n;}return snapshot();
  }
  return Object.freeze({observe,snapshot,expired:()=>snapshot().reason!==null});
}
