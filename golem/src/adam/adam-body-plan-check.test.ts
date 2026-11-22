import { EventEmitter } from 'node:events';
import { planCheckSubject } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import { SeenMap } from '../building/seen/section.ts';
import { surveyBox } from '../building/seen/survey.ts';
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

function config() {
  return parseAdamConfig(SHARD);
}

/** A bot with what the wiring touches, and a stone pack for the dry run. */
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

/** A Body start over a fake request server; `deliver` calls the handler served on a subject. */
function rig() {
  const handlers = new Map<
    string,
    (data: string, reply: (body: string) => void) => Promise<void>
  >();
  const server: RequestServer = {
    serve: (subject, handler) => {
      handlers.set(subject, handler);
      return () => {
        handlers.delete(subject);
      };
    },
  };
  const deliver = async (subject: string, data: string): Promise<string | undefined> => {
    const handler = handlers.get(subject);
    if (handler === undefined) return undefined;
    let reply: string | undefined;
    await handler(data, (body) => {
      reply = body;
    });
    return reply;
  };
  const env: AdamBodyEnv = {
    config: config(),
    kv: {} as AdamBodyEnv['kv'],
    publisher: { publish: async () => undefined },
    server,
    log: () => undefined,
    restart: async (o: RestartBodyOptions): Promise<RestartedBody> => {
      // What the real createBody does: build the sink, then let the caller wrap it.
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
  };
  return { env, deliver };
}

const PLAN = {
  plan: {
    palette: { stone: { block: 'stone' } },
    steps: [{ op: 'box', pal: 'stone', from: { x: 1, y: 64, z: 1 }, to: { x: 2, y: 64, z: 1 } }],
  },
};

describe('the plan_check reaches the Body, with the building flag (BLD-22b)', () => {
  const subject = () => planCheckSubject(config().shard, config().lifeId);

  it('answers a plan_check from the Body seen map and pack, with the building flag on', async () => {
    const r = rig();
    const restart = r.env.restart as NonNullable<AdamBodyEnv['restart']>;
    const map = new SeenMap();
    map.record(1, 64, 1, 'stone', 10);
    r.env.config = { ...config(), building: true };
    r.env.restart = async (o) => {
      const restarted = await restart(o);
      restarted.body.seen = {
        map,
        ready: Promise.resolve(),
        survey: (box, nowTick) => surveyBox(map, box, nowTick),
        flush: async () => null,
        eraseLife: async () => 0,
        stop: () => undefined,
      };
      return restarted;
    };
    const running = await startAdamBody(r.env, fakeBot());
    const reply = JSON.parse((await r.deliver(subject(), JSON.stringify(PLAN))) ?? 'null');
    expect(reply).not.toEqual({ error: 'not_available' });
    expect(reply).toMatchObject({
      cells: 2,
      unknown_cells: 1,
      material_needs: { stone: { need: 2, have: 3 } },
    });
    await running.stop();
  });

  it('refuses a plan_check with not_available while the building flag is off', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    const reply = await r.deliver(subject(), JSON.stringify(PLAN));
    expect(JSON.parse(reply ?? 'null')).toEqual({ error: 'not_available' });
    await running.stop();
  });
});
