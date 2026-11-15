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
import { type PendingSleep, type PendingSleeps, submitPending } from './sleep-completion.ts';

/** The text of a sleep the Body accepted: it is not finished, so the mark and journal wait for it. */
export const SLEEP_NOT_FINISHED = 'Your body is going to sleep. The sleep has not finished.';

/** The most events a `sleep` result lists, and the most speech lines it carries. */
export const SLEEP_EVENT_LIMIT = 100;
export const SLEEP_SPEECH_LIMIT = 40;

/** The sleep plan has one action, the sleep, at index 0. */
const SLEEP_ACTION = 0;

export interface SleepDeps {
  body: BodyGateway;
  events: PlayerEventLog;
  journal: JournalStore;
  marks: SleepMarks;
  now: () => number;
  /** Repeated-failure memory; without it a sleep states no repeats and every sleep is journalled. */
  failures?: FailureTracker;
  /** Accepted sleeps awaiting their outcome: a sleep registers here before its plan is sent (decision 0227). */
  pending: PendingSleeps;
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
 * The entry of an `act` sleep. `act` consumes no events: the cursor stays at the stored mark, so no
 * event the agent never saw is digested, and the journal line carries no counts (decision 0227).
 */
export async function actSleepEntry(
  marks: Pick<SleepMarks, 'read'>,
  lifeId: string,
  snapshot: Snapshot,
): Promise<Omit<PendingSleep, 'action'>> {
  const day = snapshot.world_time.day;
  const mark = await marks.read(lifeId);
  return { day, cursor: mark.cursor, journal: `Day ${day}: asleep.` };
}

/**
 * `sleep`: the sleep plan goes to the Body and is acknowledged. Every read happens before the plan is
 * sent, and the pending entry is registered before the send, so a plan_result that arrives during the
 * submit still settles it. A refused or failed submit drops the entry. The mark and the journal line
 * wait for the plan to complete. Free.
 */
export async function sleepTool(deps: SleepDeps, call: ToolCall): Promise<SleepResult> {
  const snapshot = await deps.body.snapshot(call.lifeId);
  const day = snapshot.world_time.day;
  const mark = await deps.marks.read(call.lifeId);
  const { events, dropped } = await deps.events.since(call.lifeId, mark.cursor);
  const digested = digest(events);
  const cursor = events.at(-1)?.seq ?? mark.cursor;
  const unchanged = deps.failures?.sameAsLastSleep(call.lifeId, snapshot) === true;
  // A sleep with nothing new is no journal thought: the journal keeps only what happened.
  const quiet = unchanged && events.length === 0 && dropped === 0;
  const journal = quiet
    ? null
    : `Day ${day}: asleep. ${digested.events.length} events since the last sleep, ${dropped} lost before them.`;
  const plan = deps.buildSleepPlan(call.lifeId, snapshot);
  deps.pending.add(call.lifeId, plan.thought_id, { day, cursor, action: SLEEP_ACTION, journal });
  const ack = await submitPending(deps.pending, call.lifeId, plan.thought_id, () =>
    deps.body.submitPlan(call.lifeId, plan),
  );
  if (!ack.accepted) {
    // The Body's detail is free text: it never leaves the server, so the player gets a fixed message.
    throw new ToolError('sleep_refused', 'Your body would not sleep.');
  }
  deps.failures?.recordSleep(call.lifeId, snapshot);
  const facts = deps.failures?.observe(call.lifeId, events, placeOf(snapshot), deps.now()) ?? [];
  // The sleep-not-finished event and the facts take their slots first; the newest digest events fill
  // the rest, so the list never exceeds the limit.
  const factList = factEvents(facts, cursor, 0);
  const room = Math.max(0, SLEEP_EVENT_LIMIT - 1 - factList.length);
  const shown = room === 0 ? [] : digested.events.slice(-room);
  shown.push({ seq: Math.max(1, cursor), type: 'wake', tick: 0, text: SLEEP_NOT_FINISHED });
  shown.push(...factList);
  return {
    day,
    days_since_sleep: day - mark.lastSleepDay,
    events: shown,
    event_counts: digested.counts,
    untrusted_world_text: digested.speech.length > 0 ? { speech: digested.speech } : {},
    note: WORLD_TEXT_NOTE,
  };
}
