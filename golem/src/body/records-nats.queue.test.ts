import type { ActionRecord, Receipt, WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { receiptIdFor } from './derived-id.ts';
import { type EventPublisher, NatsRecordSink } from './records-nats.ts';

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
  receipt_id: receiptIdFor(ACTION.action_id, 'committed'),
  action_id: ACTION.action_id,
  life_id: LIFE,
  kind: 'mine',
  phase: 'committed',
  at: '2026-11-09T12:00:05Z',
};

/** A publisher that fails while `down` is true and records what got through. */
function switchable() {
  const state = { down: true, calls: 0 };
  const sent: WorldEvent[] = [];
  const publisher: EventPublisher = {
    async publish(_subject, body) {
      state.calls++;
      if (state.down) throw new Error('nats down');
      sent.push(JSON.parse(body) as WorldEvent);
    },
  };
  return { publisher, state, sent };
}

function sinkWith(
  publisher: EventPublisher,
  extra: { maxPending?: number; maxEventBytes?: number; retryLogEvery?: number } = {},
) {
  const logs: string[] = [];
  const sink = new NatsRecordSink({
    publisher,
    shard: 'phase0',
    lifeId: LIFE,
    worldTick: () => 48_500,
    now: () => new Date('2026-11-09T12:00:00Z'),
    log: (line) => void logs.push(line),
    retryDelayMs: 1,
    maxRetryDelayMs: 2,
    attempts: 3,
    ...extra,
  });
  return { sink, logs };
}

/** An intent change in the given state. */
const change = (state: string): Parameters<NatsRecordSink['intentChanged']>[0] =>
  ({
    intentId: INTENT,
    lifeId: LIFE,
    bodyGeneration: 1,
    state,
    tick: 40,
  }) as Parameters<NatsRecordSink['intentChanged']>[0];

const wake = (tick: number) =>
  ({ reason: 'goal_completed', tick, intentId: INTENT }) as Parameters<NatsRecordSink['wake']>[0];

describe('audit records survive a long outage', () => {
  it('retries an action and a receipt past the attempt limit until NATS is back, in order', async () => {
    const { publisher, state, sent } = switchable();
    const { sink, logs } = sinkWith(publisher);
    sink.actionChanged(ACTION);
    sink.receipt(RECEIPT);
    while (state.calls < 12) await new Promise((resolve) => setTimeout(resolve, 2));
    state.down = false;
    await sink.flush();
    expect(sent.map((e) => e.type)).toEqual(['action', 'receipt']);
    expect(sink.dropped).toBe(0);
    // The outage is logged: the first failure of each record, with its attempt, queue depth and id.
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain('action');
    expect(logs[0]).toContain('attempt 1');
    expect(logs[0]).toContain('1 more queued');
    expect(logs[0]).toContain('nats down');
    expect(logs[0]).toMatch(/ev_[0-9A-Za-z]+/);
    expect(logs.every((line) => !line.includes('dropped'))).toBe(true);
  });

  it('logs the first failure and then one attempt in retryLogEvery, not every one', async () => {
    const { publisher, state } = switchable();
    const { sink, logs } = sinkWith(publisher, { retryLogEvery: 4 });
    sink.actionChanged(ACTION);
    while (state.calls < 10) await new Promise((resolve) => setTimeout(resolve, 2));
    const seen = logs.length;
    state.down = false;
    await sink.flush();
    expect(logs[0]).toContain('attempt 1,');
    expect(logs[1]).toContain('attempt 4,');
    expect(logs[2]).toContain('attempt 8,');
    expect(seen).toBeLessThan(state.calls); // far fewer lines than failures
    expect(logs.filter((line) => line.includes('attempt 2,'))).toEqual([]);
  });

  it('retries an accepted and a final intent event until NATS is back, like an audit record', async () => {
    const { publisher, state, sent } = switchable();
    const { sink } = sinkWith(publisher);
    for (const intentState of ['accepted', 'completed', 'failed', 'cancelled', 'interrupted']) {
      sink.intentChanged(change(intentState));
    }
    while (state.calls < 12) await new Promise((resolve) => setTimeout(resolve, 2));
    state.down = false;
    await sink.flush();
    expect(sent.map((e) => (e.payload as { state: string }).state)).toEqual([
      'accepted',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
    ]);
    expect(sink.dropped).toBe(0);
  });

  it('still gives up on a running or paused intent heartbeat after its attempts', async () => {
    for (const intentState of ['running', 'paused']) {
      const { publisher, state, sent } = switchable();
      const { sink, logs } = sinkWith(publisher);
      sink.intentChanged(change(intentState));
      await sink.flush();
      expect(state.calls).toBe(3);
      expect(sent).toEqual([]);
      expect(logs[0]).toContain('after 3 attempts');
    }
  });

  it('still gives up on a wake record after its attempts', async () => {
    const { publisher, state, sent } = switchable();
    const { sink, logs } = sinkWith(publisher);
    sink.wake(wake(1));
    await sink.flush();
    expect(state.calls).toBe(3);
    expect(sent).toEqual([]);
    expect(logs[0]).toContain('after 3 attempts');
  });
});

describe('a full queue', () => {
  /** A sink whose first record is stuck in flight, so later ones queue behind it. */
  function stuck(maxPending: number) {
    const gate = switchable();
    const made = sinkWith(gate.publisher, { maxPending });
    made.sink.actionChanged({ ...ACTION, action_id: 'ac_01HZX3V9Q4M2K8R7T6Y5W4E3D9' });
    return { ...gate, ...made };
  }

  it('drops the oldest non-audit record first and keeps every audit record', async () => {
    const { sink, logs, state, sent } = stuck(3);
    sink.wake(wake(1));
    sink.actionChanged(ACTION);
    // Full now (in flight + 2 waiting): the audit receipt pushes the old wake out.
    sink.receipt(RECEIPT);
    expect(sink.dropped).toBe(1);
    expect(sink.auditDropped).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('dropped wake');
    state.down = false;
    await sink.flush();
    expect(sent.map((e) => e.type)).toEqual(['action', 'action', 'receipt']);
  });

  it('drops a new non-audit record when only audit records are waiting', async () => {
    const { sink, logs } = stuck(3);
    sink.actionChanged(ACTION);
    sink.receipt(RECEIPT);
    sink.wake(wake(2));
    expect(sink.dropped).toBe(1);
    expect(sink.auditDropped).toBe(0);
    expect(logs[0]).toContain('dropped wake');
  });

  it('drops the oldest audit record only when the queue is all audit, loudly, and counts it', async () => {
    const { sink, logs, state, sent } = stuck(3);
    sink.actionChanged(ACTION);
    sink.actionChanged({ ...ACTION, state: 'running' });
    sink.receipt(RECEIPT);
    expect(sink.auditDropped).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('ERROR dropped audit action');
    state.down = false;
    await sink.flush();
    expect(sent.map((e) => e.type)).toEqual(['action', 'action', 'receipt']);
    expect(sent[1]?.payload).toMatchObject({ state: 'running' });
  });
});

describe('a record that can never be sent does not block the queue', () => {
  it('cuts an oversize action result to a marker and publishes the record', async () => {
    const { publisher, state, sent } = switchable();
    state.down = false;
    const { sink, logs } = sinkWith(publisher, { maxEventBytes: 2000 });
    sink.actionChanged({ ...ACTION, state: 'completed', result: { blob: 'x'.repeat(5000) } });
    sink.receipt(RECEIPT);
    await sink.flush();
    expect(sent.map((e) => e.type)).toEqual(['action', 'receipt']);
    expect(sent[0]?.payload).toMatchObject({
      result: { truncated: true, original_event_bytes: expect.any(Number) },
    });
    expect(logs.some((line) => line.includes('result cut'))).toBe(true);
    expect(sink.auditDropped).toBe(0);
  });

  it('drops an audit record that is still too large, as an error, and sends the next one', async () => {
    const { publisher, state, sent } = switchable();
    state.down = false;
    const { sink, logs } = sinkWith(publisher, { maxEventBytes: 100 });
    sink.actionChanged(ACTION);
    sink.wake(wake(3));
    await sink.flush();
    expect(sent).toEqual([]);
    expect(sink.auditDropped).toBe(1);
    expect(logs.some((line) => line.includes('ERROR dropped audit action'))).toBe(true);
    expect(logs.some((line) => line.includes('dropped wake record'))).toBe(true);
    expect(sink.dropped).toBe(2);
  });

  it('counts an audit record that fails validation and keeps the queue moving', async () => {
    const { publisher, state, sent } = switchable();
    state.down = false;
    const { sink, logs } = sinkWith(publisher);
    sink.actionChanged({ ...ACTION, kind: '' } as ActionRecord);
    sink.receipt(RECEIPT);
    await sink.flush();
    expect(sent.map((e) => e.type)).toEqual(['receipt']);
    expect(sink.auditDropped).toBe(1);
    expect(logs[0]).toContain('ERROR dropped audit action');
    expect(logs[0]).toContain('not valid');
  });

  it('drops an oversize or invalid final intent event as a durable loss and keeps the queue moving', async () => {
    const { publisher, state, sent } = switchable();
    state.down = false;
    const big = sinkWith(publisher, { maxEventBytes: 100 });
    big.sink.intentChanged(change('completed'));
    await big.sink.flush();
    expect(sent).toEqual([]);
    expect(big.sink.auditDropped).toBe(1);
    expect(big.logs[0]).toContain('ERROR dropped audit intent');
    expect(big.logs[0]).toContain('over 100');

    const bad = sinkWith(publisher);
    bad.sink.intentChanged(change('not_a_state'));
    bad.sink.receipt(RECEIPT);
    await bad.sink.flush();
    expect(sent.map((e) => e.type)).toEqual(['receipt']);
    expect(bad.sink.auditDropped).toBe(1);
    expect(bad.sink.dropped).toBe(1);
    expect(bad.logs[0]).toContain('ERROR dropped audit intent');
    expect(bad.logs[0]).toContain('not valid');
  });
});
