import {
  maintenanceSubject,
  validateDayNightPayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import type { SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';
import { mindEventSubjects, normaliseEvent } from '@geldar/player-core/src/link/mind-event.ts';
import type { DeathMarks, PlayerEventLog } from '../ports.ts';
import type { DayPhase } from './day-night.ts';
import { maintenanceEvent, parseMaintenanceNotice } from './maintenance-notice.ts';
import { type MapContext, mapMindEvent } from './mapper.ts';

/**
 * The subjects the consumer reads: the Mind's event types plus `sovereign_call`, `day_night` and the
 * maintenance notice (CD-1), which is not a WorldEvent and is told apart by its contract.
 */
export function streamSubjects(shard: string): string[] {
  return [
    ...mindEventSubjects(shard),
    `geldar.${shard}.sovereign_call`,
    `geldar.${shard}.day_night`,
    maintenanceSubject(shard),
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
  /** Counts each death event once (migration 0023); a redelivered death is recorded once. */
  deaths?: Pick<DeathMarks, 'recordDeath'>;
  /** Told the day and tick of every valid WorldEvent, so a sovereign_call envelope can be stamped. */
  clock?: { observe(event: { world_day: number; world_tick: number }): void };
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
 * message with a delay and drops it after four tries. A Mind event goes to its life's log as the mapper
 * maps it; a `day_night` event fans out to every life. A `sovereign_call` is not a player event, so it
 * is skipped.
 */
export async function handleStreamMessage(
  seq: number,
  raw: unknown,
  ctx: StreamContext,
  counters: StreamCounters,
): Promise<void> {
  const envelope = validateWorldEvent(raw);
  if (!envelope.ok) {
    // Not a WorldEvent: it is a maintenance notice if the contract accepts it, else invalid. The
    // notice fans out to every life, as day_night does, so a redelivery at this seq is one line each.
    const notice = parseMaintenanceNotice(raw);
    if (notice === null) {
      counters.invalid++;
      return;
    }
    const event = maintenanceEvent(seq, notice);
    for (const lifeId of await ctx.lives()) await ctx.log.append(lifeId, event);
    return;
  }
  const world = envelope.value;
  ctx.clock?.observe(world);
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
  // Recorded before the log append: a retry of this message after a failed append records it again,
  // which the store's event id makes a no-op.
  if (n.event.type === 'death' && lifeId !== '' && ctx.deaths !== undefined) {
    await ctx.deaths.recordDeath(lifeId, n.event.eventId, n.event.day);
  }
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
