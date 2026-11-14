import { PLAIN_FACT_VERBS, playerDetailText } from '@geldar/contract';
import { defineMindHandler } from './types.ts';

/**
 * An action's outcome. The fixed fields cross: the verb and reason code. A failure's cleaned `detail_text`
 * crosses too; a success's crosses only for a verb in `PLAIN_FACT_VERBS` (eat, sleep). The presenter rebuilds the text.
 */
export const actionOutcomeHandler = defineMindHandler('action_outcome', (event, base) => {
  const p = event.payload;
  const keeps = !p.ok || PLAIN_FACT_VERBS.includes(p.verb);
  const detail = keeps ? playerDetailText(p.detail_text) : undefined;
  return [
    {
      ...base,
      kind: p.ok ? 'action' : 'action_failed',
      name: p.verb,
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.intent ? { intent: true } : {}),
      ...(detail === undefined ? {} : { detail }),
    },
  ];
});
