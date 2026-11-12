import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import type { SimEvent } from '@geldar/mcp-mock';
import { MIND_HANDLERS } from './handlers/index.ts';
import type { EventBase, MapContext, MindHandler } from './handlers/types.ts';

export { hurtText } from './handlers/damage.ts';
export { deathCause } from './handlers/death.ts';
export { failureReason } from './handlers/intent.ts';
export type { MapContext, RunState } from './handlers/types.ts';

/**
 * Maps one Mind event to the player-facing events it becomes (spec 5.15.3, the mapping table), with the
 * registered handlers in `handlers/index.ts`. Returns none for events the player does not see. `seq` is
 * the stream sequence of the message. Only fixed fields are copied: no event carries the text of the
 * Body's detail or world text.
 */
export function mapMindEvent(event: MindEvent, seq: number, ctx: MapContext): SimEvent[] {
  return mapMindEventWith(MIND_HANDLERS, event, seq, ctx);
}

/**
 * Maps one Mind event with the given handlers. The first handler whose type is the event's type maps it;
 * an event type with no handler maps to nothing.
 */
export function mapMindEventWith(
  handlers: readonly MindHandler[],
  event: MindEvent,
  seq: number,
  ctx: MapContext,
): SimEvent[] {
  const handler = handlers.find((h) => h.type === event.type);
  if (handler === undefined) return [];
  const atMs = Date.parse(event.at);
  const run = ctx.runs.get(event.lifeId);
  const base: EventBase = {
    seq,
    tick: event.tick,
    atMs: Number.isNaN(atMs) ? 0 : atMs,
    wakeOn: run?.wakeOn ?? null,
  };
  return handler.map(event, base, ctx);
}
