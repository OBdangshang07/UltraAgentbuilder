// Explicit authorization for FUTURE stability tasks; never rewrites an already
// running job's protocol or the earlier 3 + 23 replacement ledger.
export function liveModelSelection(args){
 const luna=args.includes('--codex-luna-max'),sol=args.includes('--codex-sol-max'),ongoing=args.includes('--authorized-stability-goal-20260926');
 if(luna&&sol)throw new Error('Select exactly one authorized model');
 if(sol&&!ongoing)throw new Error('Sol tests require the continuing stability-goal authorization');
 if(ongoing&&(!args.includes('--stability-design-first')||!luna&&!sol||args.includes('--replace-cancelled-ledger')))throw new Error('Continuing authorization is for new Codex stability jobs, not a budget rewrite');
 return {provider:luna||sol?'codex':'deepseek',model:sol?'gpt-6-sol':luna?'gpt-6-luna':'deepseek-flash',effort:'max',...(ongoing?{goalAuthorization:{version:1,authorizedOn:'2026-09-26',models:['gpt-6-luna','gpt-6-sol'],preferredModel:'gpt-6-luna',deepseekAllowed:false,scope:'Continuing stability development and real end-to-end tests; original ledgers preserved.',perTaskMaximumCalls:26,uncertainCallsCount:true,unknownOutcomeRetries:0}}:{})};
}
