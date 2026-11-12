import type { SimEvent } from '@geldar/mcp-mock';
import { defineMindHandler } from './types.ts';

/**
 * The internal entry is what `say` reads for its confirmation. No player view shows it. A plan with no
 * intent and actions that is none ends at once: the player sees its end as an intent that finished.
 */
export const planResultHandler = defineMindHandler('plan_result', (event, base) => {
  const p = event.payload;
  const internal: SimEvent = {
    ...base,
    kind: 'plan_result',
    thought_id: p.thought_id,
    said: p.said,
  };
  if (p.intent !== 'none' || p.actions.length === 0) return [internal];
  return [
    internal,
    {
      ...base,
      kind: 'intent_finished',
      outcome: p.failed_at === null ? 'completed' : 'failed',
    },
  ];
});
