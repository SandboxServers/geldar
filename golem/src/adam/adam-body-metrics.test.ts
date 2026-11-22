import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import type { GolemMetrics } from '../metrics.ts';
import type { RequestServer } from '../mind-link/server.ts';
import { type AdamBodyEnv, startAdamBody } from './adam-body.ts';
import { parseAdamConfig } from './adam-config.ts';

const SHARD = {
  shard: 'phase0',
  tick_rate: 10,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

/** A bot with what the wiring touches at start. */
function fakeBot(): Bot {
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot._client = new EventEmitter();
  bot.chat = () => undefined;
  bot.time = { age: 400 };
  bot.health = 20;
  bot.entity = { position: { x: 1.5, y: 64, z: 1.5 } };
  bot.inventory = { items: () => [{ name: 'stone', count: 3 }] };
  return bot as unknown as Bot;
}

/** A metrics object that takes any counter call; the test checks which object reaches the Body. */
function anyMetrics(): GolemMetrics {
  return new Proxy({}, { get: () => vi.fn() }) as GolemMetrics;
}

/** A start over a fake restart that records the options it was called with. */
function rig(metrics?: GolemMetrics) {
  const server: RequestServer = { serve: () => () => undefined };
  const restarts: RestartBodyOptions[] = [];
  const env: AdamBodyEnv = {
    config: parseAdamConfig(SHARD),
    kv: {} as AdamBodyEnv['kv'],
    publisher: { publish: async () => undefined },
    server,
    log: () => undefined,
    restart: async (o: RestartBodyOptions): Promise<RestartedBody> => {
      restarts.push(o);
      (o as { sink?: unknown }).sink = o.wrapRecords?.({} as never);
      return {
        generation: 4,
        outcome: { kind: 'idle', reason: 'no_checkpoint' },
        body: {
          seen: null,
          executor: { notifyAddressed: async () => undefined, stop: async () => undefined },
          runtime: { cancelAction: async () => undefined },
        } as unknown as RestartedBody['body'],
        stop: async () => undefined,
      };
    },
    ...(metrics === undefined ? {} : { metrics }),
  };
  return { env, restarts };
}

describe('startAdamBody hands its metrics to the restarted Body', () => {
  it('restart receives the env metrics object, the same one', async () => {
    const metrics = anyMetrics();
    const r = rig(metrics);
    const running = await startAdamBody(r.env, fakeBot());
    expect(r.restarts.length).toBeGreaterThan(0);
    for (const o of r.restarts) expect(o.metrics).toBe(metrics);
    await running.stop();
  });

  it('restart gets no metrics when the env has none', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    expect(r.restarts.length).toBeGreaterThan(0);
    for (const o of r.restarts) expect(o.metrics).toBeUndefined();
    await running.stop();
  });
});
