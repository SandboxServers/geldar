import { EventEmitter } from 'node:events';
import type { Bot, BotOptions } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ConnectionManager } from '../src/connection.ts';
import {
  type BotRegistry,
  LifeRegistration,
  lifeIdFor,
  type OpenedRegistry,
  registryFromConfig,
  registryKey,
} from '../src/registry.ts';

const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

/** A fake KV that records every call, in order, into a shared log. */
function fakeKv(log: string[]): OpenedRegistry {
  return {
    kv: {
      put: async (key, value) => {
        log.push(`put ${key} ${value}`);
      },
      delete: async (key) => {
        log.push(`delete ${key}`);
      },
    },
    close: async () => {
      log.push('close');
    },
  };
}

describe('lifeIdFor and registryKey', () => {
  it('always matches the LifeId pattern of the contract', () => {
    for (const name of ['GolemBench', 'Golem_Smoke', '9lives', '___', 'A', 'x'.repeat(40), 'Ünï']) {
      expect(lifeIdFor(name)).toMatch(LIFE_ID);
    }
    expect(lifeIdFor('GolemBench')).toBe('ag_golembench_01');
    expect(lifeIdFor('9Lives_')).toBe('ag_lives_01');
  });

  it('keys by the lowercase username, as the plugin looks it up', () => {
    expect(registryKey('GolemBench')).toBe('golembench');
  });
});

describe('LifeRegistration', () => {
  it('puts {life_id, registered_at} under the lowercase username', async () => {
    const log: string[] = [];
    const reg = new LifeRegistration(
      async () => fakeKv(log),
      () => new Date('2026-01-02T03:04:05.000Z'),
    );
    await reg.register('GolemBench');
    expect(log).toEqual([
      `put golembench ${JSON.stringify({ life_id: 'ag_golembench_01', registered_at: '2026-01-02T03:04:05.000Z' })}`,
    ]);
  });

  it('opens NATS once for many registrations and deletes the key on unregister', async () => {
    const log: string[] = [];
    const open = vi.fn(async () => fakeKv(log));
    const reg = new LifeRegistration(open);
    await reg.register('Bot');
    await reg.register('Bot');
    await reg.unregister('Bot');
    expect(open).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l.startsWith('delete'))).toEqual(['delete bot']);
  });

  it('fails every register with the open error while NATS is down, then recovers', async () => {
    const log: string[] = [];
    let up = false;
    const reg = new LifeRegistration(async () => {
      if (!up) throw new Error('NATS is unreachable at nats://127.0.0.1:4222');
      return fakeKv(log);
    });
    await expect(reg.register('Bot')).rejects.toThrow(/unreachable/);
    up = true;
    await reg.register('Bot');
    expect(log).toHaveLength(1);
  });

  it('drops a connection whose put failed so the next register reopens', async () => {
    const log: string[] = [];
    let first = true;
    const open = vi.fn(async (): Promise<OpenedRegistry> => {
      const opened = fakeKv(log);
      if (first) {
        first = false;
        opened.kv.put = async () => {
          throw new Error('connection closed');
        };
      }
      return opened;
    });
    const reg = new LifeRegistration(open);
    await expect(reg.register('Bot')).rejects.toThrow(/closed/);
    await reg.register('Bot');
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('registryFromConfig and GELDAR_NATS_URL', () => {
  it('is off unless GELDAR_NATS_URL is set', () => {
    expect(registryFromConfig(loadConfig({}))).toBeUndefined();
    expect(registryFromConfig(loadConfig({ GELDAR_NATS_URL: '' }))).toBeUndefined();
    expect(
      registryFromConfig(loadConfig({ GELDAR_NATS_URL: 'nats://127.0.0.1:4222' })),
    ).toBeDefined();
  });

  it('refuses a malformed or non-loopback URL', () => {
    expect(() => loadConfig({ GELDAR_NATS_URL: 'http://127.0.0.1:4222' })).toThrow(/nats:\/\//);
    expect(() => loadConfig({ GELDAR_NATS_URL: 'nonsense' })).toThrow(/nats:\/\//);
    expect(() => loadConfig({ GELDAR_NATS_URL: 'nats://nats:4222' })).toThrow(/127\.0\.0\.1/);
  });
});

class FakeBot extends EventEmitter {
  quit = vi.fn();
  _client = new EventEmitter();
}

/** A manager over fake bots and the given registry; every step lands in `log`. */
function managed(registry: BotRegistry, log: string[]) {
  const bots: FakeBot[] = [];
  const manager = new ConnectionManager({
    host: '127.0.0.1',
    port: 25565,
    username: 'GolemBench',
    createBot: (_o: BotOptions) => {
      log.push('connect');
      const bot = new FakeBot();
      bots.push(bot);
      return bot as unknown as Bot;
    },
    sleep: async () => {},
    rng: () => 0.5,
    log: () => {},
    registry,
  });
  return { bots, manager };
}

/** A registry whose calls are logged; `failRegister` decides per call whether it throws. */
function loggedRegistry(log: string[], failRegister: (n: number) => boolean = () => false) {
  let calls = 0;
  const registry: BotRegistry = {
    register: async (u) => {
      calls += 1;
      if (failRegister(calls)) throw new Error('NATS is unreachable at nats://127.0.0.1:4222');
      log.push(`register ${u}`);
    },
    unregister: async (u) => {
      log.push(`unregister ${u}`);
    },
    close: async () => {
      log.push('close');
    },
  };
  return registry;
}

describe('ConnectionManager with a registry', () => {
  it('registers before the first connect and deletes on stop', async () => {
    const log: string[] = [];
    const { bots, manager } = managed(loggedRegistry(log), log);
    const joined = manager.start();
    await vi.waitFor(() => expect(bots).toHaveLength(1));
    bots[0]?.emit('spawn');
    await joined;
    await manager.stop();
    expect(log).toEqual(['register GolemBench', 'connect', 'unregister GolemBench', 'close']);
  });

  it('registers again before every reconnect', async () => {
    const log: string[] = [];
    const { bots, manager } = managed(loggedRegistry(log), log);
    manager.start().catch(() => {});
    await vi.waitFor(() => expect(bots).toHaveLength(1));
    bots[0]?.emit('end', 'timeout');
    await vi.waitFor(() => expect(bots).toHaveLength(2));
    expect(log.slice(0, 4)).toEqual([
      'register GolemBench',
      'connect',
      'register GolemBench',
      'connect',
    ]);
    await manager.stop();
  });

  it('makes no connect attempt and fails clearly when NATS is down', async () => {
    const log: string[] = [];
    const { manager } = managed(
      loggedRegistry(log, () => true),
      log,
    );
    await expect(manager.start()).rejects.toThrow(/NATS is unreachable/);
    expect(log).not.toContain('connect');
    expect(manager.state).toBe('fatal');
  });

  it('backs off and retries when the registry fails after a good start', async () => {
    const log: string[] = [];
    const { bots, manager } = managed(
      loggedRegistry(log, (n) => n === 2),
      log,
    );
    manager.start().catch(() => {});
    await vi.waitFor(() => expect(bots).toHaveLength(1));
    bots[0]?.emit('end', 'timeout');
    await vi.waitFor(() => expect(bots).toHaveLength(2));
    // Registration 2 failed (no connect), registration 3 succeeded and connected.
    expect(log.filter((l) => l === 'connect')).toHaveLength(2);
    await manager.stop();
  });

  it('does not connect when stop() lands while the registration is in flight', async () => {
    const log: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = loggedRegistry(log);
    const register = registry.register;
    registry.register = async (u) => {
      await gate;
      await register(u);
    };
    const { manager } = managed(registry, log);
    manager.start().catch(() => {});
    const stopped = manager.stop();
    release();
    await stopped;
    await vi.waitFor(() => expect(log).toContain('unregister GolemBench'));
    expect(log).not.toContain('connect');
  });
});
