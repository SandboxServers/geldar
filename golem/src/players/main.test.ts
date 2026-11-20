import { bookSubject } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { AdamBodyEnv } from '../adam/adam-body.ts';
import { GolemMetrics, MetricRegistry } from '../metrics.ts';
import { FakeRequestServer, LIFE, SHARD } from '../mind-link/server.fakes.ts';
import {
  bookServe,
  playerBodyEnv,
  playerIdFromArgs,
  startPlayerBody,
  startPlayerTelemetry,
} from './main.ts';

// The Body itself is not under test here: the stub stands in for `startAdamBody`, so the
// `extraServe` path of `startPlayerBody` runs for real.
vi.mock('../adam/adam-body.ts', () => ({
  startAdamBody: async () => ({ stop: async () => {} }),
}));

const WRITTEN = {
  name: 'written_book',
  count: 1,
  components: [
    {
      name: 'minecraft:written_book_content',
      data: { title: 'Field notes', author: 'Jason', pages: ['Walk north.'] },
    },
  ],
};
const OTHER_LIFE = 'ag_jason_01';

function bot(): Bot {
  return { heldItem: WRITTEN, inventory: { items: () => [] } } as unknown as Bot;
}

describe('the player host body env (decision 0165)', () => {
  it('carries the host connection as the ownership transport, so the ranger Body wires it', () => {
    const nc = {} as Parameters<typeof playerBodyEnv>[0]['nc'];
    const env = playerBodyEnv({
      config: {} as AdamBodyEnv['config'],
      kv: {} as AdamBodyEnv['kv'],
      publisher: { publish: async () => undefined },
      nc,
      server: new FakeRequestServer(),
      log: () => {},
    });
    expect(env.owners).toBe(nc);
  });
});

function bodyEnvFor(metrics?: GolemMetrics): AdamBodyEnv {
  return playerBodyEnv({
    config: {} as AdamBodyEnv['config'],
    kv: {} as AdamBodyEnv['kv'],
    publisher: { publish: async () => undefined },
    nc: {} as Parameters<typeof playerBodyEnv>[0]['nc'],
    server: new FakeRequestServer(),
    log: () => {},
    ...(metrics === undefined ? {} : { metrics }),
  });
}

describe('the player host metrics (decision 0088)', () => {
  it('hands the host metrics to the ranger Body, and gives none when the host has none', () => {
    const metrics = new GolemMetrics(new MetricRegistry());
    expect(bodyEnvFor(metrics).metrics).toBe(metrics);
    expect(bodyEnvFor().metrics).toBeUndefined();
  });

  it('with GELDAR_TELEMETRY_URL set, starts a push at once to /v1/metrics with the player service name', async () => {
    const bodies: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:4318/v1/metrics');
      bodies.push(String(init.body));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const handle = startPlayerTelemetry(
      { GELDAR_TELEMETRY_URL: 'http://127.0.0.1:4318' },
      () => {},
      { fetch: fake, intervalMs: 60_000 },
    );
    // The first push is sent synchronously at start; the body is read after it.
    expect(bodies).toHaveLength(1);
    await handle.stop();
    expect(bodies[0]).toContain('geldar-golem-player');
  });

  it('with GELDAR_TELEMETRY_URL unset, starts no timer and makes no request', async () => {
    const timers = vi.spyOn(globalThis, 'setInterval');
    const requests: string[] = [];
    const fake = (async (url: string) => {
      requests.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const before = timers.mock.calls.length;
    const handle = startPlayerTelemetry({}, () => {}, { fetch: fake, intervalMs: 5 });
    const blank = startPlayerTelemetry({ GELDAR_TELEMETRY_URL: '  ' }, () => {}, {
      fetch: fake,
      intervalMs: 5,
    });
    const started = timers.mock.calls.length - before;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handle.stop();
    await blank.stop();
    timers.mockRestore();
    expect(started).toBe(0);
    expect(requests).toHaveLength(0);
  });
});

describe('playerIdFromArgs', () => {
  it('reads the id after --player', () => {
    expect(playerIdFromArgs(['--player', 'ag-jason-01'])).toBe('ag-jason-01');
    expect(playerIdFromArgs(['x', '--player', 'ag-jason-01'])).toBe('ag-jason-01');
  });

  it('refuses a missing id, and a flag where the id belongs', () => {
    expect(() => playerIdFromArgs([])).toThrow(/usage: main.ts --player/);
    expect(() => playerIdFromArgs(['--player'])).toThrow(/usage/);
    expect(() => playerIdFromArgs(['--player', '--other'])).toThrow(/usage/);
  });
});

describe('startPlayerBody with the book server beside the Body', () => {
  const env = {} as AdamBodyEnv;

  it('answers the book request for the bound life, and stops serving it with the Body', async () => {
    const server = new FakeRequestServer();
    const running = await startPlayerBody(
      env,
      bot(),
      bookServe({ shard: SHARD, lifeId: LIFE, server, log: () => {} }),
    );
    const reply = await server.request(bookSubject(SHARD, LIFE), JSON.stringify({ life_id: LIFE }));
    expect(JSON.parse(reply ?? '{}').status).toBe('ok');
    await running.stop();
    expect(server.subjects).toEqual([]);
  });

  it('does not answer a book request that names another life', async () => {
    const server = new FakeRequestServer();
    const running = await startPlayerBody(
      env,
      bot(),
      bookServe({ shard: SHARD, lifeId: LIFE, server, log: () => {} }),
    );
    const reply = await server.request(
      bookSubject(SHARD, LIFE),
      JSON.stringify({ life_id: OTHER_LIFE }),
    );
    expect(reply).toBeNull();
    await expect(
      server.request(bookSubject(SHARD, OTHER_LIFE), JSON.stringify({ life_id: OTHER_LIFE })),
    ).rejects.toThrow(/nobody serves/);
    await running.stop();
  });
});
