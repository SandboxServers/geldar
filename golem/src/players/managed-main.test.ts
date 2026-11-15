import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStackConfig, repoRoot } from '../config.ts';
import type { OpenedRegistry } from '../registry.ts';
import { NO_HOST_CONFIG_EXIT } from './managed-config.ts';
import { type ManagedDeps, managedBotRegistry, runManagedPlayer } from './managed-main.ts';
import { type HostDb, type HostDbOptions, openPgHostDb } from './managed-pg.ts';
import type { PlayerConfig } from './player-config.ts';

/** A fake of the `pg` module: one Client per open, a recorded query, and a close that can hang. */
const pgFake = vi.hoisted(() => {
  const state = {
    clients: [] as Array<{
      options: Record<string, unknown>;
      listeners: Array<(e: Error) => void>;
    }>,
    pools: 0,
    queries: [] as Array<{ text: string; values: unknown[] }>,
    rows: [] as Array<{ cfg: unknown }>,
    queryError: undefined as Error | undefined,
    ends: 0,
    endHangs: false,
  };
  class Client {
    readonly record: { options: Record<string, unknown>; listeners: Array<(e: Error) => void> };
    constructor(options: Record<string, unknown>) {
      this.record = { options, listeners: [] };
      state.clients.push(this.record);
    }
    on(event: string, listener: (e: Error) => void): this {
      if (event === 'error') this.record.listeners.push(listener);
      return this;
    }
    async connect(): Promise<void> {}
    async query(text: string, values: unknown[]): Promise<{ rows: Array<{ cfg: unknown }> }> {
      state.queries.push({ text, values });
      if (state.queryError !== undefined) throw state.queryError;
      return { rows: state.rows };
    }
    end(): Promise<void> {
      state.ends += 1;
      return state.endHangs ? new Promise<void>(() => undefined) : Promise.resolve();
    }
  }
  class Pool {
    constructor() {
      state.pools += 1;
    }
  }
  return { state, Client, Pool };
});

vi.mock('pg', () => ({
  default: { Client: pgFake.Client, Pool: pgFake.Pool },
  Client: pgFake.Client,
  Pool: pgFake.Pool,
}));

const LIFE = 'ag_abc123def456';
/** A sentinel database password: it must never reach a log line. */
const SENTINEL = 'SENTINEL-DB-PASSWORD-7f3a';
const PASSWORD_FILE = '/run/secrets/db-host.txt';
const PLAYERS_DIR = join(repoRoot(), 'golem', 'src', 'players');

const ENV: Record<string, string> = {
  GELDAR_LIFE_ID: LIFE,
  GELDAR_LOGIN_NAME: LIFE,
  GELDAR_SHARD: 'phase0',
  GELDAR_PG_HOST: 'postgres',
  GELDAR_PG_USER: 'geldar_body_host',
  GELDAR_PG_PASSWORD_FILE: PASSWORD_FILE,
};

/**
 * The env that body-helper/src/managed-template.ts (managedBodyConfig) passes to a managed Body.
 * The host must accept exactly these names; a rename on either side breaks this test.
 */
const BH3_ENV: Record<string, string> = {
  GELDAR_LOGIN_NAME: LIFE,
  GELDAR_LIFE_ID: LIFE,
  GELDAR_SHARD: 'phase0',
  GELDAR_MC_HOST: 'paper',
  GELDAR_MC_PORT: '25565',
  GELDAR_NATS_URL: 'nats://nats:4222',
  GELDAR_NATS_USER: 'body',
  GELDAR_NATS_PASSWORD_FILE: '/run/secrets/nats-body',
  GELDAR_PG_HOST: 'postgres',
  GELDAR_PG_PORT: '5432',
  GELDAR_PG_USER: 'geldar_body_host',
  GELDAR_PG_PASSWORD_FILE: PASSWORD_FILE,
  GELDAR_IN_NETWORK_HOSTS: '1',
};

const SHARD_FILE = join(repoRoot(), 'shards', 'phase0.yaml');

const DB_OPTIONS: HostDbOptions = {
  host: 'postgres',
  port: 5432,
  database: 'geldar',
  user: 'geldar_body_host',
  password: SENTINEL,
};

interface Harness {
  deps: ManagedDeps;
  logs: string[];
  bodies: PlayerConfig[];
  dbOptions: HostDbOptions[];
  opened: { count: number };
  closes: { count: number };
}

/** Fake deps: the real shard text, a password file, a fake database row, and a fake Body. */
async function harness(row: unknown, dbError?: string): Promise<Harness> {
  const shardText = await readFile(SHARD_FILE, 'utf8');
  const logs: string[] = [];
  const bodies: PlayerConfig[] = [];
  const dbOptions: HostDbOptions[] = [];
  const opened = { count: 0 };
  const closes = { count: 0 };
  const deps: ManagedDeps = {
    readText: async (file) => {
      if (file === SHARD_FILE) return shardText;
      if (file === PASSWORD_FILE) return `${SENTINEL}\n`;
      throw new Error(`unexpected read of ${file}`);
    },
    openDb: async (options): Promise<HostDb> => {
      opened.count += 1;
      dbOptions.push(options);
      return {
        async hostConfig() {
          if (dbError !== undefined) throw new Error(dbError);
          return row;
        },
        async close() {
          closes.count += 1;
        },
      };
    },
    runBody: async (config) => {
      bodies.push(config);
    },
    log: (line) => logs.push(JSON.stringify(line)),
  };
  return { deps, logs, bodies, dbOptions, opened, closes };
}

const HOST_ROW = {
  display_name: 'Kestrel',
  harness: 'claude',
  model: 'claude-sonnet-5',
  character_sheet: null,
};

beforeEach(() => {
  pgFake.state.clients.length = 0;
  pgFake.state.pools = 0;
  pgFake.state.queries.length = 0;
  pgFake.state.rows = [];
  pgFake.state.queryError = undefined;
  pgFake.state.ends = 0;
  pgFake.state.endHangs = false;
});

describe('runManagedPlayer', () => {
  it('starts the Body with the config from the fake database row', async () => {
    const h = await harness(HOST_ROW);
    expect(await runManagedPlayer(ENV, h.deps)).toBe(0);
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]?.lifeId).toBe(LIFE);
    expect(h.bodies[0]?.displayName).toBe('Kestrel');
    expect(h.bodies[0]?.start).toBe('always');
    expect(h.dbOptions[0]).toMatchObject({
      host: 'postgres',
      port: 5432,
      database: 'geldar',
      user: 'geldar_body_host',
      password: SENTINEL,
    });
  });

  it('exits with the fixed code and starts no Body when the row is NULL', async () => {
    const h = await harness(null);
    expect(await runManagedPlayer(ENV, h.deps)).toBe(NO_HOST_CONFIG_EXIT);
    expect(NO_HOST_CONFIG_EXIT).toBe(78);
    expect(h.bodies).toHaveLength(0);
    expect(h.logs.join('\n')).toContain('no_host_config');
  });

  it('never logs the database password, even on a database error', async () => {
    const h = await harness(null, `auth failed for ${SENTINEL}`);
    const error = await runManagedPlayer(ENV, h.deps).catch((caught: unknown) => caught);
    expect(String(error)).toContain('the host database could not read the host config');
    expect(String(error)).not.toContain(SENTINEL);
    expect(h.logs.join('\n')).not.toContain(SENTINEL);
    expect(h.bodies).toHaveLength(0);
  });

  it('never logs the password on a successful start', async () => {
    const h = await harness(HOST_ROW);
    await runManagedPlayer(ENV, h.deps);
    expect(h.logs.join('\n')).not.toContain(SENTINEL);
  });

  it('refuses a malformed life id before any database connection', async () => {
    const h = await harness(HOST_ROW);
    const bad = { ...ENV, GELDAR_LIFE_ID: 'ag_ABC', GELDAR_LOGIN_NAME: 'ag_ABC' };
    await expect(runManagedPlayer(bad, h.deps)).rejects.toThrow(/managed life id/);
    expect(h.opened.count).toBe(0);
  });

  it('refuses a login name that is not the life id before any connection', async () => {
    const h = await harness(HOST_ROW);
    const bad = { ...ENV, GELDAR_LOGIN_NAME: 'ag_other00001' };
    await expect(runManagedPlayer(bad, h.deps)).rejects.toThrow(/GELDAR_LOGIN_NAME/);
    expect(h.opened.count).toBe(0);
  });

  it('refuses a shard name that could walk the path', async () => {
    const h = await harness(HOST_ROW);
    await expect(runManagedPlayer({ ...ENV, GELDAR_SHARD: '../x' }, h.deps)).rejects.toThrow(
      /shard name/,
    );
  });
});

describe('the env of the body helper (BH-3 managedBodyConfig)', () => {
  it('is accepted: the host reads exactly these names and starts', async () => {
    const h = await harness(HOST_ROW);
    expect(await runManagedPlayer(BH3_ENV, h.deps)).toBe(0);
    expect(h.dbOptions[0]).toMatchObject({
      host: 'postgres',
      port: 5432,
      database: 'geldar',
      user: 'geldar_body_host',
      password: SENTINEL,
    });
  });

  it('refuses a renamed database name with the fixed message, before any connection', async () => {
    const h = await harness(HOST_ROW);
    const { GELDAR_PG_PASSWORD_FILE: _unused, ...rest } = BH3_ENV;
    const renamed = { ...rest, GELDAR_DB_PASSWORD_FILE: PASSWORD_FILE };
    await expect(runManagedPlayer(renamed, h.deps)).rejects.toThrow(
      'GELDAR_PG_PASSWORD_FILE is required',
    );
    expect(h.opened.count).toBe(0);
  });

  it('refuses a missing PG host with the fixed message', async () => {
    const h = await harness(HOST_ROW);
    const { GELDAR_PG_HOST: _unused, ...rest } = BH3_ENV;
    await expect(runManagedPlayer(rest, h.deps)).rejects.toThrow('GELDAR_PG_HOST is required');
    expect(h.opened.count).toBe(0);
  });
});

describe('the database port', () => {
  it('accepts 1 and 65535', async () => {
    for (const port of ['1', '65535']) {
      const h = await harness(HOST_ROW);
      expect(await runManagedPlayer({ ...ENV, GELDAR_PG_PORT: port }, h.deps)).toBe(0);
      expect(h.dbOptions[0]?.port).toBe(Number(port));
    }
  });

  it('refuses anything but an integer from 1 to 65535, before any connection', async () => {
    for (const port of ['abc', '0', '65536', '1.5', '-1', '']) {
      const h = await harness(HOST_ROW);
      await expect(runManagedPlayer({ ...ENV, GELDAR_PG_PORT: port }, h.deps)).rejects.toThrow(
        'GELDAR_PG_PORT must be an integer from 1 to 65535',
      );
      expect(h.opened.count, port).toBe(0);
    }
  });
});

describe('readHostRow close', () => {
  it('closes the connection after a successful read', async () => {
    const h = await harness(HOST_ROW);
    await runManagedPlayer(ENV, h.deps);
    expect(h.closes.count).toBe(1);
  });

  it('closes the connection after a failed read', async () => {
    const h = await harness(null, 'read failed');
    await expect(runManagedPlayer(ENV, h.deps)).rejects.toThrow(
      'the host database could not read the host config',
    );
    expect(h.closes.count).toBe(1);
  });

  it('opens no connection to close when the open fails', async () => {
    const h = await harness(HOST_ROW);
    const deps: ManagedDeps = {
      ...h.deps,
      openDb: async () => {
        throw new Error(`no route for ${SENTINEL}`);
      },
    };
    await expect(runManagedPlayer(ENV, deps)).rejects.toThrow(
      'the host database could not be opened',
    );
    expect(h.closes.count).toBe(0);
  });
});

describe('openPgHostDb', () => {
  it('opens one client with no pool, and the timeouts and error listener', async () => {
    await openPgHostDb(DB_OPTIONS);
    expect(pgFake.state.pools).toBe(0);
    expect(pgFake.state.clients).toHaveLength(1);
    expect(pgFake.state.clients[0]?.options).toMatchObject({
      host: 'postgres',
      port: 5432,
      database: 'geldar',
      user: 'geldar_body_host',
      password: SENTINEL,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
    });
    expect(pgFake.state.clients[0]?.listeners).toHaveLength(1);
  });

  it('a client error is swallowed: the listener does not throw and the message is not logged', async () => {
    await openPgHostDb(DB_OPTIONS);
    const listener = pgFake.state.clients[0]?.listeners[0];
    expect(listener).toBeDefined();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(() =>
        listener?.(new Error(`postgres://user:${SENTINEL}@postgres/geldar`)),
      ).not.toThrow();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('reads with the one function, parameterized, and closes after the read', async () => {
    pgFake.state.rows = [{ cfg: HOST_ROW }];
    const db = await openPgHostDb(DB_OPTIONS);
    expect(await db.hostConfig(LIFE)).toEqual(HOST_ROW);
    expect(pgFake.state.queries).toEqual([
      { text: 'SELECT player_host_config($1) AS cfg', values: [LIFE] },
    ]);
    expect(pgFake.state.ends).toBe(0);
    await db.close();
    expect(pgFake.state.ends).toBe(1);
  });

  it('gives null for a NULL row', async () => {
    pgFake.state.rows = [{ cfg: null }];
    const db = await openPgHostDb(DB_OPTIONS);
    expect(await db.hostConfig(LIFE)).toBeNull();
  });

  it('ends the client when the query rejects, and reports a fixed message', async () => {
    pgFake.state.queryError = new Error(`relation missing for ${SENTINEL}`);
    const h = await harness(HOST_ROW);
    const error = await runManagedPlayer(ENV, { ...h.deps, openDb: openPgHostDb }).catch(
      (caught: unknown) => caught,
    );
    expect(String(error)).toContain('the host database could not read the host config');
    expect(String(error)).not.toContain(SENTINEL);
    expect(pgFake.state.ends).toBe(1);
    expect(h.bodies).toHaveLength(0);
  });

  it('ends the client after a successful managed start', async () => {
    pgFake.state.rows = [{ cfg: HOST_ROW }];
    const h = await harness(HOST_ROW);
    expect(await runManagedPlayer(ENV, { ...h.deps, openDb: openPgHostDb })).toBe(0);
    expect(pgFake.state.ends).toBe(1);
  });

  it('gives up a close that never ends after the timeout, so boot cannot hang', async () => {
    pgFake.state.endHangs = true;
    const db = await openPgHostDb(DB_OPTIONS);
    vi.useFakeTimers();
    try {
      const closing = db.close();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(closing).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    expect(pgFake.state.ends).toBe(1);
  });
});

describe('managedBotRegistry', () => {
  it('puts the registry key under the lowercased life id', async () => {
    const puts: Array<[string, string]> = [];
    const opened: OpenedRegistry = {
      kv: {
        async put(key, value) {
          puts.push([key, value]);
          return 1;
        },
        async delete() {},
      },
      async close() {},
    };
    const registry = managedBotRegistry(async () => opened);
    await registry.register('AG_ABC123DEF456');
    await registry.close();
    expect(puts.map(([key]) => key)).toEqual(['ag_abc123def456']);
  });
});

describe('the in-network hosts of a managed Body', () => {
  const NET = { GELDAR_MC_HOST: 'paper', GELDAR_NATS_URL: 'nats://nats:4222' };

  it('refuses the colo service names without GELDAR_IN_NETWORK_HOSTS', () => {
    expect(() => loadStackConfig({ ...NET })).toThrow(/GELDAR_MC_HOST/);
  });

  it('refuses the switch at any value but 1', () => {
    expect(() => loadStackConfig({ ...NET, GELDAR_IN_NETWORK_HOSTS: '0' })).toThrow(
      /GELDAR_MC_HOST/,
    );
  });

  it('accepts the colo service names with GELDAR_IN_NETWORK_HOSTS=1', () => {
    const stack = loadStackConfig({ ...NET, GELDAR_IN_NETWORK_HOSTS: '1' });
    expect(stack.mcHost).toBe('paper');
    expect(stack.natsUrl).toBe('nats://nats:4222');
  });
});

/** The relative specifiers of a module: `from '...'`, `import('...')`, `require('...')`, `import '...'`. */
const SPECIFIER =
  /\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'\s*\)|\brequire\(\s*'([^']+)'\s*\)|^import\s+'([^']+)'/gm;

/** Every module reachable from `entries` through relative specifiers, with its source text. */
async function importGraph(entries: string[]): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  const queue = [...entries];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (modules.has(file)) continue;
    const text = await readFile(file, 'utf8');
    modules.set(file, text);
    for (const match of text.matchAll(SPECIFIER)) {
      const spec = match.slice(1).find((part) => part !== undefined);
      if (spec?.startsWith('.')) queue.push(resolve(dirname(file), spec));
    }
  }
  return modules;
}

/** A module that imports readRconPassword by name (the RCON password reader of config.ts). */
const READS_RCON_PASSWORD = /import[^;]*\breadRconPassword\b[^;]*from/;

describe('the managed host import graph', () => {
  it('reaches no RCON or whitelist module and no readRconPassword import', async () => {
    const graph = await importGraph([
      join(PLAYERS_DIR, 'managed-main.ts'),
      join(PLAYERS_DIR, 'managed-config.ts'),
    ]);
    expect(graph.has(join(PLAYERS_DIR, 'body-host.ts'))).toBe(true);
    expect(graph.has(join(PLAYERS_DIR, 'managed-pg.ts'))).toBe(true);
    const names = [...graph.keys()].map((file) => basename(file));
    expect(names.filter((name) => name === 'rcon.ts' || name === 'whitelist.ts')).toEqual([]);
    for (const [file, text] of graph) {
      expect(READS_RCON_PASSWORD.test(text), file).toBe(false);
    }
  });

  it('control: the walk finds the RCON modules from the sovereign host', async () => {
    const graph = await importGraph([join(PLAYERS_DIR, 'main.ts')]);
    const names = [...graph.keys()].map((file) => basename(file));
    expect(names).toContain('rcon.ts');
    expect(names).toContain('whitelist.ts');
    expect([...graph.values()].some((text) => READS_RCON_PASSWORD.test(text))).toBe(true);
  });
});
