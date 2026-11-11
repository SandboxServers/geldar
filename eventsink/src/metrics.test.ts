import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WorldEvent } from '@geldar/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBatch, type SinkMessage } from './consumer.ts';
import {
  CONSUMED,
  DLQ_WRITTEN,
  EventsinkMetrics,
  eventsinkTelemetry,
  FAILED,
  MetricRegistry,
  PENDING,
  pushMetrics,
  samplePending,
  WRITTEN,
} from './metrics.ts';

const EVENT: WorldEvent = {
  source_event_id: 'ev_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  at: '2026-11-09T12:00:00Z',
  shard: 'phase0',
  world_day: 3,
  world_tick: 72_000,
  type: 'damage',
  payload: { amount: 4 },
};

const LOG: (line: Record<string, string | number>) => void = () => {};

/** A message the batch logic can ack or nak, with spies on both. */
function message(subject: string, data: string | object): SinkMessage {
  const bytes = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
  return { subject, data: bytes, deliveryCount: 1, ack: vi.fn(), nak: vi.fn() };
}

/** Fake deps: a writer and a DLQ publisher the test steers. */
function deps(metrics: EventsinkMetrics) {
  const writer = { insertBatch: vi.fn(async (_events: readonly WorldEvent[]) => {}) };
  const publishDlq = vi.fn(async (_subject: string, _body: string) => {});
  return { writer, publishDlq, metrics, log: () => {} };
}

type OtlpPoint = {
  attributes: { key: string; value: { stringValue: string } }[];
  asDouble: number;
};
type OtlpFamily = {
  name: string;
  sum?: { dataPoints: OtlpPoint[] };
  gauge?: { dataPoints: OtlpPoint[] };
};

/** The value of one series, read from the registry's own OTLP output. 0 when it has no point. */
function seriesValue(metrics: EventsinkMetrics, name: string, labels: Record<string, string> = {}) {
  const families = metrics.registry.otlp('0') as OtlpFamily[];
  const family = families.find((f) => f.name === name);
  const points = family?.sum?.dataPoints ?? family?.gauge?.dataPoints ?? [];
  const match = points.find((p) => {
    const got = Object.fromEntries(p.attributes.map((a) => [a.key, a.value.stringValue]));
    return JSON.stringify(got) === JSON.stringify(labels);
  });
  return match?.asDouble ?? 0;
}

describe('the eventsink counts what the batch decides', () => {
  it('counts a stored event as consumed and written, and an own dead letter as consumed only', async () => {
    const metrics = new EventsinkMetrics();
    const d = deps(metrics);
    await handleBatch(
      [message('geldar.phase0.damage', EVENT), message('geldar.phase0.dlq', { reason: 'x' })],
      d,
    );
    expect(seriesValue(metrics, CONSUMED, { type: 'damage' })).toBe(1);
    expect(seriesValue(metrics, CONSUMED, { type: 'dlq' })).toBe(1);
    expect(seriesValue(metrics, WRITTEN)).toBe(1);
    expect(seriesValue(metrics, FAILED, { reason: 'validate' })).toBe(0);
    expect(seriesValue(metrics, DLQ_WRITTEN)).toBe(0);
  });

  it('counts an invalid body once as a validate failure and once as a DLQ write', async () => {
    const metrics = new EventsinkMetrics();
    await handleBatch([message('geldar.phase0.damage', 'not json')], deps(metrics));
    expect(seriesValue(metrics, FAILED, { reason: 'validate' })).toBe(1);
    expect(seriesValue(metrics, DLQ_WRITTEN)).toBe(1);
    expect(seriesValue(metrics, WRITTEN)).toBe(0);
  });

  it('counts nothing as failed when the DLQ publish fails, because the message is naked', async () => {
    const metrics = new EventsinkMetrics();
    const d = deps(metrics);
    d.publishDlq.mockRejectedValueOnce(new Error('nats down'));
    await handleBatch([message('geldar.phase0.damage', 'not json')], d);
    expect(seriesValue(metrics, FAILED, { reason: 'validate' })).toBe(0);
    expect(seriesValue(metrics, DLQ_WRITTEN)).toBe(0);
  });

  it('counts a row the database permanently rejects once as db, and the rest as written', async () => {
    const metrics = new EventsinkMetrics();
    const d = deps(metrics);
    const second = { ...EVENT, source_event_id: 'ev_01HZZZZZZZZZZZZZZZZZZZZZZY' };
    const rejected = Object.assign(new Error('bad value'), { code: '22P05' });
    d.writer.insertBatch
      .mockRejectedValueOnce(rejected)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(rejected);
    await handleBatch(
      [message('geldar.phase0.damage', EVENT), message('geldar.phase0.damage', second)],
      d,
    );
    expect(seriesValue(metrics, FAILED, { reason: 'db' })).toBe(1);
    expect(seriesValue(metrics, WRITTEN)).toBe(1);
    expect(seriesValue(metrics, DLQ_WRITTEN)).toBe(1);
  });

  it('counts a transient write failure as neither written nor failed', async () => {
    const metrics = new EventsinkMetrics();
    const d = deps(metrics);
    d.writer.insertBatch.mockRejectedValueOnce(Object.assign(new Error('down'), { code: '08006' }));
    await handleBatch([message('geldar.phase0.damage', EVENT)], d);
    expect(seriesValue(metrics, WRITTEN)).toBe(0);
    expect(seriesValue(metrics, FAILED, { reason: 'db' })).toBe(0);
  });

  it('samples the pending count from the consumer and keeps the last value when the read fails', async () => {
    const metrics = new EventsinkMetrics();
    const info = vi
      .fn<() => Promise<{ num_pending: number }>>()
      .mockResolvedValueOnce({ num_pending: 7 })
      .mockRejectedValueOnce(new Error('timeout'));
    await samplePending(metrics, { info });
    expect(seriesValue(metrics, PENDING)).toBe(7);
    await samplePending(metrics, { info });
    expect(seriesValue(metrics, PENDING)).toBe(7);
  });
});

describe('the label sets are closed', () => {
  it('labels an unknown subject type as other and never records the raw text', () => {
    const metrics = new EventsinkMetrics();
    metrics.consumed('geldar.phase0.made_up_by_a_player');
    expect(seriesValue(metrics, CONSUMED, { type: 'other' })).toBe(1);
    expect(JSON.stringify(metrics.registry.otlp('0'))).not.toContain('made_up_by_a_player');
  });

  it('refuses a label named after a player, a life or a token', () => {
    const registry = new MetricRegistry();
    expect(() => registry.declare('counter', 'x_total', 'h', ['player_name'])).toThrow(
      'not allowed',
    );
    expect(() => registry.declare('counter', 'x_total', 'h', ['life_id'])).toThrow('not allowed');
    expect(() => registry.declare('counter', 'x_total', 'h', ['Token'])).toThrow('not allowed');
  });

  it('refuses a series whose labels do not match the declared names', () => {
    const metrics = new EventsinkMetrics();
    expect(() => metrics.registry.add(FAILED, { reason: 'validate', extra: 'x' })).toThrow(
      'takes labels',
    );
  });
});

describe('the push', () => {
  const servers: Server[] = [];

  /** A loopback receiver that records every request and answers with `status`. */
  async function receiver(status = 200) {
    const requests: {
      method?: string | undefined;
      path?: string | undefined;
      type?: string | undefined;
      body: string;
    }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push({
          method: req.method,
          path: req.url,
          type: req.headers['content-type'],
          body,
        });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}`, requests };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('starts nothing without GELDAR_TELEMETRY_URL: no metrics, no timer, no request', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    const off = [{}, { GELDAR_TELEMETRY_URL: '   ' }].map((env) =>
      eventsinkTelemetry(env, { service: 'eventsink', log: LOG, intervalMs: 5, fetch: fetchSpy }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(off).toEqual([undefined, undefined]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('pushes OTLP JSON to /v1/metrics on a loopback receiver, with the counts', async () => {
    const rx = await receiver();
    const telemetry = eventsinkTelemetry(
      { GELDAR_TELEMETRY_URL: rx.url },
      { service: 'eventsink', log: LOG, intervalMs: 20 },
    );
    expect(telemetry).toBeDefined();
    telemetry?.metrics.consumed('geldar.phase0.damage');
    telemetry?.metrics.written(1);
    // The first push is built at once, before the counts above; wait for a later one that carries them.
    await vi.waitFor(() =>
      expect(rx.requests.some((r) => r.body.includes('"asDouble":1'))).toBe(true),
    );
    telemetry?.stop();
    const sent = rx.requests.find((r) => r.body.includes('"asDouble":1'));
    expect(sent?.method).toBe('POST');
    expect(sent?.path).toBe('/v1/metrics');
    expect(sent?.type).toBe('application/json');
    const names = JSON.parse(sent?.body ?? '{}').resourceMetrics[0].scopeMetrics[0].metrics.map(
      (m: { name: string }) => m.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([CONSUMED, WRITTEN, FAILED, DLQ_WRITTEN, PENDING]),
    );
    expect(sent?.body).toContain('"asDouble":1');
  });

  it('stops pushing after stop()', async () => {
    const rx = await receiver();
    const telemetry = eventsinkTelemetry(
      { GELDAR_TELEMETRY_URL: rx.url },
      { service: 'eventsink', log: LOG, intervalMs: 10 },
    );
    await vi.waitFor(() => expect(rx.requests.length).toBeGreaterThanOrEqual(2));
    telemetry?.stop();
    // A push already in flight when stop() is called may still land; wait it out, then check.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = rx.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rx.requests.length).toBe(after);
  });

  it('logs a refused push with its status and does not throw', async () => {
    const rx = await receiver(503);
    const log = vi.fn();
    await pushMetrics(new MetricRegistry(), { url: rx.url, service: 'eventsink', log });
    expect(log).toHaveBeenCalledWith({ event: 'telemetry_push_failed', status: 503 });
  });
});

describe('the wiring', () => {
  it('returns metrics, the value main.ts passes to startConsumer, only when the URL is set', async () => {
    const rx = await (async () => {
      const server = createServer((_req, res) => res.writeHead(200).end());
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as AddressInfo).port;
      return { server, url: `http://127.0.0.1:${port}` };
    })();
    try {
      // The same expression main.ts passes as `metrics` to startConsumer.
      const withUrl = eventsinkTelemetry(
        { GELDAR_TELEMETRY_URL: rx.url },
        { service: 'eventsink', log: LOG, intervalMs: 60_000 },
      );
      const withoutUrl = eventsinkTelemetry(
        {},
        { service: 'eventsink', log: LOG, intervalMs: 60_000 },
      );
      expect(withUrl?.metrics).toBeInstanceOf(EventsinkMetrics);
      expect(withoutUrl?.metrics).toBeUndefined();
      withUrl?.stop();
    } finally {
      await new Promise((resolve) => rx.server.close(resolve));
    }
  });
});
