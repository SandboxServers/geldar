import type { SimEvent } from '@geldar/mcp-mock';
import type { EventBase, MapContext } from './types.ts';
import { defineMindHandler } from './types.ts';

/** The damage event (or the reflex line) is the news; these wakes repeat it with no amount. */
const DAMAGE_WAKES = new Set(['unexpected_damage', 'reflex_danger']);
const NEW_AGENT = /^new_agent_within_(\d+)$/;

function mapWake(
  reason: string,
  intentId: string | null,
  base: EventBase,
  lifeId: string,
  ctx: MapContext,
): SimEvent[] {
  if (DAMAGE_WAKES.has(reason)) return [];
  // A restarted Body with nothing to resume: the player never had an intent, so no intent ended.
  if (reason === 'no_plan' && intentId === null) return [{ ...base, kind: 'wake' }];
  if (reason === 'no_plan') {
    ctx.runs.set(lifeId, { wakeOn: null, startedMs: null });
    return [{ ...base, kind: 'intent_finished', outcome: 'failed' }];
  }
  if (reason === 'limit_reached') {
    // The intent's own terminal event normally reported this end: the same intent is no second end.
    const run = ctx.runs.get(lifeId);
    if (intentId !== null && run?.lastEndedId === intentId) return [];
    ctx.runs.set(lifeId, { wakeOn: null, startedMs: null, lastEndedId: intentId ?? undefined });
    return [{ ...base, kind: 'intent_finished', outcome: 'limit_reached' }];
  }
  const near = NEW_AGENT.exec(reason);
  // An agent coming close is only news while a running intent lists it in wake_on.
  if (near !== null && base.wakeOn !== null) {
    return [{ ...base, kind: 'agent_approached', distance: Number(near[1]) }];
  }
  return [];
}

export const wakeHandler = defineMindHandler('wake', (event, base, ctx) =>
  mapWake(event.payload.reason, event.payload.intent_id ?? null, base, event.lifeId, ctx),
);
