import { defineMindHandler } from './types.ts';

/** An action's outcome. Only the fixed fields cross: the verb and reason code. The presenter rebuilds the text. */
export const actionOutcomeHandler = defineMindHandler('action_outcome', (event, base) => {
  const p = event.payload;
  return [
    {
      ...base,
      kind: p.ok ? 'action' : 'action_failed',
      name: p.verb,
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.intent ? { intent: true } : {}),
    },
  ];
});
