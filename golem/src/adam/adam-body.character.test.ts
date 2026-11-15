import { EventEmitter } from 'node:events';
import { STANDARD_SHEET } from '@geldar/psyche';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import type { LifeCharacter } from '../character/character-config.ts';
import type { RequestServer } from '../mind-link/server.ts';
import { type AdamBodyEnv, startAdamBody } from './adam-body.ts';
import { parseAdamConfig } from './adam-config.ts';

// Counts the AuditPublisher a run builds (AN-07); the class stays real.
const built = vi.hoisted(() => ({ audits: 0 }));
vi.mock('../character/audit-publisher.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../character/audit-publisher.ts')>();
  class CountedAudit extends real.AuditPublisher {
    constructor(options: ConstructorParameters<typeof real.AuditPublisher>[0]) {
      built.audits += 1;
      super(options);
    }
  }
  return { ...real, AuditPublisher: CountedAudit };
});

const SHARD = {
  shard: 'phase0',
  tick_rate: 10,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

const OFF: LifeCharacter = {
  config: { mode: 'off', rolls: false, proficiency: { enabled: false, thresholds: [10, 20, 30] } },
  sheet: null,
  source: 'off',
};
const CONFIG: LifeCharacter = {
  config: {
    mode: 'sheet',
    rolls: true,
    proficiency: { enabled: false, thresholds: [10, 20, 30] },
  },
  sheet: STANDARD_SHEET,
  source: 'config',
};
const STANDARD: LifeCharacter = { ...CONFIG, source: 'standard' };

interface FakeBot extends EventEmitter {
  _client: EventEmitter;
  entity: { position: { x: number; y: number; z: number } };
  game: { dimension: string };
  health: number;
  time: { age: number };
  chat: () => void;
  quit: () => void;
}

/** A bot with only what the wiring touches: events, the clock, a position and quit. */
function fakeBot(): FakeBot {
  const bot = new EventEmitter() as FakeBot;
  bot._client = new EventEmitter();
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  bot.game = { dimension: 'overworld' };
  bot.health = 20;
  bot.time = { age: 400 };
  bot.chat = () => undefined;
  bot.quit = () => undefined;
  return bot;
}

/** Moves the bot to a block position and emits the move the chunk watcher listens for. */
function moveTo(bot: FakeBot, x: number, z: number): void {
  bot.entity.position = { x, y: 64, z };
  bot.emit('move');
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Harness {
  env: AdamBodyEnv;
  published: Array<{ subject: string; body: string }>;
  options: RestartBodyOptions[];
}

/** An env whose restart is a fake that records its options and wraps the record sink, as the real one does. */
function harness(
  character: LifeCharacter | undefined,
  publish: (subject: string, body: string) => Promise<void> = async () => undefined,
  server: RequestServer = { serve: () => () => undefined },
): Harness {
  const published: Array<{ subject: string; body: string }> = [];
  const options: RestartBodyOptions[] = [];
  const env: AdamBodyEnv = {
    config: parseAdamConfig(SHARD),
    kv: {} as AdamBodyEnv['kv'],
    publisher: {
      publish: async (subject: string, body: string) => {
        published.push({ subject, body });
        await publish(subject, body);
      },
    },
    server,
    log: () => undefined,
    ...(character === undefined ? {} : { character }),
    restart: async (o): Promise<RestartedBody> => {
      options.push(o);
      o.wrapRecords?.({} as never);
      return {
        generation: 4,
        outcome: { kind: 'idle', reason: 'no_checkpoint' },
        body: {
          executor: {
            notifyAddressed: async () => undefined,
            stop: async () => undefined,
          },
          runtime: { cancelAction: async () => undefined },
        } as unknown as RestartedBody['body'],
        stop: async () => undefined,
      };
    },
  };
  return { env, published, options };
}

const chunkEvents = (h: Harness) => h.published.filter((e) => e.subject.endsWith('chunk_visited'));

describe('startAdamBody with the character block off or standard (AN-12a)', () => {
  it.each([
    ['omitted', undefined],
    ['off', OFF],
    ['standard', STANDARD],
  ])(
    'builds no audit producer, no threat policy and emits nothing when %s',
    async (_, character) => {
      const h = harness(character);
      const bot = fakeBot();
      const before = built.audits;
      const run = await startAdamBody(h.env, bot as unknown as Bot);
      moveTo(bot, 0, 0);
      moveTo(bot, 16, 0);
      await flush();
      expect(built.audits).toBe(before);
      expect(h.options[0]?.bindThreat?.(4)).toBeUndefined();
      expect(h.published).toEqual([]);
      await run.stop();
    },
  );

  it('a config sheet binds a threat policy, so the same generation gets one', async () => {
    const h = harness(CONFIG);
    const run = await startAdamBody(h.env, fakeBot() as unknown as Bot);
    expect(h.options[0]?.bindThreat?.(4)).toBeDefined();
    await run.stop();
  });
});

describe('startAdamBody with a config sheet: the chunk watcher lifecycle (AN-12a)', () => {
  it('publishes first visits while running, and stops on stop()', async () => {
    const h = harness(CONFIG);
    const bot = fakeBot();
    const run = await startAdamBody(h.env, bot as unknown as Bot);
    moveTo(bot, 0, 0);
    await flush();
    expect(chunkEvents(h)).toHaveLength(1);
    await run.stop();
    moveTo(bot, 16, 0);
    await flush();
    expect(chunkEvents(h)).toHaveLength(1);
  });

  it('a failed start detaches the chunk watcher and quits the bot', async () => {
    const server: RequestServer = {
      serve: () => {
        throw new Error('no serve');
      },
    };
    const h = harness(CONFIG, undefined, server);
    const bot = fakeBot();
    const quit = vi.spyOn(bot, 'quit');
    await expect(startAdamBody(h.env, bot as unknown as Bot)).rejects.toThrow('no serve');
    expect(quit).toHaveBeenCalled();
    moveTo(bot, 0, 0);
    moveTo(bot, 16, 0);
    await flush();
    expect(chunkEvents(h)).toEqual([]);
  });
});

describe('startAdamBody with a rejecting publisher for chunk visits (AN-12a)', () => {
  it('retries a rejected chunk visit a bounded number of times, with no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      let attempts = 0;
      const h = harness(CONFIG, async (subject) => {
        if (!subject.endsWith('chunk_visited')) return;
        attempts += 1;
        throw new Error('nats down');
      });
      const bot = fakeBot();
      const run = await startAdamBody(h.env, bot as unknown as Bot);
      for (let i = 0; i < 5; i += 1) {
        moveTo(bot, 0, 0);
        await flush();
      }
      // Three failed publishes give the chunk up for the run; later moves to it publish nothing.
      expect(attempts).toBe(3);
      await flush();
      expect(unhandled).toEqual([]);
      await run.stop();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
