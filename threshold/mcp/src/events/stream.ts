import { mindEventSubjects, normaliseEvent } from '@geldar/animus/src/link/mind-event.ts';
import type { SimEvent } from '@geldar/mcp-mock';
import type { PlayerEventLog } from '../ports.ts';
import type { DayPhase } from './day-night.ts';
import { type MapContext, mapMindEvent } from './mapper.ts';

const DAY_PHASES: readonly string[] = ['dawn', 'day', 'dusk', 'night'];

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
  lives: () => readonly string[];
}

/** Counts of messages the handler set aside. */
export interface StreamCounters {
  /** Messages that were not valid events; they are dropped and counted. */
  invalid: number;
}

/**
 * Handles one stream message at its stream sequence. A Mind event goes to its life's log as the
 * mapper maps it; a `day_night` event fans out to every life. Invalid messages are counted and
 * dropped. A `sovereign_call` is not a player event, so it is skipped.
 */
export async function handleStreamMessage(
  seq: number,
  raw: unknown,
  ctx: StreamContext,
  counters: StreamCounters,
): Promise<void> {
  const type = (raw as { type?: unknown } | null)?.type;
  if (type === 'day_night') {
    const event = dayNightEvent(seq, raw);
    if (event === null) counters.invalid++;
    else for (const lifeId of ctx.lives()) await ctx.log.append(lifeId, event);
    return;
  }
  if (type === 'sovereign_call') return;
  const n = normaliseEvent(raw);
  if (n.status === 'invalid') {
    counters.invalid++;
    return;
  }
  if (n.status === 'ignored') return;
  for (const event of mapMindEvent(n.event, seq, ctx.map)) {
    if (n.event.lifeId !== '') await ctx.log.append(n.event.lifeId, event);
  }
}

/** The `day_night` message as a sim event, or null when its payload is not a phase and a tick. */
function dayNightEvent(seq: number, raw: unknown): SimEvent | null {
  const msg = raw as { payload?: { phase?: unknown; tick?: unknown }; at?: unknown };
  const phase = msg.payload?.phase;
  const tick = msg.payload?.tick;
  if (typeof phase !== 'string' || !DAY_PHASES.includes(phase)) return null;
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) return null;
  const atMs = typeof msg.at === 'string' ? Date.parse(msg.at) : Number.NaN;
  return {
    seq,
    tick,
    atMs: Number.isNaN(atMs) ? 0 : atMs,
    kind: 'day_night',
    name: phase as DayPhase,
    wakeOn: null,
  };
}
