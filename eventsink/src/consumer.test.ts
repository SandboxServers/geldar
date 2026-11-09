import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  type BatchDeps,
  dlqSubject,
  handleBatch,
  nakDelayMs,
  type SinkMessage,
} from './consumer.ts';
import type { EventWriter } from './writer.ts';

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
function harness(options: { dbFails?: boolean; dlqFails?: boolean } = {}) {
  const log: string[] = [];
  const rows = new Map<string, WorldEvent>();
  const dlq: { subject: string; body: string }[] = [];
  const writer: EventWriter = {
    async insertBatch(events) {
      if (options.dbFails) throw new Error('connection refused');
      for (const e of events) if (!rows.has(e.source_event_id)) rows.set(e.source_event_id, e);
      log.push('commit');
    },
  };
  const deps: BatchDeps = {
    writer,
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
  return { log, rows, dlq, deps, message };
}

describe('handleBatch', () => {
  it('inserts a duplicate delivery once and acks both', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', EVENT)], h.deps);
    await handleBatch([h.message('geldar.phase0.damage', EVENT)], h.deps);
    expect(h.rows.size).toBe(1);
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
    expect(h.rows.size).toBe(0);
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

  it('naks instead of acking when the DLQ publish fails', async () => {
    const h = harness({ dlqFails: true });
    await handleBatch([h.message('geldar.phase0.damage', 'junk')], h.deps);
    expect(h.log).toEqual(['nak geldar.phase0.damage 1000']);
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
