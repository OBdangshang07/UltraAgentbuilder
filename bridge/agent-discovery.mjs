const names={codex:'Codex',claude:'Claude Code',deepseek:'DeepSeek Harness'};
// Progressive, single-flight, read-only status discovery. Does not list models or submit generation.
export class AgentDiscovery {
  constructor(agentFor,{timeoutMs=12000,ttlMs=60000}={}){this.agentFor=agentFor;this.timeoutMs=timeoutMs;this.ttlMs=ttlMs;this.entries=new Map();this.closed=false;}
  invalidate(id){const old=this.entries.get(id);if(old){clearTimeout(old.timer);old.controller.abort();}this.entries.delete(id);}
  snapshot(refresh=false){
    if(this.closed)throw new Error('Discovery closed');
    for(const id of Object.keys(names)){
      let entry=this.entries.get(id);
      // Even a timed-out probe remains single-flight until its own adapter settles.
      if(!entry||!entry.pending&&(refresh||Date.now()-entry.at>this.ttlMs)){
        entry={at:Date.now(),pending:true,controller:new AbortController(),value:{id,name:names[id],available:false,state:'detecting'}};this.entries.set(id,entry);
        const current=()=>!this.closed&&this.entries.get(id)===entry;
        entry.timer=setTimeout(()=>{if(current()){entry.value={id,name:names[id],available:false,state:'timeout',note:'Detection timed out. Other Agents remain usable; no generation was submitted.'};entry.controller.abort();}},this.timeoutMs);entry.timer.unref?.();
        Promise.resolve().then(()=>this.agentFor(id).status({signal:entry.controller.signal})).then(result=>{
          if(current()&&!entry.controller.signal.aborted){
            // Never relay account identifiers, paths, tokens, or raw CLI error text in an automatic scan.
            const state=result.available?(id==='deepseek'?'configured':'ready'):['login-required','credential-required','not-found','unsupported'].includes(result.state)?result.state:'unavailable';
            entry.value={id,name:names[id],available:result.available===true,state,experimental:id==='claude',advisory:id==='deepseek'};
          }
        }).catch(()=>{if(current()&&!entry.controller.signal.aborted)entry.value={id,name:names[id],available:false,state:'unavailable'};}).finally(()=>{clearTimeout(entry.timer);entry.pending=false;entry.at=Date.now();});
      }
    }
    const agents=Object.keys(names).map(id=>this.entries.get(id).value);
    return {agents,complete:agents.every(a=>a.state!=='detecting'),generationSubmitted:false};
  }
  close(){this.closed=true;for(const e of this.entries.values()){clearTimeout(e.timer);e.controller.abort();}}
}
