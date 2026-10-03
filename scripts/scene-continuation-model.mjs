// Explicit experiment routing only; never changes historical receipts or UI defaults.
export function continuationModel(original, target) {
  if (!['codex', 'deepseek'].includes(original.agent) || original.effort !== 'max') throw new Error('Unsupported original provider/effort');
  if (target !== undefined && !['gpt-6-luna', 'gpt-6-sol'].includes(target)) throw new Error('Explicit continuation target must be gpt-6-luna or gpt-6-sol');
  if (!target && original.agent === 'codex' && !['gpt-6-luna', 'gpt-6-sol'].includes(original.model)) throw new Error('Legacy Codex model disabled for new calls; select --target-model gpt-6-luna explicitly');
  const request = target ? {...original, agent: 'codex', model: target} : {...original};
  const changed = request.agent !== original.agent || request.model !== original.model;
  return {request, modelChange: changed ? {fromProvider: original.agent, fromModel: original.model, toProvider: request.agent, toModel: request.model, effort: request.effort, explicitlySelected: true, historicalReceiptsUnchanged: true} : null};
}
