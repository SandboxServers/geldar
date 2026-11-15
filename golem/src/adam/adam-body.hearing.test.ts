import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import type { RequestServer } from '../mind-link/server.ts';
import type { HearingTransport } from '../perception/heard-muffled-event.ts';
import { type AdamBodyEnv, startAdamBody } from './adam-body.ts';
import { parseAdamConfig } from './adam-config.ts';

const SHARD = {
  shard: 'phase0',
  tick_rate: 10,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

/** A bot with only what the wiring touches: events, a client, chat, the clock and health. */
function fakeBot(): Bot {
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot._client = new EventEmitter();
  bot.chat = () => undefined;
  bot.time = { age: 400 };
  bot.health = 20;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  return bot as unknown as Bot;
}

/** A hearing transport that counts its subscribes and the unsubscribes of what it handed out. */
function fakeHearing(): {
  counts: { subscribes: number; unsubscribes: number };
  hearing: HearingTransport;
} {
  const counts = { subscribes: 0, unsubscribes: 0 };
  return {
    counts,
    hearing: {
      subscribe() {
        counts.subscribes += 1;
        return {
          unsubscribe() {
            counts.unsubscribes += 1;
          },
        };
      },
    },
  };
}

/** The env of a start that succeeds unless `over` replaces a step. */
function envWith(hearing: HearingTransport, over: Partial<AdamBodyEnv> = {}): AdamBodyEnv {
  const server: RequestServer = { serve: () => () => undefined };
  const env: AdamBodyEnv = {
    config: parseAdamConfig(SHARD),
    kv: {} as AdamBodyEnv['kv'],
    publisher: { publish: async () => undefined },
    server,
    hearing,
    log: () => undefined,
    restart: async (o: RestartBodyOptions): Promise<RestartedBody> => {
      const inner = {
        intentChanged: vi.fn(),
        actionChanged: vi.fn(),
        receipt: vi.fn(),
        reflexFired: vi.fn(),
        wake: vi.fn(),
      };
      o.wrapRecords?.(inner as never);
      return {
        generation: 4,
        outcome: { kind: 'idle', reason: 'no_checkpoint' },
        body: {
          executor: { notifyAddressed: async () => undefined, stop: async () => undefined },
          runtime: { cancelAction: async () => undefined },
        } as unknown as RestartedBody['body'],
        stop: async () => undefined,
      };
    },
  };
  return { ...env, ...over };
}

describe('the hearing subscription of a Body (MH-4): one unsubscribe per start, on every exit', () => {
  it('stop() unsubscribes once when the bot is still connected', async () => {
    const h = fakeHearing();
    const running = await startAdamBody(envWith(h.hearing), fakeBot());
    await running.stop();
    expect(h.counts).toEqual({ subscribes: 1, unsubscribes: 1 });
  });

  it('stop() after the bot ended unsubscribes once, not twice', async () => {
    const h = fakeHearing();
    const bot = fakeBot();
    const running = await startAdamBody(envWith(h.hearing), bot);
    bot.emit('end' as never, 'socketClosed' as never);
    await expect(running.ended).resolves.toBe('bot ended: socketClosed');
    expect(h.counts.unsubscribes).toBe(1);
    await running.stop();
    expect(h.counts).toEqual({ subscribes: 1, unsubscribes: 1 });
  });

  it('fail() unsubscribes once, before any stop(), and a stop() after it does not again', async () => {
    const h = fakeHearing();
    const running = await startAdamBody(envWith(h.hearing), fakeBot());
    running.fail('executor fault');
    await expect(running.ended).resolves.toBe('executor fault');
    expect(h.counts.unsubscribes).toBe(1);
    await running.stop();
    expect(h.counts).toEqual({ subscribes: 1, unsubscribes: 1 });
  });

  it('a restart that throws unsubscribes once and quits the bot', async () => {
    const h = fakeHearing();
    const quit = vi.fn();
    const bot = Object.assign(fakeBot(), { quit });
    const env = envWith(h.hearing, {
      restart: async () => {
        throw new Error('checkpoint unreadable');
      },
    });
    await expect(startAdamBody(env, bot)).rejects.toThrow('checkpoint unreadable');
    expect(h.counts).toEqual({ subscribes: 1, unsubscribes: 1 });
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('a bot that ends during the start unsubscribes once, not again in the failure path', async () => {
    const h = fakeHearing();
    const quit = vi.fn();
    const bot = Object.assign(fakeBot(), { quit });
    const env = envWith(h.hearing, { restart: () => new Promise<RestartedBody>(() => undefined) });
    const starting = startAdamBody(env, bot);
    bot.emit('end' as never, 'kicked' as never);
    await expect(starting).rejects.toThrow('bot ended during start: bot ended: kicked');
    expect(h.counts).toEqual({ subscribes: 1, unsubscribes: 1 });
    expect(quit).not.toHaveBeenCalled();
  });

  it('a start that fails after the restart (the link cannot serve) unsubscribes once and quits the bot', async () => {
    const h = fakeHearing();
    const quit = vi.fn();
    const bot = Object.assign(fakeBot(), { quit });
    const env = envWith(h.hearing, {
      server: {
        serve: () => {
          throw new Error('nats unavailable');
        },
      },
    });
    await expect(startAdamBody(env, bot)).rejects.toThrow('nats unavailable');
    expect(h.counts).toEqual({ subscribes: 1, unsubscribes: 1 });
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
