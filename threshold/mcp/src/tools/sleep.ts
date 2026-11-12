import type {
  McpPlayerEvent,
  PlanMessage,
  SleepResult,
  Snapshot,
  UntrustedWorldText,
} from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import { ToolError } from '@geldar/mcp-mock';
import { type FailureTracker, factEvents, placeOf } from '../failures/tracker.ts';
import type { BodyGateway, JournalStore, PlayerEventLog, SleepMarks } from '../ports.ts';
import { type ToolCall, WORLD_TEXT_NOTE } from './look.ts';

/** The text of a sleep after which the place, health, belongings and events are as they were. */
export const NOTHING_NEW =
  'Nothing has changed since you last slept: same place, same belongings, same health, no new events.';

/** The most events a `sleep` result lists, and the most speech lines it carries. */
export const SLEEP_EVENT_LIMIT = 100;
export const SLEEP_SPEECH_LIMIT = 40;

export interface SleepDeps {
  body: BodyGateway;
  events: PlayerEventLog;
  journal: JournalStore;
  marks: SleepMarks;
  now: () => number;
  /** Repeated-failure memory; without it a sleep states no repeats and every sleep is journalled. */
  failures?: FailureTracker;
  /** Builds the sleep plan for a life from its snapshot (the animus plan builder in the server). */
  buildSleepPlan: (lifeId: string, snapshot: Snapshot) => PlanMessage;
}

/** The fixed text of each event type; the words of others go only to `untrusted_world_text`. */
const EVENT_TEXT: Record<McpPlayerEvent['type'], string> = {
  speech_to_me: 'Someone spoke to you.',
  conversation_digest: 'Some talk went on nearby.',
  damage: 'You were hurt.',
  death: 'You died, and woke at the spawn with nothing.',
  agent_approached: 'Someone came near you.',
  proposal: 'A proposal was put forward.',
  day_night: 'The day turned.',
  intent_finished: 'A task you set finished.',
  action: 'An action of yours worked.',
  action_failed: 'An action of yours failed.',
  reflex: 'Your body acted on its own.',
  wake: 'You wake with nothing underway.',
  hurt: 'Something hurt you.',
  heard_sound: 'You heard a sound.',
};

/** Maps a sim event kind to a player event type; unknown kinds are not digested. */
const EVENT_TYPE: Record<string, McpPlayerEvent['type']> = {
  speech: 'speech_to_me',
  conversation_digest: 'conversation_digest',
  damage: 'damage',
  death: 'death',
  agent_approached: 'agent_approached',
  proposal: 'proposal',
  day_night: 'day_night',
  intent_finished: 'intent_finished',
  reflex: 'reflex',
};

type Speech = NonNullable<UntrustedWorldText['speech']>;

/** Turns the events since the mark into the digest: fixed text, counts, and the speech lines. */
function digest(events: SimEvent[]): {
  events: McpPlayerEvent[];
  counts: Record<string, number>;
  speech: Speech;
} {
  const mapped: McpPlayerEvent[] = [];
  const speech: Speech = [];
  const counts: Record<string, number> = {};
  for (const event of events) {
    const type = EVENT_TYPE[event.kind];
    if (type === undefined) continue;
    mapped.push({ seq: event.seq, type, tick: event.tick, text: EVENT_TEXT[type] });
    counts[type] = (counts[type] ?? 0) + 1;
    if (type === 'speech_to_me')
      speech.push({ from: event.from ?? 'someone', text: event.text ?? '' });
  }
  return { events: mapped, counts, speech: speech.slice(-SLEEP_SPEECH_LIMIT) as Speech };
}

/**
 * `sleep`: the sleep plan goes to the Body and is acknowledged; the events since the mark are
 * digested into counts and a fixed journal line; the mark moves to the newest event read. A
 * refused plan throws and leaves the mark where it was. Free.
 */
export async function sleepTool(deps: SleepDeps, call: ToolCall): Promise<SleepResult> {
  const snapshot = await deps.body.snapshot(call.lifeId);
  const day = snapshot.world_time.day;
  const mark = await deps.marks.read(call.lifeId);
  const ack = await deps.body.submitPlan(call.lifeId, deps.buildSleepPlan(call.lifeId, snapshot));
  if (!ack.accepted) {
    // The Body's detail is free text: it never leaves the server, so the player gets a fixed message.
    throw new ToolError('sleep_refused', 'Your body would not sleep.');
  }
  const { events, dropped } = await deps.events.since(call.lifeId, mark.cursor);
  const digested = digest(events);
  const total = digested.events.length;
  const cursor = events.at(-1)?.seq ?? mark.cursor;
  const tracker = deps.failures;
  const facts = tracker?.observe(call.lifeId, events, placeOf(snapshot), deps.now()) ?? [];
  const unchanged = tracker?.sameAsLastSleep(call.lifeId, snapshot) === true;
  const quiet = unchanged && events.length === 0 && dropped === 0;
  // A sleep with nothing new is no journal thought: the journal keeps only what happened.
  if (!quiet) {
    await deps.journal.append(
      call.lifeId,
      `Day ${day}: asleep. ${total} events since the last sleep, ${dropped} lost before them.`,
      deps.now(),
    );
  }
  await deps.marks.write(call.lifeId, { lastSleepDay: day, cursor });
  const shown = digested.events.slice(-SLEEP_EVENT_LIMIT);
  if (quiet) {
    shown.push({ seq: Math.max(1, cursor), type: 'wake', tick: 0, text: NOTHING_NEW });
  }
  shown.push(...factEvents(facts, cursor, 0));
  return {
    day,
    days_since_sleep: 0,
    events: shown,
    event_counts: digested.counts,
    untrusted_world_text: digested.speech.length > 0 ? { speech: digested.speech } : {},
    note: WORLD_TEXT_NOTE,
  };
}
