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

function sinkWith(publisher: EventPublisher, extra: { maxPending?: number } = {}) {
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
    expect(logs).toEqual([]);
    expect(sink.dropped).toBe(0);
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
