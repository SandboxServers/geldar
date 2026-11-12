import { defineMindHandler } from './types.ts';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
/** The Body's detail for an intent that reached its limits (the intent event's detail is plain text). */
const LIMIT_DETAIL = /^max_(world_ticks|block_operations)\b/;
/** Item names the Body's detail lists: lowercase words only, so nothing else gets through. */
const ITEM_LIST = /^[a-z_]+(?:, [a-z_]+){0,7}$/;

/**
 * The player's outcome of an intent that ended in `state`. The contract's wake reasons are the only
 * ends the player can be woken with: a limit ends the run as intent_run_too_long, any other failure as
 * precondition_failed. The contract has no reason for a cancelled or interrupted intent, so both wake as
 * a failure: the agent still hears that its intent is over.
 */
function endOutcome(
  state: string,
  detail: string | undefined,
): 'completed' | 'failed' | 'limit_reached' {
  if (state === 'completed') return 'completed';
  if (state === 'failed' && LIMIT_DETAIL.test(detail ?? '')) return 'limit_reached';
  return 'failed';
}

/**
 * A plain world fact for why an intent failed, rebuilt from the Body's detail with fixed templates
 * (decision 0068: no system words, no free text). Only item names that pass `ITEM_LIST` are quoted.
 * Undefined when the detail is not one of the known shapes: the player then hears the bare failure.
 */
export function failureReason(detail: string | undefined): string | undefined {
  const text = detail ?? '';
  const missing = /^missing_materials: missing (.+)$/.exec(text);
  if (missing?.[1] && ITEM_LIST.test(missing[1])) {
    return `you lack ${missing[1].replaceAll('_', ' ')}`;
  }
  if (text.startsWith('no_effect')) return 'it changed nothing';
  if (text.startsWith('missing_station')) return 'no crafting table within reach';
  if (text.startsWith('blocked: no movement')) return 'you could not move and may be stuck';
  if (text.startsWith('blocked: unstick')) return 'no way out was found without risking a fall';
  if (text.startsWith('blocked')) return 'the way was blocked';
  if (text.startsWith('not_found: no bed')) return 'no bed within reach';
  if (text.startsWith('not_possible: would drop the bot')) {
    return 'that would drop you from where you stand';
  }
  if (text.startsWith('not_found')) return 'what you looked for was not found';
  if (text.startsWith('not_possible')) return 'that was not possible right now';
  if (text.startsWith('out_of_reach') || text.startsWith('too_far')) {
    return 'too far from the block';
  }
  return undefined;
}

/** An intent's state changes: accepted starts the run, a terminal state ends it (once per intent). */
export const intentHandler = defineMindHandler('intent', (event, base, ctx) => {
  const p = event.payload;
  const prev = ctx.runs.get(event.lifeId)?.lastEndedId;
  if (p.state === 'accepted') {
    ctx.runs.set(event.lifeId, {
      wakeOn: p.wake_on ?? null,
      startedMs: base.atMs,
      lastEndedId: prev,
    });
    return [];
  }
  if (!TERMINAL_STATES.has(p.state)) return [];
  const repeat = prev !== undefined && prev === p.intent_id;
  ctx.runs.set(event.lifeId, { wakeOn: null, startedMs: null, lastEndedId: p.intent_id });
  if (repeat) return [];
  const outcome = endOutcome(p.state, p.detail);
  const reason = outcome === 'failed' ? failureReason(p.detail) : undefined;
  return [{ ...base, kind: 'intent_finished', outcome, ...(reason ? { reason } : {}) }];
});
