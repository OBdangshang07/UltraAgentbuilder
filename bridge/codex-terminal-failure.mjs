// Informational receipt classification, NOT permission to submit another turn.
// Only this exact observed provider message is known. Do not infer a capacity
// enum from undocumented codexErrorInfo fields or from transport/log prose.
const capacityMessage = 'Selected model is at capacity. Please try a different model.';

/** Retain failed answer data without forwarding reasoning or commentary. */
export function codexTerminalOutput(turn) {
  const messages = Array.isArray(turn?.items) ? turn.items.filter(item => item?.type === 'agentMessage') : [];
  return {
    // Even commentary, whitespace or malformed message data prevents a claim
    // that this failed turn produced no output. Never erase this sticky fact.
    observed: messages.some(item => typeof item.text !== 'string' || item.text.length > 0),
    text: messages.filter(item => item.phase !== 'commentary' && typeof item.text === 'string').map(item => item.text).join('\n'),
  };
}

/** Caller must already have checked the exact thread/turn and real closure. */
export function codexTerminalFailure({turn, answer, outputObserved, completionSource}) {
  if (turn?.status !== 'failed' || turn.error?.message !== capacityMessage || answer !== '' || outputObserved !== false
    || !['notification', 'stored-original-turn'].includes(completionSource)) return null;
  return {version: 1, kind: 'model-capacity', rule: 'codex-capacity-exact-message-v1',
    closureSource: completionSource === 'notification' ? 'original-turn-completed-event' : 'closed-original-full-history',
    outputObserved: false};
}
