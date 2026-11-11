import { EventEmitter } from 'node:events';
import type { Bot, BotOptions } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ConnectionManager } from '../src/connection.ts';
import {
  type BotRegistry,
  HEARTBEAT_MS,
  LifeRegistration,
  lifeIdFor,
  type OpenedRegistry,
  openRegistryBucket,
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
    expect(lifeIdFor('GolemBench')).toMatch(/^ag_golemben[0-9a-f]{8}_01$/);
    expect(lifeIdFor('9Lives_')).toMatch(/^ag_lives[0-9a-f]{8}_01$/);
  });

  it('uses a username that already is a LifeId unchanged', () => {
    expect(lifeIdFor('ag_kestrel_01')).toBe('ag_kestrel_01');
    expect(lifeIdFor('ag_a_42')).toBe('ag_a_42');
    // Wrong case or a one-digit suffix is not a LifeId: it is hashed like any other name.
    expect(lifeIdFor('AG_Kestrel_01')).not.toBe('AG_Kestrel_01');
    expect(lifeIdFor('ag_kestrel_1')).not.toBe('ag_kestrel_1');
  });

  it('is deterministic and gives distinct ids to distinct usernames', () => {
    expect(lifeIdFor('Steve_1')).toBe(lifeIdFor('Steve_1'));
    const names = [
      'Steve_1',
      'Steve1',
      'steve1',
      'Steve__1',
      'a'.repeat(16),
      'a'.repeat(15),
      'Golem_Smoke_01',
      'Golem_Smoke_02',
      '9lives',
      '___',
      'ag_kestrel_01',
    ];
    const ids = names.map((n) => lifeIdFor(n));
    expect(new Set(ids).size).toBe(names.length);
    for (const id of ids) expect(id).toMatch(LIFE_ID);
  });

  it('keys by the lowercase username, as the plugin looks it up', () => {
    expect(registryKey('GolemBench')).toBe('golembench');
  });
});

describe('LifeRegistration', () => {
  it('puts {life_id, registered_at, live: true} under the lowercase username', async () => {
    const log: string[] = [];
    const reg = new LifeRegistration(
      async () => fakeKv(log),
      () => new Date('2026-01-02T03:04:05.000Z'),
    );
    await reg.register('GolemBench');
    expect(log).toEqual([
      `put golembench ${JSON.stringify({ life_id: lifeIdFor('GolemBench'), registered_at: '2026-01-02T03:04:05.000Z', live: true })}`,
    ]);
  });

  it('every heartbeat put carries live: true, and a dead life is unregistered, never written live: false', async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const reg = new LifeRegistration(async () => fakeKv(log));
      await reg.register('Bot');
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      await reg.unregister('Bot');
      const puts = log.filter((l) => l.startsWith('put bot '));
      expect(puts).toHaveLength(2);
      for (const p of puts) expect(JSON.parse(p.slice('put bot '.length)).live).toBe(true);
      expect(log.at(-1)).toBe('delete bot');
      expect(log.some((l) => l.includes('"live":false'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

  it('re-puts the key every HEARTBEAT_MS until unregister, so the TTL never lapses', async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const reg = new LifeRegistration(async () => fakeKv(log));
      await reg.register('Bot');
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
      expect(log.filter((l) => l.startsWith('put bot'))).toHaveLength(4);
      await reg.unregister('Bot');
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
      expect(log.filter((l) => l.startsWith('put bot'))).toHaveLength(4);
      expect(log.at(-1)).toBe('delete bot');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed heartbeat, reopens on the next beat, and stops beating on close', async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const errors: string[] = [];
      let down = false;
      const reg = new LifeRegistration(
        async () => ({
          kv: {
            put: async (key: string) => {
              if (down) throw new Error('nats gone');
              log.push(`put ${key}`);
            },
            delete: async () => undefined,
          },
          close: async () => {
            log.push('close');
          },
        }),
        undefined,
        (username, error) => errors.push(`${username}: ${(error as Error).message}`),
      );
      await reg.register('Bot');
      down = true;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(errors).toEqual(['Bot: nats gone']);
      down = false;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(log.filter((l) => l === 'put bot')).toHaveLength(2);
      await reg.close();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
      expect(log.filter((l) => l === 'put bot')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('reopens in unregister after a failed put dropped the connection, so the key is deleted', async () => {
    const log: string[] = [];
    let first = true;
    const open = vi.fn(async (): Promise<OpenedRegistry> => {
      const opened = fakeKv(log);
      if (first) {
        first = false;
        opened.kv.put = async () => {
          throw new Error('reply lost');
        };
      }
      return opened;
    });
    const reg = new LifeRegistration(open);
    await expect(reg.register('Bot')).rejects.toThrow(/reply lost/);
    await reg.unregister('Bot');
    expect(open).toHaveBeenCalledTimes(2);
    expect(log).toContain('delete bot');
  });

  it('does not open NATS to unregister a username that was never put', async () => {
    const open = vi.fn(async () => fakeKv([]));
    const reg = new LifeRegistration(open);
    await reg.unregister('Bot');
    expect(open).not.toHaveBeenCalled();
  });

  it('throws a failed delete so the caller can log it', async () => {
    const opened = fakeKv([]);
    opened.kv.delete = async () => {
      throw new Error('stream gone');
    };
    const reg = new LifeRegistration(async () => opened);
    await reg.register('Bot');
    await expect(reg.unregister('Bot')).rejects.toThrow(/stream gone/);
  });

  it('opens one connection for overlapping registers', async () => {
    const log: string[] = [];
    const open = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fakeKv(log);
    });
    const reg = new LifeRegistration(open);
    await Promise.all([reg.register('A'), reg.register('B')]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l.startsWith('put'))).toHaveLength(2);
  });
});

describe('openRegistryBucket', () => {
  it('names only host and port when NATS is unreachable, not credentials', async () => {
    const error = await openRegistryBucket('nats://someuser:s3cret@127.0.0.1:1').then(
      () => new Error('connected'),
      (e: Error) => e,
    );
    expect(error.message).not.toBe('connected');
    expect(error.message).toContain('127.0.0.1:1');
    expect(error.message).not.toContain('s3cret');
    expect(error.message).not.toContain('someuser');
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

  it('deletes the key through a real registration when the first put fails', async () => {
    const log: string[] = [];
    const opened = fakeKv(log);
    opened.kv.put = async () => {
      throw new Error('reply lost');
    };
    let opens = 0;
    const registration = new LifeRegistration(async () => {
      opens += 1;
      return opens === 1 ? opened : fakeKv(log);
    });
    const { manager } = managed(registration, log);
    await expect(manager.start()).rejects.toThrow(/reply lost/);
    await vi.waitFor(() => expect(log).toContain('delete golembench'));
    expect(log).not.toContain('connect');
  });

  it('stays stopped when a stop() races a failing registration', async () => {
    const log: string[] = [];
    let fail: () => void = () => {};
    const gate = new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('NATS is unreachable at nats://127.0.0.1:4222'));
    });
    const registry = loggedRegistry(log);
    registry.register = () => gate;
    const { manager } = managed(registry, log);
    manager.start().catch(() => {});
    await manager.stop();
    fail();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.state).toBe('stopped');
  });

  it('deletes the key again when stop() ran before the in-flight put landed', async () => {
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
    await manager.stop();
    release();
    await vi.waitFor(() =>
      expect(log.filter((l) => l === 'unregister GolemBench')).toHaveLength(2),
    );
    expect(log).not.toContain('connect');
  });
});
