import {
  type ActionRecord,
  type Receipt,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { receiptIdFor } from './derived-id.ts';
import { type EventPublisher, eventIdFor, NatsRecordSink } from './records-nats.ts';

const LIFE = 'ag_kestrel_01';
const INTENT = 'in_01HZX3V9Q4M2K8R7T6Y5W4E3D5';

const ACTION: ActionRecord = {
  action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  intent_id: INTENT,
  life_id: LIFE,
  body_generation: 1,
  sequence: 0,
  source_snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  snapshot_revision: 4,
  expires_tick: 900,
  kind: 'mine',
  args: { block: 'oak_log' },
  state: 'accepted',
  result: null,
  receipt_id: null,
};

const RECEIPT: Receipt = {
  receipt_id: 'rc_01HZX3V9Q4M2K8R7T6Y5W4E3D3',
  action_id: ACTION.action_id,
  life_id: LIFE,
  kind: 'mine',
  phase: 'committed',
  at: '2026-11-09T12:00:05Z',
};

interface Sent {
  subject: string;
  msgId: string;
  event: WorldEvent;
}

/** A publisher that records what it gets and fails the first `failures` calls. */
function fakePublisher(failures = 0) {
  const sent: Sent[] = [];
  let calls = 0;
  const publisher: EventPublisher = {
    async publish(subject, body, msgId) {
      calls++;
      if (calls <= failures) throw new Error('nats down');
      sent.push({ subject, msgId, event: JSON.parse(body) as WorldEvent });
    },
  };
  return { publisher, sent, calls: () => calls };
}

function sinkWith(publisher: EventPublisher, extra: { attempts?: number } = {}) {
  const logs: string[] = [];
  const sink = new NatsRecordSink({
    publisher,
    shard: 'phase0',
    lifeId: LIFE,
    worldTick: () => 48_500,
    now: () => new Date('2026-11-09T12:00:00Z'),
    log: (line) => void logs.push(line),
    retryDelayMs: 0,
    ...extra,
  });
  return { sink, logs };
}

describe('eventIdFor', () => {
  it('is deterministic, shaped like an EventId and differs per key', () => {
    expect(eventIdFor('a')).toBe(eventIdFor('a'));
    expect(eventIdFor('a')).not.toBe(eventIdFor('b'));
    expect(eventIdFor('a')).toMatch(/^ev_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('receiptIdFor', () => {
  it('is the same for a replayed action and phase and differs per phase and action', () => {
    expect(receiptIdFor('ac_a', 'committed')).toBe(receiptIdFor('ac_a', 'committed'));
    expect(receiptIdFor('ac_a', 'committed')).not.toBe(receiptIdFor('ac_a', 'aborted'));
    expect(receiptIdFor('ac_a', 'committed')).not.toBe(receiptIdFor('ac_b', 'committed'));
    expect(receiptIdFor('ac_a', 'committed')).toMatch(/^rc_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('NatsRecordSink', () => {
  it('publishes every record kind as a valid event on geldar.<shard>.<type>', async () => {
    const { publisher, sent } = fakePublisher();
    const { sink } = sinkWith(publisher);
    sink.intentChanged({
      intentId: INTENT,
      lifeId: LIFE,
      bodyGeneration: 1,
      state: 'running',
      tick: 48_100,
    });
    sink.actionChanged(ACTION);
    sink.receipt(RECEIPT);
    sink.reflexFired({
      name: 'eat',
      lifeId: LIFE,
      bodyGeneration: 1,
      tick: 48_200,
      trigger: { hunger: 12 },
      outcome: { result: 'handled' },
    });
    sink.wake({ reason: 'goal_completed', tick: 48_300, intentId: INTENT });
    await sink.flush();
    expect(sent.map((s) => s.subject)).toEqual([
      'geldar.phase0.intent',
      'geldar.phase0.action',
      'geldar.phase0.receipt',
      'geldar.phase0.reflex_fired',
      'geldar.phase0.wake',
    ]);
    for (const s of sent) {
      expect(validateWorldEvent(s.event).ok).toBe(true);
      expect(s.msgId).toBe(s.event.source_event_id);
      expect(s.event.agent_id).toBe(LIFE);
    }
    expect(sent[0]?.event).toMatchObject({ world_tick: 48_100, world_day: 2 });
    expect(sent[1]?.event.payload).toEqual(ACTION);
  });

  it('puts the intent fields on an accepted event and nothing extra on the others', async () => {
    const { publisher, sent } = fakePublisher();
    const { sink } = sinkWith(publisher);
    const base = { intentId: INTENT, lifeId: LIFE, bodyGeneration: 1, tick: 48_100 };
    sink.intentChanged({
      ...base,
      state: 'accepted',
      intent: {
        goal: 'get_wood',
        program: 'gather',
        arguments: { item: 'oak_log' },
        wake_on: ['goal_completed'],
        limits: { max_world_ticks: 6000, max_block_operations: 40 },
        checkpoint: { steps: 3 },
      },
    });
    sink.intentChanged({ ...base, state: 'running' });
    await sink.flush();
    expect(sent[0]?.event.payload).toMatchObject({
      goal: 'get_wood',
      program: 'gather',
      arguments: { item: 'oak_log' },
      preconditions: [],
      wake_on: ['goal_completed'],
      limits: { max_world_ticks: 6000, max_block_operations: 40 },
    });
    expect(sent[0]?.event.payload).not.toHaveProperty('checkpoint');
    expect(sent[1]?.event.payload).not.toHaveProperty('goal');
  });

  it('gives the same record the same source_event_id and a new state a new one', async () => {
    const { publisher, sent } = fakePublisher();
    const { sink } = sinkWith(publisher);
    sink.actionChanged(ACTION);
    sink.actionChanged({ ...ACTION });
    sink.actionChanged({ ...ACTION, state: 'running' });
    await sink.flush();
    const ids = sent.map((s) => s.event.source_event_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[0]).toBe(eventIdFor(`action:${ACTION.action_id}:accepted`));
  });

  it('keeps a retried publish on the same id', async () => {
    const { publisher, sent, calls } = fakePublisher(2);
    const { sink, logs } = sinkWith(publisher);
    sink.actionChanged(ACTION);
    await sink.flush();
    expect(calls()).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.msgId).toBe(eventIdFor(`action:${ACTION.action_id}:accepted`));
    expect(logs).toEqual([]);
  });

  it('logs and drops a wake record after the last attempt, and carries on', async () => {
    const { publisher, sent, calls } = fakePublisher(2);
    const { sink, logs } = sinkWith(publisher, { attempts: 2 });
    sink.wake({ reason: 'goal_completed', tick: 10, intentId: INTENT });
    sink.receipt(RECEIPT);
    await sink.flush();
    expect(calls()).toBe(3);
    expect(sent.map((s) => s.event.type)).toEqual(['receipt']);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('after 2 attempts');
  });

  it('sends in the order the records were made', async () => {
    const { publisher, sent } = fakePublisher(1);
    const { sink } = sinkWith(publisher);
    for (const state of ['accepted', 'running', 'completed'] as const) {
      sink.actionChanged({ ...ACTION, state });
    }
    await sink.flush();
    expect(sent.map((s) => (s.event.payload as unknown as ActionRecord).state)).toEqual([
      'accepted',
      'running',
      'completed',
    ]);
  });

  it('drops a record the contract rejects, without throwing', async () => {
    const { publisher, sent } = fakePublisher();
    const { sink, logs } = sinkWith(publisher);
    expect(() => sink.actionChanged({ ...ACTION, action_id: 'bad' })).not.toThrow();
    await sink.flush();
    expect(sent).toHaveLength(0);
    expect(logs[0]).toContain('not valid');
  });
});
