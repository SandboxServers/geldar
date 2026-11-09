import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  type BatchDeps,
  DLQ_DATA_LIMIT,
  dlqSubject,
  handleBatch,
  MAX_DELIVER,
  nakDelayMs,
  type SinkMessage,
} from './consumer.ts';
import { type EventWriter, isPermanentDbError } from './writer.ts';

const EVENT: WorldEvent = {
  source_event_id: 'ev_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  at: '2026-11-09T12:00:00Z',
  shard: 'phase0',
  world_day: 3,
  world_tick: 72_000,
  type: 'damage',
  payload: { amount: 4 },
};

/** Records every call in order so tests can assert ack-after-commit. */
function harness(options: { dbFails?: boolean; dlqFails?: boolean; rejectIds?: string[] } = {}) {
  const log: string[] = [];
  const written: string[] = [];
  const logged: string[] = [];
  const dlq: { subject: string; body: string }[] = [];
  const writer: EventWriter = {
    async insertBatch(events) {
      if (options.dbFails) throw new Error('connection refused');
      if (events.some((e) => options.rejectIds?.includes(e.source_event_id))) {
        throw Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' });
      }
      for (const e of events) written.push(e.source_event_id);
      log.push('commit');
    },
  };
  const deps: BatchDeps = {
    writer,
    log: (line) => logged.push(line),
    async publishDlq(subject, body) {
      if (options.dlqFails) throw new Error('nats down');
      dlq.push({ subject, body });
      log.push('dlq');
    },
  };
  function message(subject: string, data: unknown, deliveryCount = 1): SinkMessage {
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    return {
      subject,
      data: new TextEncoder().encode(raw),
      deliveryCount,
      ack: () => log.push(`ack ${subject}`),
      nak: (delay) => log.push(`nak ${subject} ${delay}`),
    };
  }
  return { log, written, logged, dlq, deps, message };
}

describe('handleBatch', () => {
  // The fake writer does not dedupe: idempotence is the SQL's ON CONFLICT (see writer.test.ts and
  // the integration test, which runs the real statement). This only pins that a redelivery is
  // passed on and acked, not dropped or dead-lettered.
  it('hands a redelivered event to the writer again and acks it', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', EVENT)], h.deps);
    await handleBatch([h.message('geldar.phase0.damage', EVENT, 2)], h.deps);
    expect(h.written).toEqual([EVENT.source_event_id, EVENT.source_event_id]);
    expect(h.dlq).toHaveLength(0);
    expect(h.log.filter((l) => l.startsWith('ack'))).toHaveLength(2);
  });

  it('acks only after the commit', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', EVENT)], h.deps);
    expect(h.log).toEqual(['commit', 'ack geldar.phase0.damage']);
  });

  it('sends an invalid message to the DLQ with the reason and acks it', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', { nonsense: true })], h.deps);
    expect(h.written).toHaveLength(0);
    expect(h.dlq).toHaveLength(1);
    expect(h.dlq[0]?.subject).toBe('geldar.phase0.dlq');
    expect(JSON.parse(h.dlq[0]?.body ?? '{}').reason).toContain('source_event_id');
    expect(h.log).toEqual(['dlq', 'ack geldar.phase0.damage']);
  });

  it('dead-letters a body that is not JSON and a subject that disagrees with the event', async () => {
    const h = harness();
    await handleBatch(
      [h.message('geldar.phase0.damage', 'not json'), h.message('geldar.phase0.death', EVENT)],
      h.deps,
    );
    expect(h.dlq).toHaveLength(2);
    expect(JSON.parse(h.dlq[1]?.body ?? '{}').reason).toContain('does not match');
  });

  it('naks a valid batch with backoff on a DB error and never acks', async () => {
    const h = harness({ dbFails: true });
    await handleBatch([h.message('geldar.phase0.damage', EVENT, 3)], h.deps);
    expect(h.log).toEqual(['nak geldar.phase0.damage 4000']);
  });

  it('dead-letters a transient failure on the last delivery instead of naking it', async () => {
    const h = harness({ dbFails: true });
    await handleBatch([h.message('geldar.phase0.damage', EVENT, MAX_DELIVER)], h.deps);
    expect(h.dlq).toHaveLength(1);
    expect(JSON.parse(h.dlq[0]?.body ?? '{}').reason).toContain('connection refused');
    expect(h.log).toEqual(['dlq', 'ack geldar.phase0.damage']);
  });

  it('still naks a transient failure one delivery before the cap', async () => {
    const h = harness({ dbFails: true });
    await handleBatch([h.message('geldar.phase0.damage', EVENT, MAX_DELIVER - 1)], h.deps);
    expect(h.dlq).toHaveLength(0);
    expect(h.log).toEqual(['nak geldar.phase0.damage 30000']);
  });

  it('naks instead of acking when the DLQ publish fails', async () => {    const h = harness({ dlqFails: true });
    await handleBatch([h.message('geldar.phase0.damage', 'junk')], h.deps);
    expect(h.log).toEqual(['nak geldar.phase0.damage 1000']);
  });

  it('logs the error and the event ids when it naks a batch', async () => {
    const h = harness({ dbFails: true });
    await handleBatch([h.message('geldar.phase0.damage', EVENT)], h.deps);
    expect(h.logged.join(' ')).toContain(EVENT.source_event_id);
    expect(h.logged.join(' ')).toContain('connection refused');
  });

  it('dead-letters only the row the database permanently rejects and acks the rest', async () => {
    const bad = { ...EVENT, source_event_id: 'ev_01HBBBBBBBBBBBBBBBBBBBBBBB' };
    const good = { ...EVENT, source_event_id: 'ev_01HGGGGGGGGGGGGGGGGGGGGGGG' };
    const h = harness({ rejectIds: [bad.source_event_id] });
    await handleBatch(
      [h.message('geldar.phase0.damage', good), h.message('geldar.phase0.damage', bad)],
      h.deps,
    );
    expect(h.written).toEqual([good.source_event_id]);
    expect(h.dlq).toHaveLength(1);
    expect(JSON.parse(h.dlq[0]?.body ?? '{}').reason).toContain('22P05');
    expect(h.log.filter((l) => l.startsWith('nak'))).toHaveLength(0);
    expect(h.log.filter((l) => l.startsWith('ack'))).toHaveLength(2);
    expect(h.logged.join(' ')).toContain('dead letter');
  });

  it('truncates a huge body in the dead letter and records its length', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', 'x'.repeat(200_000))], h.deps);
    const body = JSON.parse(h.dlq[0]?.body ?? '{}');
    expect(body.data).toHaveLength(DLQ_DATA_LIMIT);
    expect(body.data_bytes).toBe(200_000);
    expect(body.data_truncated).toBe(true);
    expect((h.dlq[0]?.body ?? '').length).toBeLessThan(DLQ_DATA_LIMIT + 1000);
  });

  it('stores an event whose type is dlq instead of dropping it', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.dlq', { ...EVENT, type: 'dlq' })], h.deps);
    expect(h.written).toEqual([EVENT.source_event_id]);
    expect(h.log).toEqual(['commit', 'ack geldar.phase0.dlq']);
  });
  it('acks and skips its own dead letters instead of looping them', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.dlq', { reason: 'x' })], h.deps);
    expect(h.dlq).toHaveLength(0);
    expect(h.log).toEqual(['ack geldar.phase0.dlq']);
  });
});

describe('backoff and subjects', () => {
  it('doubles the nak delay up to 30 s', () => {
    expect([1, 2, 3, 20].map(nakDelayMs)).toEqual([1000, 2000, 4000, 30_000]);
  });

  it('derives the DLQ subject from the shard segment', () => {
    expect(dlqSubject('geldar.alpha.damage')).toBe('geldar.alpha.dlq');
    expect(dlqSubject('weird')).toBe('geldar.unknown.dlq');
  });
});

describe('isPermanentDbError', () => {
  it('is true for SQLSTATE classes 22 and 23 only', () => {
    expect(isPermanentDbError({ code: '22P05' })).toBe(true);
    expect(isPermanentDbError({ code: '23505' })).toBe(true);
    expect(isPermanentDbError({ code: '57014' })).toBe(false);
    expect(isPermanentDbError({ code: 'ECONNREFUSED' })).toBe(false);
    expect(isPermanentDbError(new Error('boom'))).toBe(false);
    expect(isPermanentDbError(null)).toBe(false);
  });
});
