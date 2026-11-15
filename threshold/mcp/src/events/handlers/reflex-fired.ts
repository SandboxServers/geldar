import { defineMindHandler } from './types.ts';

/**
 * Every reflex firing is news: the body's own moves (a retreat, a fall stop, an unstick) changed where
 * the agent is, so each one reaches the player as a fixed line naming the reflex.
 */
const RESULTS: readonly string[] = ['handled', 'failed', 'abandoned'];

/** The contract nests the result under outcome (ReflexFiredPayload.outcome.result); anything outside its enum is unknown. */
const outcomeResult = (outcome: unknown): string => {
  const r =
    typeof outcome === 'object' && outcome !== null
      ? (outcome as { result?: unknown }).result
      : undefined;
  return typeof r === 'string' && RESULTS.includes(r) ? r : 'unknown';
};

export const reflexFiredHandler = defineMindHandler('reflex_fired', (event, base) => {
  const p = event.payload as { name?: unknown; outcome?: unknown; trigger?: unknown };
  const t = p.trigger;
  const trigger =
    typeof t === 'object' && t !== null && !Array.isArray(t)
      ? (t as Record<string, string | number | boolean | null>)
      : undefined;
  return [
    {
      ...base,
      kind: 'reflex',
      name: typeof p.name === 'string' ? p.name : 'unknown',
      result: outcomeResult(p.outcome),
      ...(trigger ? { trigger } : {}),
    },
  ];
});
