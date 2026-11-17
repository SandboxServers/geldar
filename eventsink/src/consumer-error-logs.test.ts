import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  type BatchDeps,
  ERROR_LOG_REASON_LIMIT,
  type ErrorLog,
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
const TRACE = 'a'.repeat(32);
const TRACEPARENT = `00-${TRACE}-${'b'.repeat(16)}-01`;

interface ErrorRecord {
  event: string;
  fields: Parameters<ErrorLog>[1];
}

/** One run of handleBatch against fakes; `calls` is every ack, nak and DLQ publish in order. */
function harness(options: { dbFails?: boolean; permanent?: boolean; dlqFails?: boolean } = {}) {
  const calls: string[] = [];
  const text: string[] = [];
  const records: ErrorRecord[] = [];
  let attempts = 0;
  const writer: EventWriter = {
    async insertBatch() {
      attempts += 1;
      if (options.dbFails) {
        // Permanent: the batch is rejected once, then each row fails with a connection error.
        if (options.permanent) {
          throw attempts === 1
            ? Object.assign(new Error('bad row'), { code: '22P05' })
            : new Error('connection reset');
        }
        throw new Error('connection refused');
      }
      calls.push('commit');
    },
  };
  const errorLog: ErrorLog = (event, fields) => records.push({ event, fields });
  const make = (withLog: boolean): BatchDeps => ({
    writer,
    log: (line) => text.push(line),
    async publishDlq(subject) {
      if (options.dlqFails) throw new Error('nats down');
      calls.push(`dlq ${subject}`);
    },
    ...(withLog ? { errorLog } : {}),
  });
  function message(subject: string, data: unknown, deliveryCount = 1): SinkMessage {
    return {
      subject,
      data: new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)),
      deliveryCount,
      headers: { get: (name) => (name === 'traceparent' ? TRACEPARENT : '') },
      ack: () => calls.push(`ack ${subject}`),
      nak: (delay) => calls.push(`nak ${subject} ${delay}`),
    };
  }
  return { calls, text, records, make, message };
}

describe('eventsink OTLP error logs', () => {
  it('a dead letter gives one error record with subject, reason and trace id, and the text line stays', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', { nonsense: true }, 3)], h.make(true));
    expect(h.records).toHaveLength(1);
    expect(h.records[0]?.event).toBe('dead_letter');
    expect(h.records[0]?.fields).toMatchObject({
      subject: 'geldar.phase0.damage',
      trace_id: TRACE,
      delivery_count: 3,
    });
    expect(String(h.records[0]?.fields.reason).length).toBeGreaterThan(0);
    expect(h.text).toHaveLength(1);
    expect(h.text[0]).toContain('ALERT dead letter published to geldar.phase0.dlq');
    expect(h.calls).toEqual(['dlq geldar.phase0.dlq', 'ack geldar.phase0.damage']);
  });

  it('never puts the event body in the record', async () => {
    const h = harness();
    await handleBatch([h.message('geldar.phase0.damage', 'SECRET-BODY-TEXT')], h.make(true));
    expect(JSON.stringify(h.records)).not.toContain('SECRET-BODY-TEXT');
  });

  it('a failed DLQ publish gives its record and still naks with the same delay', async () => {
    const h = harness({ dlqFails: true });
    await handleBatch([h.message('geldar.phase0.damage', { nonsense: true }, 4)], h.make(true));
    expect(h.records.map((r) => r.event)).toEqual(['dlq_publish_failed']);
    expect(h.records[0]?.fields).toMatchObject({ trace_id: TRACE, delivery_count: 4 });
    expect(h.records[0]?.fields.reason).toContain('nats down');
    expect(h.calls).toEqual([`nak geldar.phase0.damage ${nakDelayMs(4)}`]);
  });

  it('a 50-message batch with the database down gives one record and 50 naks', async () => {
    const h = harness({ dbFails: true });
    const batch = Array.from({ length: 50 }, (_, i) =>
      h.message('geldar.phase0.damage', {
        ...EVENT,
        source_event_id: `${EVENT.source_event_id.slice(0, -2)}${String(i).padStart(2, '0')}`,
      }),
    );
    await handleBatch(batch, h.make(true));
    expect(h.records).toHaveLength(1);
    expect(h.records[0]?.event).toBe('write_failed_nak');
    expect(h.records[0]?.fields).toMatchObject({
      subject: 'geldar.phase0.damage',
      batch_size: 50,
      trace_id: TRACE,
    });
    expect(h.calls.filter((c) => c.startsWith('nak '))).toHaveLength(50);
  });

  it('a 1 MiB reason is cut before scrubbing, marked, and handled fast through handleBatch', async () => {
    const h = harness();
    const key = 'k'.repeat(1_048_576);
    const started = performance.now();
    await handleBatch([h.message('geldar.phase0.damage', { [key]: 1 })], h.make(true));
    const elapsed = performance.now() - started;
    console.info(`1 MiB reason handleBatch: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(100);
    const reason = String(h.records[0]?.fields.reason);
    expect(reason.length).toBeLessThanOrEqual(ERROR_LOG_REASON_LIMIT + 64);
    expect(reason).toMatch(/…\[truncated \d+ chars\]$/);
    expect(h.calls).toEqual(['dlq geldar.phase0.dlq', 'ack geldar.phase0.damage']);
  });

  it('a 5000-char reason is kept whole (the cap is 8192), a short one has no marker', async () => {
    const h = harness({ dlqFails: true });
    const deps: BatchDeps = {
      ...h.make(true),
      async publishDlq() {
        throw new Error('x'.repeat(5000));
      },
    };
    await handleBatch([h.message('geldar.phase0.damage', { nonsense: true })], deps);
    const reason = String(h.records[0]?.fields.reason);
    expect(reason.length).toBeGreaterThan(5000);
    expect(reason).not.toContain('truncated');
  });

  it('key=value credentials in a reason are scrubbed', async () => {
    const h = harness({ dlqFails: true });
    const pw = `${'hunt'}er2`;
    const deps: BatchDeps = {
      ...h.make(true),
      async publishDlq() {
        throw new Error(`failed password=${pw} token=${'abc'}123`);
      },
    };
    await handleBatch([h.message('geldar.phase0.damage', { nonsense: true })], deps);
    const reason = String(h.records[0]?.fields.reason);
    expect(reason).not.toContain(pw);
    expect(reason).not.toContain('abc123');
  });

  it('the DLQ body reason stays sliced to 2000', async () => {
    const h = harness();
    let body = '';
    const deps: BatchDeps = {
      ...h.make(true),
      async publishDlq(_s, b) {
        body = b;
      },
    };
    await handleBatch([h.message('geldar.phase0.damage', { ['k'.repeat(5000)]: 1 })], deps);
    expect((JSON.parse(body) as { reason: string }).reason).toHaveLength(2000);
  });

  it('a write failure that naks gives one record and the same nak', async () => {
    const h = harness({ dbFails: true });
    await handleBatch([h.message('geldar.phase0.damage', EVENT, 2)], h.make(true));
    expect(h.records.map((r) => r.event)).toEqual(['write_failed_nak']);
    expect(h.records[0]?.fields).toMatchObject({
      subject: 'geldar.phase0.damage',
      trace_id: TRACE,
      delivery_count: 2,
    });
    expect(h.calls).toEqual([`nak geldar.phase0.damage ${nakDelayMs(2)}`]);
  });

  it('a row-by-row write failure that naks gives its record', async () => {
    const h = harness({ dbFails: true, permanent: true });
    await handleBatch([h.message('geldar.phase0.damage', EVENT)], h.make(true));
    expect(h.records.map((r) => r.event)).toEqual(['write_failed_nak']);
    expect(h.records[0]?.fields.reason).toContain('connection reset');
    expect(h.calls).toEqual([`nak geldar.phase0.damage ${nakDelayMs(1)}`]);
  });

  it('with no error log the acks, naks and DLQ publishes are the same, in the same order', async () => {
    const scenarios = [
      {},
      { dlqFails: true },
      { dbFails: true },
      { dbFails: true, permanent: true },
    ];
    for (const options of scenarios) {
      const on = harness(options);
      const off = harness(options);
      const batch = (h: ReturnType<typeof harness>) => [
        h.message('geldar.phase0.damage', { nonsense: true }),
        h.message('geldar.phase0.damage', EVENT),
      ];
      await handleBatch(batch(on), on.make(true));
      await handleBatch(batch(off), off.make(false));
      expect(on.calls).toEqual(off.calls);
      expect(on.text).toEqual(off.text);
      expect(off.records).toEqual([]);
    }
  });

  it('a token in the reason is scrubbed', async () => {
    const h = harness({ dlqFails: true });
    const secret = `${'tk'}${'9'.repeat(12)}`;
    const failing: BatchDeps = {
      ...h.make(true),
      async publishDlq() {
        throw new Error(`rejected with Bearer ${secret}`);
      },
    };
    await handleBatch([h.message('geldar.phase0.damage', { nonsense: true })], failing);
    const reason = String(h.records[0]?.fields.reason);
    expect(reason).not.toContain(secret);
    expect(reason).toContain('[redacted]');
  });

  it('a logger that throws changes no decision', async () => {
    const h = harness({ dlqFails: true });
    const throwing: BatchDeps = {
      ...h.make(true),
      errorLog: () => {
        throw new Error('logger down');
      },
    };
    const off = harness({ dlqFails: true });
    const batch = (x: ReturnType<typeof harness>) => [
      x.message('geldar.phase0.damage', { nonsense: true }),
    ];
    await handleBatch(batch(h), throwing);
    await handleBatch(batch(off), off.make(false));
    expect(h.calls).toEqual(off.calls);
  });

  it('a throwing trace header read does not reach the DLQ path', async () => {
    const h = harness();
    const bad = h.message('geldar.phase0.damage', { nonsense: true });
    bad.headers = {
      get: () => {
        throw new Error('headers broken');
      },
    };
    await handleBatch([bad], h.make(true));
    expect(h.calls).toEqual(['dlq geldar.phase0.dlq', 'ack geldar.phase0.damage']);
    expect(h.records[0]?.fields.trace_id).toBeNull();
  });
});
