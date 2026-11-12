/** Valid wire fixtures for the Body-Mind link tests: events, snapshots, plans, a fake stream. */
import type { PlanMessage, Snapshot, WorldEvent } from '@geldar/contract';
import type { EventStream, StreamMessage } from './nats-event-source.ts';

export const SHARD = 'phase0';
export const LIFE = 'ag_adam_03';

/** An id: the prefix and 26 Crockford characters derived from `n`. */
export function idOf(prefix: 'th' | 'sn' | 'in' | 'ac' | 'ev', n: number): string {
  return `${prefix}_${String(n).padStart(26, '0')}`;
}

/** A well-formed payload for each type the Mind reads. */
export const PAYLOADS: Record<string, Record<string, unknown>> = {
  wake: { reason: 'no_plan', tick: 5, intent_id: null },
  intent: {
    intent_id: idOf('in', 1),
    life_id: LIFE,
    body_generation: 1,
    state: 'running',
    tick: 5,
  },
  action: {
    action_id: idOf('ac', 1),
    intent_id: null,
    life_id: LIFE,
    body_generation: 1,
    sequence: 0,
    source_snapshot_id: idOf('sn', 1),
    snapshot_revision: 1,
    expires_tick: 100,
    kind: 'wait',
    args: { seconds: 1 },
    state: 'completed',
    result: null,
    receipt_id: null,
  },
  plan_result: {
    thought_id: idOf('th', 1),
    intent: 'none',
    failed_at: null,
    actions: [],
    said: false,
  },
  action_outcome: {
    verb: 'mine',
    index: 0,
    ok: true,
    message: 'Your mine worked.',
  },
  reflex_fired: {
    name: 'eat',
    life_id: LIFE,
    body_generation: 1,
    tick: 5,
    trigger: { hunger: 3 },
    outcome: { result: 'handled' },
  },
  speech: { from: 'Eve', text: 'hello', distance: 3, own: false },
  damage: { amount: 2 },
  death: { cause: 'fall' },
  sleep: { slept: true },
};

/** A valid event of `type` for `agentId`; `n` keeps ids apart. */
export function eventOf(type: string, n = 1, agentId: string | null = LIFE): WorldEvent {
  return {
    source_event_id: idOf('ev', n),
    at: '2026-11-09T12:00:00.000Z',
    shard: SHARD,
    world_day: 0,
    world_tick: 5,
    type,
    ...(agentId === null ? {} : { agent_id: agentId }),
    payload: PAYLOADS[type] ?? {},
  };
}

/** A snapshot the contract accepts. */
export function snapshotOf(revision = 1, agentId = LIFE): Snapshot {
  return {
    snapshot_id: idOf('sn', revision),
    agent_id: agentId,
    shard: SHARD,
    revision,
    body_generation: 1,
    world_time: { day: 0, time_of_day: 'day', ticks: 10, weather: 'clear' },
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 0,
      held_item: null,
      inventory: [],
      effects: [],
      budget_remaining_thoughts: 5,
      days_since_sleep: 0,
    },
    surroundings: { blocks_summary: '', notable_blocks: [], entities: [], agents: [] },
    heard: [],
    events_since_last_thought: [],
  };
}

/** A plan the contract accepts. */
export function planOf(n = 1): PlanMessage {
  return {
    thought_id: idOf('th', n),
    life_id: LIFE,
    body_generation: 1,
    source_snapshot_id: idOf('sn', n),
    snapshot_revision: 1,
    expires_tick: 100,
    action_ids: [idOf('ac', n)],
    thought: { reasoning: 'test', actions: [{ do: 'wait', seconds: 1 }] },
  };
}

/** An `EventStream` a test feeds with `push`; it records the subjects it was opened with. */
export class FakeEventStream implements EventStream {
  openedWith: string[] | null = null;
  closed = false;
  private sink: ((message: StreamMessage) => void) | null = null;

  async open(subjects: string[], onMessage: (message: StreamMessage) => void): Promise<() => void> {
    this.openedWith = subjects;
    this.sink = onMessage;
    return () => {
      this.closed = true;
    };
  }

  /** Delivers an event (or raw text) on its type's subject, or on `subject` when given. */
  push(body: WorldEvent | string, subject?: string): void {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const type = typeof body === 'string' ? 'unknown' : body.type;
    this.sink?.({ subject: subject ?? `geldar.${SHARD}.${type}`, data });
  }
}
