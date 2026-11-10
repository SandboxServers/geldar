import type {
  McpPlayerEvent,
  PlanMessage,
  SleepResult,
  Snapshot,
  UntrustedWorldText,
} from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import { ToolError } from '@geldar/mcp-mock';
import type { BodyGateway, JournalStore, PlayerEventLog, SleepMarks } from '../ports.ts';
import { type ToolCall, WORLD_TEXT_NOTE } from './look.ts';

/** The most events a `sleep` result lists, and the most speech lines it carries. */
export const SLEEP_EVENT_LIMIT = 100;
export const SLEEP_SPEECH_LIMIT = 40;

export interface SleepDeps {
  body: BodyGateway;
  events: PlayerEventLog;
  journal: JournalStore;
  marks: SleepMarks;
  now: () => number;
  /** Builds the sleep plan for a life from its snapshot (the animus plan builder in the server). */
  buildSleepPlan: (lifeId: string, snapshot: Snapshot) => PlanMessage;
}

/** The fixed text of each event type; the words of others go only to `untrusted_world_text`. */
const EVENT_TEXT: Record<McpPlayerEvent['type'], string> = {
  speech_to_me: 'Someone spoke to you.',
  conversation_digest: 'Some talk went on nearby.',
  damage: 'You took damage.',
  agent_approached: 'Someone came near you.',
  proposal: 'A proposal was put forward.',
  day_night: 'The day turned.',
  intent_finished: 'A task you set finished.',
  reflex: 'Your body acted on its own.',
};

/** Maps a sim event kind to a player event type; unknown kinds are not digested. */
const EVENT_TYPE: Record<string, McpPlayerEvent['type']> = {
  speech: 'speech_to_me',
  conversation_digest: 'conversation_digest',
  damage: 'damage',
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
    throw new ToolError('sleep_refused', ack.rejection?.detail ?? 'the Body refused the sleep');
  }
  const { events, dropped } = await deps.events.since(call.lifeId, mark.cursor);
  const digested = digest(events);
  const total = digested.events.length;
  await deps.journal.append(
    call.lifeId,
    `Day ${day}: asleep. ${total} events since the last sleep, ${dropped} lost before them.`,
    deps.now(),
  );
  const cursor = events.at(-1)?.seq ?? mark.cursor;
  await deps.marks.write(call.lifeId, { lastSleepDay: day, cursor });
  return {
    day,
    days_since_sleep: 0,
    events: digested.events.slice(-SLEEP_EVENT_LIMIT),
    event_counts: digested.counts,
    untrusted_world_text: digested.speech.length > 0 ? { speech: digested.speech } : {},
    note: WORLD_TEXT_NOTE,
  };
}
