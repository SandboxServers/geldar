import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import { RecentEvents } from '../mind-link/recent-events.ts';
import type { RequestServer } from '../mind-link/server.ts';
import type { BotVoiceOptions } from '../voice/voice.ts';
import { type AdamBodyEnv, startAdamBody } from './adam-body.ts';
import { parseAdamConfig } from './adam-config.ts';

const voiceOptions = vi.hoisted(() => [] as unknown[]);

// Record what the voice was built with; the class itself stays real.
vi.mock('../voice/voice.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../voice/voice.ts')>();
  class SpyVoice extends real.BotVoice {
    constructor(options: BotVoiceOptions) {
      voiceOptions.push(options);
      super(options);
    }
  }
  return { ...real, BotVoice: SpyVoice };
});

const SHARD = {
  shard: 'phase0',
  tick_rate: 10,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

function config() {
  return parseAdamConfig(SHARD);
}

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

interface Rig {
  env: AdamBodyEnv;
  options: RestartBodyOptions[];
  inner: Record<string, ReturnType<typeof vi.fn>>;
  addressed: string[];
  stops: string[];
  served: string[];
}

function rig(): Rig {
  const options: RestartBodyOptions[] = [];
  const addressed: string[] = [];
  const stops: string[] = [];
  const served: string[] = [];
  const inner = {
    intentChanged: vi.fn(),
    actionChanged: vi.fn(),
    receipt: vi.fn(),
    reflexFired: vi.fn(),
    wake: vi.fn(),
  };
  const server: RequestServer = {
    serve: (subject) => {
      served.push(subject);
      return () => {
        stops.push(`unserve ${subject}`);
      };
    },
  };
  const env: AdamBodyEnv = {
    config: config(),
    kv: {} as AdamBodyEnv['kv'],
    publisher: { publish: async () => undefined },
    server,
    log: () => undefined,
    restart: async (o): Promise<RestartedBody> => {
      options.push(o);
      // What the real createBody does: build the sink, then let the caller wrap it.
      (o as { sink?: unknown }).sink = o.wrapRecords?.(inner as never);
      return {
        generation: 4,
        outcome: { kind: 'idle', reason: 'no_checkpoint' },
        body: {
          executor: {
            notifyAddressed: async (from: string) => {
              addressed.push(from);
            },
            stop: async () => {
              stops.push('executor.stop');
            },
          },
        } as unknown as RestartedBody['body'],
        stop: async () => {
          stops.push('restarted.stop');
        },
      };
    },
  };
  return { env, options, inner, addressed, stops, served };
}

describe('startAdamBody', () => {
  it('passes the life, the next generation source and the config to restartBody', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    const o = r.options[0];
    expect(o?.lifeId).toBe('ag_adam_01');
    expect(o?.timeScale).toBe(2);
    expect(typeof o?.currentRevision).toBe('function');
    expect(running.generation).toBe(4);
    expect(r.served).toHaveLength(2);
    await running.stop();
  });

  it('wraps the record sink with RecentEvents and keeps passing records on', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    const wrapped = (r.options[0] as { sink?: unknown }).sink;
    expect(wrapped).toBeInstanceOf(RecentEvents);
    const digest = wrapped as RecentEvents;
    digest.wake({ reason: 'directly_addressed', tick: 90 } as never);
    expect(r.inner.wake).toHaveBeenCalledTimes(1);
    expect(digest.drainEvents().map((e) => e.type)).toEqual(['wake']);
    await running.stop();
  });

  it('feeds the bot health event to the digest, and stops after stop()', async () => {
    const r = rig();
    const bot = fakeBot();
    const note = vi.spyOn(RecentEvents.prototype, 'noteHealth');
    const running = await startAdamBody(r.env, bot);
    (bot as unknown as { health: number }).health = 15;
    bot.emit('health' as never);
    expect(note).toHaveBeenCalledWith(15, 400);
    await running.stop();
    bot.emit('health' as never);
    expect(note).toHaveBeenCalledTimes(1);
    note.mockRestore();
  });

  it('takes the display name and the voice limits from the config', async () => {
    voiceOptions.length = 0;
    const r = rig();
    const bot = fakeBot();
    const running = await startAdamBody(r.env, bot);
    expect(voiceOptions[0]).toMatchObject({
      username: 'ag_adam_01',
      rateLimitSeconds: 7,
      maxChars: 111,
    });
    // Addressed by the display name, not the username.
    bot.emit('chat' as never, 'Eve' as never, 'Adam, come here' as never);
    expect(r.addressed).toEqual(['Eve']);
    await running.stop();
  });

  it('ends when the bot ends, or when fail() is called', async () => {
    const bot = fakeBot();
    const running = await startAdamBody(rig().env, bot);
    bot.emit('end' as never, 'socketClosed' as never);
    await expect(running.ended).resolves.toBe('bot ended: socketClosed');
    const second = await startAdamBody(rig().env, fakeBot());
    second.fail('executor fault');
    await expect(second.ended).resolves.toBe('executor fault');
  });

  it('quits the bot when the start throws, so the connection makes a fresh one', async () => {
    const quit = vi.fn();
    const bot = Object.assign(fakeBot(), { quit });
    const r = rig();
    r.env.restart = async () => {
      throw new Error('checkpoint unreadable');
    };
    await expect(startAdamBody(r.env, bot)).rejects.toThrow('checkpoint unreadable');
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('settles the start when the bot ends during it, without waiting for the restart', async () => {
    const quit = vi.fn();
    const bot = Object.assign(fakeBot(), { quit });
    const r = rig();
    r.env.restart = () => new Promise<RestartedBody>(() => undefined);
    const starting = startAdamBody(r.env, bot);
    bot.emit('end' as never, 'kicked' as never);
    await expect(starting).rejects.toThrow('bot ended during start: bot ended: kicked');
    expect(quit).not.toHaveBeenCalled();
  });

  it('stops the executor before the link waits for running plans', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    await running.stop();
    expect(r.stops[0]).toBe('executor.stop');
  });
});
