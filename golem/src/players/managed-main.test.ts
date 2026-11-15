import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';
import type { OpenedRegistry } from '../registry.ts';
import { NO_HOST_CONFIG_EXIT } from './managed-config.ts';
import {
  type HostDb,
  type HostDbOptions,
  type ManagedDeps,
  managedBotRegistry,
  runManagedPlayer,
} from './managed-main.ts';
import type { PlayerConfig } from './player-config.ts';

const LIFE = 'ag_abc123def456';
/** A sentinel database password: it must never reach a log line. */
const SENTINEL = 'SENTINEL-DB-PASSWORD-7f3a';
const PASSWORD_FILE = '/run/secrets/db-host.txt';

const ENV: Record<string, string> = {
  GELDAR_LIFE_ID: LIFE,
  GELDAR_LOGIN_NAME: LIFE,
  GELDAR_SHARD: 'phase0',
  GELDAR_DB_HOST: 'postgres',
  GELDAR_DB_ROLE: 'geldar_body_host',
  GELDAR_DB_PASSWORD_FILE: PASSWORD_FILE,
};

const SHARD_FILE = join(repoRoot(), 'shards', 'phase0.yaml');

interface Harness {
  deps: ManagedDeps;
  logs: string[];
  bodies: PlayerConfig[];
  dbOptions: HostDbOptions[];
  opened: { count: number };
}

/** Fake deps: the real shard text, a password file, a fake database row, and a fake Body. */
async function harness(row: unknown, dbError?: string): Promise<Harness> {
  const shardText = await readFile(SHARD_FILE, 'utf8');
  const logs: string[] = [];
  const bodies: PlayerConfig[] = [];
  const dbOptions: HostDbOptions[] = [];
  const opened = { count: 0 };
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
        async close() {},
      };
    },
    runBody: async (config) => {
      bodies.push(config);
    },
    log: (line) => logs.push(JSON.stringify(line)),
  };
  return { deps, logs, bodies, dbOptions, opened };
}

const HOST_ROW = {
  display_name: 'Kestrel',
  harness: 'claude',
  model: 'claude-sonnet-5',
  character_sheet: null,
};

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

describe('the managed host imports', () => {
  it('imports nothing from the RCON or whitelist modules', async () => {
    for (const name of ['managed-main.ts', 'managed-config.ts']) {
      const text = await readFile(join(repoRoot(), 'golem', 'src', 'players', name), 'utf8');
      expect(text, name).not.toMatch(/from '[^']*(rcon|whitelist)[^']*'/i);
      expect(text, name).not.toMatch(/readRconPassword/);
    }
  });
});
