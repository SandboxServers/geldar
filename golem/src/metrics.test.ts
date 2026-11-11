import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { RecordSink } from './body/records.ts';
import {
  BODY_ACTION_OUTCOMES,
  BODY_TICK_LAG_MS,
  BODY_TPS,
  BODY_WAKEUPS,
  countingSink,
  GolemMetrics,
  MetricRegistry,
  startGolemTelemetry,
  wakeLabel,
} from './metrics.ts';

/**
 * A loopback receiver that records each POST and answers with `status`. A `gate` holds every answer
 * until it resolves; the POST is recorded on arrival either way.
 */
async function receiver(status = 200, gate: Promise<void> = Promise.resolve()) {
  const posts: Array<{ path: string; type: string | undefined; body: string }> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      posts.push({
        path: req.url ?? '',
        type: req.headers['content-type'],
        body: raw,
      });
      void gate.then(() => {
        res.statusCode = status;
        res.end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    posts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Waits until `check` holds or about a second has passed. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const logs: Record<string, string | number>[] = [];
const quiet = (line: Record<string, string | number>) => {
  logs.push(line);
};

describe('GolemMetrics: counts and timing', () => {
  it('counts each wake by its closed reason, folding new_agent_within_<n> into one label', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    metrics.wake('directly_addressed');
    metrics.wake('new_agent_within_8');
    metrics.wake('new_agent_within_3');
    metrics.wake('something_unlisted');
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_WAKEUPS}{reason="directly_addressed"} 1`);
    expect(text).toContain(`${BODY_WAKEUPS}{reason="new_agent_within"} 2`);
    expect(text).toContain(`${BODY_WAKEUPS}{reason="other"} 1`);
  });

  it('maps every wake reason the Body can raise onto a label, and an unknown one to other', () => {
    expect(wakeLabel('reflex_danger')).toBe('reflex_danger');
    expect(wakeLabel('no_plan')).toBe('no_plan');
    expect(wakeLabel('limit_reached')).toBe('limit_reached');
    expect(wakeLabel('new_agent_within_12')).toBe('new_agent_within');
    expect(wakeLabel('Herobrine said hi')).toBe('other');
  });

  it('counts an action once, at its terminal result, by status and fail reason', () => {
    const inner: RecordSink = {
      intentChanged: () => undefined,
      actionChanged: () => undefined,
      receipt: () => undefined,
      reflexFired: () => undefined,
      wake: () => undefined,
    };
    const metrics = new GolemMetrics(new MetricRegistry());
    const sink = countingSink(inner, metrics);
    // A record without a result is not an outcome yet; the terminal one counts once.
    sink.actionChanged({ id: 'a1', state: 'running' } as never);
    sink.actionChanged({ id: 'a1', state: 'done', result: { status: 'completed' } } as never);
    sink.actionChanged({
      id: 'a2',
      state: 'done',
      result: { status: 'failed', reason: 'out_of_reach' },
    } as never);
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_ACTION_OUTCOMES}{status="completed",reason="none"} 1`);
    expect(text).toContain(`${BODY_ACTION_OUTCOMES}{status="failed",reason="out_of_reach"} 1`);
  });

  it('forwards every record to the inner sink, wakes included', () => {
    const forwarded: string[] = [];
    const inner: RecordSink = {
      intentChanged: () => forwarded.push('intent'),
      actionChanged: () => forwarded.push('action'),
      receipt: () => forwarded.push('receipt'),
      reflexFired: () => forwarded.push('reflex'),
      wake: () => forwarded.push('wake'),
    };
    const sink = countingSink(inner, new GolemMetrics(new MetricRegistry()));
    sink.wake({ reason: 'unexpected_damage', tick: 1, intentId: null });
    sink.receipt({} as never);
    expect(forwarded).toEqual(['wake', 'receipt']);
  });

  it('derives TPS and tick lag from the server world age over a ten-second window', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    metrics.worldAge(0, 0);
    metrics.worldAge(200, 10_000);
    expect(metrics.registry.render()).toContain(`${BODY_TPS} 20`);
    expect(metrics.registry.render()).toContain(`${BODY_TICK_LAG_MS} 0`);
    // Half the rate: 100 ticks in 10 s is 10 TPS, and 100 ms per tick is 50 ms of lag.
    metrics.worldAge(300, 20_000);
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_TPS} 10`);
    expect(text).toContain(`${BODY_TICK_LAG_MS} 50`);
  });

  it('does not set TPS before a full window, and starts over when the world age goes back', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    metrics.worldAge(1_000, 0);
    metrics.worldAge(1_100, 4_000);
    expect(metrics.registry.render()).not.toMatch(new RegExp(`^${BODY_TPS} `, 'm'));
    metrics.worldAge(50, 5_000);
    metrics.worldAge(150, 15_000);
    expect(metrics.registry.render()).toContain(`${BODY_TPS} 10`);
  });
});

describe('GolemMetrics: closed label sets and the label rule', () => {
  it('uses only the label names reason and status: never a person, a life or a token', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    metrics.wake('goal_completed');
    metrics.actionOutcome('failed', 'timeout');
    metrics.bodyConnected(true);
    const names = new Set(metrics.registry.render().match(/[a-zA-Z_]+(?=="|=")/g));
    expect([...names].sort()).toEqual(['reason', 'status']);
  });

  it('records an unknown status or reason as other, never as the raw text', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    metrics.actionOutcome('Canary-7 secret words', 'a thought about Herobrine');
    const text = metrics.registry.render();
    expect(text).toContain(`${BODY_ACTION_OUTCOMES}{status="other",reason="other"} 1`);
    expect(text).not.toContain('Canary');
    expect(text).not.toContain('Herobrine');
  });

  it.each(['player', 'life', 'token', 'life_id', 'player_name', 'auth_token'])(
    'refuses a label named %s on any metric',
    (label) => {
      const registry = new MetricRegistry();
      expect(() => registry.declare('counter', 'geldar_x_total', 'x', [label])).toThrow(
        `label ${label} on geldar_x_total is not allowed`,
      );
    },
  );

  it('refuses a series whose labels are not exactly the declared names', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    expect(() => metrics.registry.add(BODY_WAKEUPS, {})).toThrow('takes labels reason');
    expect(() => metrics.registry.add(BODY_WAKEUPS, { reason: 'wake', player: 'ag_x' })).toThrow(
      'takes labels reason',
    );
  });
});

describe('startGolemTelemetry: push only', () => {
  it('no URL, no request and no timer: the Body records in memory and nothing leaves the process', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const handle = startGolemTelemetry(
      {},
      {
        service: 'geldar-golem',
        log: quiet,
        intervalMs: 5,
        fetch: fetchFn,
      },
    );
    const blank = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: '   ' },
      {
        service: 'geldar-golem',
        log: quiet,
        intervalMs: 5,
        fetch: fetchFn,
      },
    );
    handle.metrics.wake('directly_addressed');
    await new Promise((resolve) => setTimeout(resolve, 40));
    await handle.stop();
    await blank.stop();
    expect(calls).toHaveLength(0);
    expect(handle.metrics.registry.render()).toContain(
      `${BODY_WAKEUPS}{reason="directly_addressed"} 1`,
    );
  });

  it('pushes once at start and then on each interval, as OTLP JSON to /v1/metrics on loopback', async () => {
    const fake = await receiver();
    const handle = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: `${fake.url}/` },
      { service: 'geldar-golem', log: quiet, intervalMs: 30 },
    );
    handle.metrics.wake('reflex_danger');
    try {
      await until(() => fake.posts.length >= 3);
      expect(fake.posts.length).toBeGreaterThanOrEqual(3);
      expect(fake.posts[0]?.path).toBe('/v1/metrics');
      expect(fake.posts[0]?.type).toBe('application/json');
      // The push at start was built before the wake was recorded; a later push carries it.
      const bodies = fake.posts.map((post) => JSON.parse(post.body));
      const body = bodies.find((b) => {
        const wakes = b.resourceMetrics[0].scopeMetrics[0].metrics.find(
          (m: { name: string }) => m.name === BODY_WAKEUPS,
        );
        return wakes.sum.dataPoints.length > 0;
      });
      const resource = body.resourceMetrics[0].resource.attributes;
      expect(resource).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'geldar-golem' },
      });
      const wakes = body.resourceMetrics[0].scopeMetrics[0].metrics.find(
        (m: { name: string }) => m.name === BODY_WAKEUPS,
      );
      expect(wakes.sum.dataPoints[0].asDouble).toBe(1);
      expect(wakes.sum.dataPoints[0].attributes).toEqual([
        { key: 'reason', value: { stringValue: 'reflex_danger' } },
      ]);
    } finally {
      await handle.stop();
      await fake.close();
    }
  });

  it('after stop, no further push arrives', async () => {
    const fake = await receiver();
    const handle = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: fake.url },
      { service: 'geldar-golem', log: quiet, intervalMs: 20 },
    );
    await until(() => fake.posts.length >= 1);
    await handle.stop();
    const after = fake.posts.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    await fake.close();
    expect(fake.posts.length).toBe(after);
  });

  it('stop waits for a push held open by the receiver, and no push starts or arrives after it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = await receiver(200, gate);
    const starts: string[] = [];
    const countingFetch = ((url: string, init?: RequestInit) => {
      starts.push(url);
      return fetch(url, init);
    }) as unknown as typeof fetch;
    const handle = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: fake.url },
      { service: 'geldar-golem', log: quiet, intervalMs: 20, fetch: countingFetch },
    );
    try {
      // The first push has reached the receiver and is held open: its answer has not come back.
      await until(() => fake.posts.length >= 1);
      let settled = false;
      const stopping = handle.stop().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(settled).toBe(false);
      release();
      await stopping;
      expect(settled).toBe(true);
      const started = starts.length;
      const arrived = fake.posts.length;
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(starts.length).toBe(started);
      expect(fake.posts.length).toBe(arrived);
    } finally {
      release();
      await fake.close();
    }
  });

  it('logs a refused push with its status and does not throw', async () => {
    const fake = await receiver(503);
    const seen: Record<string, string | number>[] = [];
    const handle = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: fake.url },
      { service: 'geldar-golem', log: (line) => seen.push(line), intervalMs: 60_000 },
    );
    try {
      await until(() => seen.length >= 1);
      expect(seen).toEqual([{ event: 'telemetry_push_failed', status: 503 }]);
    } finally {
      await handle.stop();
      await fake.close();
    }
  });

  it('a receiver that never answers: the push aborts at the timeout, is logged, and stop resolves', async () => {
    const fake = await receiver(200, new Promise<void>(() => {}));
    const seen: Record<string, string | number>[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const handle = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: fake.url },
      {
        service: 'geldar-golem',
        log: (line) => seen.push(line),
        intervalMs: 60_000,
        timeoutMs: 50,
      },
    );
    try {
      await until(() => seen.length >= 1);
      expect(seen).toEqual([{ event: 'telemetry_push_failed', status: 0 }]);
      await handle.stop();
      expect(fake.posts).toHaveLength(1);
    } finally {
      await handle.stop();
      await fake.close();
      process.off('unhandledRejection', onUnhandled);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
  }, 3000);

  it('a tick while a push is still in flight starts no second push', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = await receiver(200, gate);
    const handle = startGolemTelemetry(
      { GELDAR_TELEMETRY_URL: fake.url },
      { service: 'geldar-golem', log: quiet, intervalMs: 5 },
    );
    try {
      await until(() => fake.posts.length >= 1);
      // Many 5 ms ticks pass while the first push is held open: none of them sends a second push.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(fake.posts).toHaveLength(1);
    } finally {
      release();
      await handle.stop();
      await fake.close();
    }
  }, 3000);
});
