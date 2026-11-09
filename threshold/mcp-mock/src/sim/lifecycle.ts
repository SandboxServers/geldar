import type {
  JournalInput,
  JournalResult,
  LookResult,
  SleepResult,
  StatusResult,
} from '@geldar/contract';
import type { ToolContext } from '../registry.ts';
import { JOURNAL_LIMIT, type SimHub } from './hub.ts';
import {
  dayAt,
  fitResult,
  snapshotOf,
  toPlayerEvents,
  WORLD_TEXT_NOTE,
  worldText,
} from './present.ts';

/** The most events a `sleep` result lists. */
const SLEEP_EVENTS = 100;
/** The most speech lines `look` shows. */
const LOOK_SPEECH = 40;

function daysSinceSleep(hub: SimHub, playerId: string, tick: number): number {
  return dayAt(hub.scenario, tick) - hub.life(playerId).lastSleepDay;
}

/** `look`: a snapshot and the last heard lines. Free; consumes nothing. */
export function lookTool(hub: SimHub, ctx: ToolContext): LookResult {
  const sim = hub.player(ctx.playerId);
  const speech = sim.log
    .since(0)
    .events.filter((e) => e.kind === 'speech')
    .slice(-LOOK_SPEECH);
  return fitResult({
    snapshot: snapshotOf(sim, hub.scenario, daysSinceSleep(hub, ctx.playerId, sim.tick)),
    untrusted_world_text: worldText(speech),
    note: WORLD_TEXT_NOTE,
  });
}

/** `status`: budget, age and sleep, and the shard's laws as sign lines. */
export function statusTool(hub: SimHub, ctx: ToolContext): StatusResult {
  const sim = hub.player(ctx.playerId);
  return {
    budget_remaining_thoughts: sim.budget,
    days_alive: dayAt(hub.scenario, sim.tick) - hub.scenario.character.born_day,
    days_since_sleep: daysSinceSleep(hub, ctx.playerId, sim.tick),
    untrusted_world_text: worldText([], {
      signs: hub.scenario.laws.map((l) => `${l.rule}: ${JSON.stringify(l.value)}`),
    }),
    note: WORLD_TEXT_NOTE,
  };
}

/** `journal`: appends to the player's journal and keeps the last 8192 characters. */
export function journalTool(hub: SimHub, ctx: ToolContext, input: JournalInput): JournalResult {
  const life = hub.life(ctx.playerId);
  const joined = life.journal === '' ? input.text : `${life.journal}\n${input.text}`;
  life.journal = joined.slice(-JOURNAL_LIMIT);
  return { ok: true, mirrored_chars: Math.min(input.text.length, JOURNAL_LIMIT) };
}

/**
 * `sleep`: cancels the running intent, resets the sleep clock, and reports the events and speech
 * since the last sleep along with the journal.
 */
export function sleepTool(hub: SimHub, ctx: ToolContext): SleepResult {
  const sim = hub.player(ctx.playerId);
  const life = hub.life(ctx.playerId);
  sim.cancelIntent();
  const since = sim.log.since(life.sleepMark).events;
  const all = toPlayerEvents(since);
  const counts: Record<string, number> = {};
  for (const e of all) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const day = dayAt(hub.scenario, sim.tick);
  life.lastSleepDay = day;
  const result: SleepResult = {
    day,
    days_since_sleep: 0,
    events: all.slice(-SLEEP_EVENTS),
    event_counts: counts,
    untrusted_world_text: worldText(since, { book: { title: 'journal', text: life.journal } }),
    note: WORLD_TEXT_NOTE,
  };
  life.sleepMark = sim.log.lastSeq();
  return fitResult(result);
}
