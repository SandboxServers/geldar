import { EventEmitter } from 'node:events';
import { viewSubject } from '@geldar/contract';
import { canonicalSheetJson, STANDARD_SHEET } from '@geldar/psyche';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import type { RestartBodyOptions, RestartedBody } from '../body/restart.ts';
import { SeenMap } from '../building/seen/section.ts';
import { surveyBox } from '../building/seen/survey.ts';
import type { LifeCharacter } from '../character/character-config.ts';
import { RecentEvents } from '../mind-link/recent-events.ts';
import { planOf } from '../mind-link/server.fakes.ts';
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

const built = vi.hoisted(() => ({ audits: 0 }));

// Counts the AuditPublisher a run builds (AN-07); the class stays real.
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

const linkOptions = vi.hoisted(() => [] as Array<{ publisher: unknown }>);
const speechOptions = vi.hoisted(() => [] as Array<{ publish: (event: unknown) => void }>);

// Record what the link and the speech events were built with; the classes stay real.
vi.mock('../mind-link/server.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../mind-link/server.ts')>();
  class SpyLink extends real.MindLinkServer {
    constructor(options: ConstructorParameters<typeof real.MindLinkServer>[0]) {
      linkOptions.push(options as never);
      super(options);
    }
  }
  return { ...real, MindLinkServer: SpyLink };
});
vi.mock('../voice/speech-event.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../voice/speech-event.ts')>();
  class SpySpeech extends real.SpeechEvents {
    constructor(options: ConstructorParameters<typeof real.SpeechEvents>[0]) {
      speechOptions.push(options as never);
      super(options);
    }
  }
  return { ...real, SpeechEvents: SpySpeech };
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
  /** Sends a request to a subject as NATS would: nothing is delivered once it is unserved. */
  deliver(subject: string, data: string): Promise<string | undefined>;
}

type Handler = (data: string, reply: (body: string) => void) => Promise<void>;

function rig(): Rig {
  const options: RestartBodyOptions[] = [];
  const addressed: string[] = [];
  const stops: string[] = [];
  const served: string[] = [];
  const handlers = new Map<string, Handler>();
  const inner = {
    intentChanged: vi.fn(),
    actionChanged: vi.fn(),
    receipt: vi.fn(),
    reflexFired: vi.fn(),
    wake: vi.fn(),
  };
  const server: RequestServer = {
    serve: (subject, handler) => {
      served.push(subject);
      handlers.set(subject, handler);
      return () => {
        handlers.delete(subject);
        stops.push(`unserve ${subject}`);
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
    restart: async (o): Promise<RestartedBody> => {
      options.push(o);
      // What the real createBody does: build the sink, then let the caller wrap it.
      (o as { sink?: unknown }).sink = o.wrapRecords?.(inner as never);
      return {
        generation: 4,
        outcome: { kind: 'idle', reason: 'no_checkpoint' },
        body: {
          seen: null,
          executor: {
            notifyAddressed: async (from: string) => {
              addressed.push(from);
            },
            stop: async () => {
              stops.push('executor.stop');
            },
          },
          runtime: {
            cancelAction: async () => {
              stops.push('runtime.cancelAction');
            },
          },
        } as unknown as RestartedBody['body'],
        stop: async () => {
          stops.push('restarted.stop');
        },
      };
    },
  };
  return { env, options, inner, addressed, stops, served, deliver };
}

describe('the survey reaches the Body, with the building flag (BLD-38g)', () => {
  const SURVEY = { box: { from: { x: 1, y: 64, z: 1 }, to: { x: 2, y: 64, z: 1 } } };

  it('serves the survey from the Body seen map, and passes the life agent to restartBody', async () => {
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
    linkOptions.length = 0;
    const running = await startAdamBody(r.env, fakeBot());
    expect(r.options[0]).toMatchObject({ building: true, agentId: config().lifeId });
    const survey = (linkOptions[0] as unknown as { survey?: (request: unknown) => unknown }).survey;
    expect(survey).toBeDefined();
    const reply = survey?.(SURVEY) as { text: string; truncated: boolean };
    expect(reply.text).toContain('stone');
    await running.stop();
  });

  it('wires no survey while the building flag is off', async () => {
    const r = rig();
    linkOptions.length = 0;
    const running = await startAdamBody(r.env, fakeBot());
    expect((linkOptions[0] as unknown as { survey?: unknown }).survey).toBeUndefined();
    await running.stop();
  });
});

describe('the action span wiring in a Body (T-07)', () => {
  const done = { action_id: 'w1', state: 'done', result: { status: 'completed' } };

  it('wraps the record sink in the span sink when a tracer is set', async () => {
    const r = rig();
    const started: string[] = [];
    r.env.tracer = {
      startSpan: (name: string) => {
        started.push(name);
        return { setAttribute: () => undefined, end: () => undefined };
      },
    };
    const running = await startAdamBody(r.env, fakeBot());
    // The sink the restart was given is the digest, which forwards to the wrapped chain.
    (
      r.options[0] as unknown as { sink: { actionChanged(record: unknown): void } }
    ).sink.actionChanged(done);
    expect(started).toEqual(['geldar.body.action']);
    expect(r.inner.actionChanged).toHaveBeenCalledTimes(1);
    await running.stop();
  });

  it('forwards records to the inner sink with no span when no tracer is set', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    (
      r.options[0] as unknown as { sink: { actionChanged(record: unknown): void } }
    ).sink.actionChanged(done);
    expect(r.inner.actionChanged).toHaveBeenCalledTimes(1);
    await running.stop();
  });
});

/** Every number and string of a sheet, as text: a log line that carries one of them is a leak. */
function sheetLeaves(value: unknown): string[] {
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...sheetLeaves(inner)]);
}

const OFF: LifeCharacter = {
  config: { mode: 'off', rolls: false, proficiency: { enabled: false, thresholds: [10, 20, 30] } },
  sheet: null,
  source: 'off',
};
const ADOPTED: LifeCharacter = {
  config: {
    mode: 'sheet',
    rolls: false,
    proficiency: { enabled: false, thresholds: [10, 20, 30] },
  },
  sheet: STANDARD_SHEET,
  source: 'config',
};

describe('the character block in a Body (AN-07)', () => {
  it('builds no AuditPublisher and emits no sheet_adopted when omitted or off', async () => {
    for (const character of [undefined, OFF]) {
      built.audits = 0;
      const r = rig();
      const publish = vi.fn(async (_subject: string, _data: string, _id?: string) => undefined);
      const env: AdamBodyEnv = { ...r.env, publisher: { publish } };
      if (character !== undefined) env.character = character;
      const running = await startAdamBody(env, fakeBot());
      await running.stop();
      expect(built.audits).toBe(0);
      expect(publish.mock.calls.map((call) => call[0])).not.toContain(
        'geldar.phase0.sheet_adopted',
      );
    }
  });

  it('with a config sheet, emits one sheet_adopted at start, with source config', async () => {
    built.audits = 0;
    const r = rig();
    const publish = vi.fn(async (_subject: string, _data: string, _id?: string) => undefined);
    const running = await startAdamBody(
      { ...r.env, publisher: { publish }, character: ADOPTED },
      fakeBot(),
    );
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    await running.stop();
    const adoptions = publish.mock.calls.filter(
      (call) => call[0] === 'geldar.phase0.sheet_adopted',
    );
    expect(built.audits).toBe(1);
    expect(adoptions).toHaveLength(1);
    expect(adoptions[0]?.[1]).toContain('"source":"config"');
  });

  it('with the standard fallback sheet, builds nothing and emits no sheet_adopted', async () => {
    built.audits = 0;
    const r = rig();
    const publish = vi.fn(async (_subject: string, _data: string, _id?: string) => undefined);
    const standard: LifeCharacter = { ...ADOPTED, source: 'standard' };
    const running = await startAdamBody(
      { ...r.env, publisher: { publish }, character: standard },
      fakeBot(),
    );
    await running.stop();
    expect(built.audits).toBe(0);
    expect(publish.mock.calls.map((call) => call[0])).not.toContain('geldar.phase0.sheet_adopted');
  });

  it('never writes the sheet into a log line', async () => {
    const r = rig();
    const log = vi.fn();
    const publish = vi.fn(async (_subject: string, _data: string, _id?: string) => undefined);
    const running = await startAdamBody(
      { ...r.env, log, publisher: { publish }, character: ADOPTED },
      fakeBot(),
    );
    await running.stop();
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes(canonicalSheetJson(STANDARD_SHEET)))).toBe(false);
    for (const leaf of sheetLeaves(STANDARD_SHEET).filter((text) => text.length >= 2)) {
      expect(lines.some((line) => line.includes(leaf))).toBe(false);
    }
  });

  describe('the audit publisher is closed with the Body (AN-07)', () => {
    /** An injected publisher: recordAdoption and close are spies, so the test reads the close count. */
    function fakeAudit() {
      const close = vi.fn();
      const audit = { recordAdoption: vi.fn(), close } as unknown as NonNullable<
        AdamBodyEnv['audit']
      >;
      return { audit, close };
    }

    it('closes the audit publisher when the Body stops', async () => {
      const r = rig();
      const { audit, close } = fakeAudit();
      const running = await startAdamBody({ ...r.env, character: ADOPTED, audit }, fakeBot());
      expect(close).not.toHaveBeenCalled();
      await running.stop();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the audit publisher when the start fails after the adoption', async () => {
      const r = rig();
      const { audit, close } = fakeAudit();
      const bot = Object.assign(fakeBot(), { quit: vi.fn() });
      r.env.server = {
        serve: () => {
          throw new Error('nats unavailable');
        },
      };
      await expect(startAdamBody({ ...r.env, character: ADOPTED, audit }, bot)).rejects.toThrow(
        'nats unavailable',
      );
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the audit publisher even when an earlier stop step rejects', async () => {
      const r = rig();
      const { audit, close } = fakeAudit();
      const restart = r.env.restart as NonNullable<AdamBodyEnv['restart']>;
      r.env.restart = async (o) => {
        const restarted = await restart(o);
        restarted.body.executor.stop = async () => {
          throw new Error('executor would not stop');
        };
        return restarted;
      };
      const running = await startAdamBody({ ...r.env, character: ADOPTED, audit }, fakeBot());
      await expect(running.stop()).rejects.toThrow('executor would not stop');
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});

describe('the ownership client in a Body (decisions 0164, 0165)', () => {
  it('a Body given a transport subscribes to the change subject, so goto reads the record', async () => {
    const r = rig();
    const subscribed: string[] = [];
    const owners = {
      request: async () => {
        throw new Error('no query in this test');
      },
      subscribe: (subject: string) => {
        subscribed.push(subject);
        return { unsubscribe: () => undefined };
      },
    };
    const running = await startAdamBody({ ...r.env, owners }, fakeBot());
    expect(subscribed).toEqual(['geldar.phase0.blockowner.changed']);
    await running.stop();
  });
});

describe('startAdamBody', () => {
  /** Drives a heard sound, a hurt, and a record through the NATS publisher the Body hands restartBody. */
  async function publishSome(stamped: boolean): Promise<string[]> {
    const r = rig();
    const sent: string[] = [];
    const bot = fakeBot();
    const agent = stamped
      ? { username: 'ag_adam_01', name: 'Adam', harness: 'animus', model: 'tier-large' }
      : { username: 'ag_adam_01', name: 'Adam' };
    const env: AdamBodyEnv = {
      ...r.env,
      config: parseAdamConfig({ ...SHARD, mind: { agent } }),
      publisher: {
        publish: async (_subject: string, body: string) => {
          sent.push(body);
        },
      },
    };
    const running = await startAdamBody(env, bot);
    // The heard sound (perception/heard-sound-event.ts), then the hurt (perception/hurt-trigger.ts).
    bot.emit('soundEffectHeard' as never, 'entity.creeper.primed', { x: 2, y: 64, z: 0 } as never);
    bot.emit('entityHurt' as never, bot.entity as never);
    (bot as unknown as { health: number }).health = 15;
    bot.emit('health' as never);
    // The record sink's publisher (body/records-nats.ts), as restartBody was given it.
    await r.options[0]?.nats?.publisher.publish(
      'geldar.phase0.action_outcome',
      JSON.stringify({
        type: 'action_outcome',
        agent_id: 'ag_adam_01',
        source_event_id: 'ev-nats-1',
      }),
      'ev-nats-1',
    );
    await running.stop();
    return sent;
  }

  it('every published event is stamped with the run harness and model', async () => {
    const sent = await publishSome(true);
    const events = sent.map((body) => JSON.parse(body) as Record<string, unknown>);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['heard_sound', 'damage', 'action_outcome']),
    );
    for (const event of events) {
      expect(event).toMatchObject({ harness: 'animus', model: 'tier-large' });
    }
  });

  it('the speech and plan_result publishers are the stamping wrapper, not env.publisher', async () => {
    const r = rig();
    const sent: string[] = [];
    const raw = {
      publish: async (_subject: string, body: string) => {
        sent.push(body);
      },
    };
    const env: AdamBodyEnv = {
      ...r.env,
      config: parseAdamConfig({
        ...SHARD,
        mind: {
          agent: { username: 'ag_adam_01', name: 'Adam', harness: 'animus', model: 'tier-large' },
        },
      }),
      publisher: raw,
    };
    speechOptions.length = 0;
    linkOptions.length = 0;
    const running = await startAdamBody(env, fakeBot());
    const link = linkOptions[0]?.publisher as AdamBodyEnv['publisher'];
    expect(link).not.toBe(raw);
    await link.publish(
      'geldar.phase0.plan_result',
      JSON.stringify({ type: 'plan_result', agent_id: 'ag_adam_01', source_event_id: 'ev-plan-1' }),
      'ev-plan-1',
    );
    speechOptions[0]?.publish({
      type: 'speech',
      agent_id: 'ag_adam_01',
      source_event_id: 'ev-speech-1',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(JSON.parse(body)).toMatchObject({ harness: 'animus', model: 'tier-large' });
    }
    await running.stop();
  });

  it('an unstamped run publishes without the stamp fields', async () => {
    const sent = await publishSome(false);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const body of sent) expect(body).not.toContain('"harness"');
  });

  it('passes the life, the next generation source and the config to restartBody', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    const o = r.options[0];
    expect(o?.lifeId).toBe('ag_adam_01');
    expect(o?.timeScale).toBe(2);
    expect(typeof o?.currentRevision).toBe('function');
    expect(running.generation).toBe(4);
    // The four Body subjects of the link (snapshot, plan, view, survey), and the image subject of VP-2 (decision 0156).
    expect(r.served).toHaveLength(5);
    expect(r.served.filter((s) => s.endsWith('.image'))).toHaveLength(1);
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

  it('answers a view request with the bot text viewport, not unavailable', async () => {
    const r = rig();
    const bot = fakeBot();
    Object.assign(bot, { world: { getBlock: () => null }, entities: {} });
    // A real Vec3 position: the view reads the eyes with `position.offset`, as mineflayer's does.
    Object.assign(bot.entity, { yaw: 0, pitch: 0, position: new Vec3(0, 64, 0) });
    const running = await startAdamBody(r.env, bot);
    const { shard, lifeId } = config();
    const reply = await r.deliver(viewSubject(shard, lifeId), '{}');
    const parsed = JSON.parse(reply ?? '{}') as { text?: unknown; error?: unknown };
    expect(parsed.error).toBeUndefined();
    expect(typeof parsed.text).toBe('string');
    await running.stop();
  });

  it('writes the hurt as its own JSON line with event hurt and the place of the Body', async () => {
    const r = rig();
    const bot = fakeBot();
    const lines: string[] = [];
    const diag = { log: (line: string) => lines.push(line), now: () => 0 };
    const running = await startAdamBody({ ...r.env, diag }, bot);
    (bot as unknown as { health: number }).health = 15;
    bot.emit('health' as never);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.find((o) => o.event === 'hurt')).toMatchObject({
      event: 'hurt',
      x: 0,
      y: 64,
      z: 0,
    });
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

  it('quits the bot and stops the restarted Body when the link cannot start', async () => {
    const quit = vi.fn();
    const bot = Object.assign(fakeBot(), { quit });
    const r = rig();
    r.env.server = {
      serve: () => {
        throw new Error('nats unavailable');
      },
    };
    await expect(startAdamBody(r.env, bot)).rejects.toThrow('nats unavailable');
    expect(quit).toHaveBeenCalledTimes(1);
    expect(r.stops).toEqual(['restarted.stop']);
    expect(bot.listenerCount('end')).toBe(0);
    expect(bot.listenerCount('health')).toBe(0);
    expect(bot.listenerCount('chat')).toBe(0);
  });

  it('unserves first, then stops the executor and the action, then the Body', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    await running.stop();
    expect(r.stops).toEqual([
      `unserve ${r.served[0]}`,
      `unserve ${r.served[1]}`,
      `unserve ${r.served[2]}`,
      `unserve ${r.served[3]}`,
      `unserve ${r.served[4]}`,
      'executor.stop',
      'runtime.cancelAction',
      'restarted.stop',
    ]);
  });

  it('accepts no plan once stopping has begun, though the stop is still running', async () => {
    const r = rig();
    const running = await startAdamBody(r.env, fakeBot());
    const stopping = running.stop();
    for (const subject of r.served) {
      expect(await r.deliver(subject, JSON.stringify(planOf(1)))).toBeUndefined();
    }
    await stopping;
  });
});
