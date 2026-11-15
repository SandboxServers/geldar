import { defineMindHandler } from './types.ts';

/**
 * Every reflex firing is news: the body's own moves (a retreat, a fall stop, an unstick) changed where
 * the agent is, so each one reaches the player as a fixed line naming the reflex.
 */
const RESULTS: readonly string[] = ['handled', 'failed', 'abandoned'];

const enumResult = (v: unknown): string | undefined =>
  typeof v === 'string' && RESULTS.includes(v) ? v : undefined;

/**
 * The contract nests the result under outcome (ReflexFiredPayload.outcome.result). A top-level result is
 * read only when outcome gives none (the mapper fixtures still use that shape); anything else is unknown.
 */
const resultOf = (p: { outcome?: unknown; result?: unknown }): string => {
  const outcome =
    typeof p.outcome === 'object' && p.outcome !== null
      ? (p.outcome as { result?: unknown }).result
      : undefined;
  return enumResult(outcome) ?? enumResult(p.result) ?? 'unknown';
};

export const reflexFiredHandler = defineMindHandler('reflex_fired', (event, base) => {
  const p = event.payload as {
    name?: unknown;
    result?: unknown;
    outcome?: unknown;
    trigger?: unknown;
  };
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
      result: resultOf(p),
      ...(trigger ? { trigger } : {}),
    },
  ];
});
