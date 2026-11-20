import { EventEmitter } from 'node:events';
import {
  provenanceBreakSubject,
  provenanceCombatSubject,
  provenancePickupSubject,
  provenanceTakeSubject,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import type { RequestServer } from '../mind-link/server.ts';
import { watchHurts } from '../perception/hurt-trigger.ts';
import { observedActor } from '../perception/provenance/visible-actor.ts';
import { type AdamBodyEnv, startAdamBody } from './adam-body.ts';
import { parseAdamConfig } from './adam-config.ts';

// Counts the calls to watchHurts; the function itself stays real.
vi.mock('../perception/hurt-trigger.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../perception/hurt-trigger.ts')>();
  return { ...real, watchHurts: vi.fn(real.watchHurts) };
});

const SHARD = 'phase0';
const BREAK = provenanceBreakSubject(SHARD);
const PICKUP = provenancePickupSubject(SHARD);
const TAKE = provenanceTakeSubject(SHARD);
const COMBAT = provenanceCombatSubject(SHARD);
const PROVENANCE = [BREAK, PICKUP, TAKE, COMBAT];

const CONFIG = {
  shard: SHARD,
  tick_rate: 10,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

interface Sub {
  subject: string;
  opts: object;
  unsubscribed: boolean;
}

/** A Body env as the production callers build it, with a recording transport for the Body's connection. */
function envWith(extra: Partial<AdamBodyEnv> = {}, serveFails = false) {
  const subs: Sub[] = [];
  const owners = {
    request: async () => {
      throw new Error('not used');
    },
    subscribe(subject: string, opts: object) {
      const sub: Sub = { subject, opts, unsubscribed: false };
      subs.push(sub);
      return {
        unsubscribe() {
          sub.unsubscribed = true;
        },
      };
    },
  };
  const server: RequestServer = {
    serve: () => {
      if (serveFails) throw new Error('serve refused');
      return () => undefined;
    },
  };
  const inner = {
    intentChanged: vi.fn(),
    actionChanged: vi.fn(),
    receipt: vi.fn(),
    reflexFired: vi.fn(),
    wake: vi.fn(),
  };
  const env: AdamBodyEnv = {
    config: parseAdamConfig(CONFIG),
    kv: {} as AdamBodyEnv['kv'],
    publisher: { publish: async () => undefined },
    server,
    owners,
    log: () => undefined,
    restart: async (o: RestartBodyOptions): Promise<RestartedBody> => {
      (o as { sink?: unknown }).sink = o.wrapRecords?.(inner as never);
      return {
        generation: 1,
        outcome: { kind: 'idle', reason: 'no_checkpoint' },
        body: {
          executor: { notifyAddressed: async () => undefined, stop: async () => undefined },
          runtime: { cancelAction: async () => undefined },
        } as unknown as RestartedBody['body'],
        stop: async () => undefined,
      };
    },
    ...extra,
  };
  return { env, subs };
}

/** A bot with only what the wiring touches. */
function fakeBot(): Bot {
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot._client = new EventEmitter();
  bot.chat = () => undefined;
  bot.time = { age: 400 };
  bot.health = 20;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  bot.blockAt = () => null;
  bot.quit = () => undefined;
  return bot as unknown as Bot;
}

const provenanceSubjects = (subs: Sub[]) =>
  subs.map((s) => s.subject).filter((s) => PROVENANCE.includes(s));

describe('the observed evidence in a Body (AN-28b)', () => {
  it('observations off (absent): no provenance subscription and watchHurts gets three arguments', async () => {
    vi.mocked(watchHurts).mockClear();
    const { env, subs } = envWith();
    const running = await startAdamBody(env, fakeBot());
    expect(provenanceSubjects(subs)).toEqual([]);
    expect(vi.mocked(watchHurts).mock.calls[0]).toHaveLength(3);
    await running.stop();
  });

  it('observations false: the same as absent', async () => {
    vi.mocked(watchHurts).mockClear();
    const { env, subs } = envWith({ observations: false });
    const running = await startAdamBody(env, fakeBot());
    expect(provenanceSubjects(subs)).toEqual([]);
    expect(vi.mocked(watchHurts).mock.calls[0]).toHaveLength(3);
    await running.stop();
  });

  it('observations on without the Body connection: no subscription and three arguments', async () => {
    vi.mocked(watchHurts).mockClear();
    const { env, subs } = envWith({ observations: true });
    delete env.owners;
    const running = await startAdamBody(env, fakeBot());
    expect(subs).toEqual([]);
    expect(vi.mocked(watchHurts).mock.calls[0]).toHaveLength(3);
    await running.stop();
  });

  it('observations on: all four subjects subscribed with no replay option, watchHurts gets four arguments, and stop unsubscribes both', async () => {
    vi.mocked(watchHurts).mockClear();
    const { env, subs } = envWith({ observations: true });
    const running = await startAdamBody(env, fakeBot());
    expect(provenanceSubjects(subs)).toEqual([BREAK, PICKUP, TAKE, COMBAT]);
    for (const sub of subs.filter((s) => PROVENANCE.includes(s.subject))) {
      expect(Object.keys(sub.opts)).toEqual(['callback']);
    }
    expect(vi.mocked(watchHurts).mock.calls[0]).toHaveLength(4);
    await running.stop();
    expect(subs.filter((s) => PROVENANCE.includes(s.subject)).map((s) => s.unsubscribed)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('watchHurts gets this Body observed-actor function: it names the visible player and no one else', async () => {
    vi.mocked(watchHurts).mockClear();
    const bot = Object.assign(fakeBot() as unknown as Record<string, unknown>, {
      username: 'ag_adam_01',
      entity: { position: new Vec3(0, 64, 0) },
      entities: {
        7: { type: 'player', username: 'ag_capb_02', position: new Vec3(4, 64, 0), height: 1.8 },
      },
      world: { raycast: () => null },
    }) as unknown as Bot;
    const { env } = envWith({ observations: true });
    const running = await startAdamBody(env, bot);
    const observed = vi.mocked(watchHurts).mock.calls[0]?.[3];
    expect(observed).toBeTypeOf('function');
    for (const name of ['ag_capb_02', 'ag_absent_03', 'ag_adam_01', undefined]) {
      expect(observed?.(name)).toEqual(observedActor(bot, name));
    }
    expect(observed?.('ag_capb_02')).toMatchObject({ name: 'ag_capb_02' });
    expect(observed?.('ag_absent_03')).toBeNull();
    await running.stop();
  });

  it('a start that fails after the subscription unsubscribes both subjects', async () => {
    const { env, subs } = envWith({ observations: true }, true);
    await expect(startAdamBody(env, fakeBot())).rejects.toThrow('serve refused');
    expect(provenanceSubjects(subs)).toEqual([BREAK, PICKUP, TAKE, COMBAT]);
    expect(subs.filter((s) => PROVENANCE.includes(s.subject)).map((s) => s.unsubscribed)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});
