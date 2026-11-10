import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import { mindEventSubjects, normaliseEvent } from '@geldar/animus/src/link/mind-event.ts';
import { validateDayNightPayload, validateWorldEvent, type WorldEvent } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import type { PlayerEventLog } from '../ports.ts';
import type { DayPhase } from './day-night.ts';
import { type MapContext, mapMindEvent } from './mapper.ts';

/** The subjects the consumer reads: the Mind's event types plus `sovereign_call` and `day_night`. */
export function streamSubjects(shard: string): string[] {
  return [
    ...mindEventSubjects(shard),
    `geldar.${shard}.sovereign_call`,
    `geldar.${shard}.day_night`,
  ];
}

/** The start time of the consumer's replay: `replayMinutes` before now, as an ISO string. */
export function replayStartIso(nowMs: number, replayMinutes: number): string {
  return new Date(nowMs - replayMinutes * 60_000).toISOString();
}

/** What the stream handler reads and writes. */
export interface StreamContext {
  map: MapContext;
  log: PlayerEventLog;
  /** Every life whose log a day_night event fans out to. */
  lives: () => readonly string[] | Promise<readonly string[]>;
  /** The speech identity of one life, for its own mapping; `map.identity` is used when absent. */
  identityOf?: (lifeId: string) => Promise<SpeechIdentity>;
}

/** Counts of messages the handler set aside. */
export interface StreamCounters {
  /** Messages that were not valid events; they are dropped and counted. */
  invalid: number;
}

/**
 * Handles one stream message at its stream sequence. The Body's events are untrusted: every message
 * is checked against the contract envelope first, and an invalid one is counted and dropped without
 * a throw. The raw body is already parsed: a body that is not JSON never gets here (the stream loop in
 * cli.ts counts it). A store error (`lives()` or a log append) throws to that loop, which retries the
 * message and drops it after three tries. A Mind event goes to its life's log as the mapper maps it; a `day_night` event fans out
 * to every life. A `sovereign_call` is not a player event, so it is skipped.
 */
export async function handleStreamMessage(
  seq: number,
  raw: unknown,
  ctx: StreamContext,
  counters: StreamCounters,
): Promise<void> {
  const envelope = validateWorldEvent(raw);
  if (!envelope.ok) {
    counters.invalid++;
    return;
  }
  const world = envelope.value;
  if (world.type === 'day_night') {
    const event = dayNightEvent(seq, world);
    if (event === null) counters.invalid++;
    else for (const lifeId of await ctx.lives()) await ctx.log.append(lifeId, event);
    return;
  }
  if (world.type === 'sovereign_call') return;
  const n = normaliseEvent(raw);
  if (n.status === 'invalid') {
    counters.invalid++;
    return;
  }
  if (n.status === 'ignored') return;
  const lifeId = n.event.lifeId;
  const identity =
    ctx.identityOf !== undefined && lifeId !== '' ? await ctx.identityOf(lifeId) : ctx.map.identity;
  for (const event of mapMindEvent(n.event, seq, { ...ctx.map, identity })) {
    if (lifeId !== '') await ctx.log.append(lifeId, event);
  }
}

/** The `day_night` event as a sim event, or null when its payload fails the contract. */
function dayNightEvent(seq: number, world: WorldEvent): SimEvent | null {
  const payload = validateDayNightPayload(world.payload);
  if (!payload.ok) return null;
  const atMs = Date.parse(world.at);
  return {
    seq,
    tick: payload.value.tick,
    atMs: Number.isNaN(atMs) ? 0 : atMs,
    kind: 'day_night',
    name: payload.value.phase as DayPhase,
    wakeOn: null,
  };
}
