import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeClock } from '@geldar/mcp-mock';
import type { Client, Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { repoRoot } from './config.ts';
import { MemoryPresenceBucket } from './fakes/world.fakes.ts';
import {
  bucketRules,
  ConfigRejected,
  LIFE_CACHE_MS,
  lazyLifeRegistry,
  loadStartConfig,
  type McpPorts,
  type NatsLink,
  pepperBytes,
  startMcp,
  tokenBucketLimiter,
} from './main.ts';
import type { PgAgentStore } from './store/pg-agents.ts';

/** A password and a pepper no log line may ever carry. */
const CANARY_PASSWORD = 'canary-pg-password-7f3a';
const CANARY_PEPPER = 'canary-pepper-9d1c-0123456789abcdef';
const SHARD_FILE = join(repoRoot(), 'shards', 'phase0.yaml');
/** The environment the shipped shard needs: the two secret file paths (the files are never read in these tests). */
const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/pg',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/pepper',
};

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A shard file in a scratch directory, with its text edited. */
function shardCopy(edit: (text: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-mcp-shard-'));
  scratch.push(dir);
  const file = join(dir, 'phase0.yaml');
  writeFileSync(file, edit(readFileSync(SHARD_FILE, 'utf8')));
  return file;
}

/** The LISTEN connection fake: records the LISTEN and the end, the two steps the server must run. */
function fakeListener(order: string[]): Client {
  const listener = {
    on: () => listener,
    connect: async () => {},
    query: async (sql: string) => {
      order.push(sql.startsWith('LISTEN') ? 'revoke.listen' : 'revoke.other');
      return { rows: [] };
    },
    end: async () => {
      order.push('revoke.stop');
    },
  };
  return listener as unknown as Client;
}

/** Fakes for every outside port. `order` records what happened, in order; nothing listens or connects. */
function fakePorts(order: string[], logs: string[]): McpPorts {
  const nats: NatsLink = {
    request: (() => Promise.reject(new Error('not used'))) as never,
    buckets: {
      open: async () => new MemoryPresenceBucket(),
      create: async () => new MemoryPresenceBucket(),
    } as never,
    publishCall: async () => {},
    replay: async () => {
      order.push('replay');
      return {
        stop: async () => {
          order.push('replay.stop');
        },
      };
    },
    drain: async () => {
      order.push('nats.drain');
    },
  };
  const pool = {
    query: async () => ({ rows: [] }),
    end: async () => {
      order.push('pool.end');
    },
  } as unknown as Pool;
  return {
    readSecret: async (path) => {
      order.push(`secret:${path.endsWith('pepper') ? 'pepper' : 'password'}`);
      return path.endsWith('pepper') ? CANARY_PEPPER : CANARY_PASSWORD;
    },
    openPool: () => {
      order.push('pool.open');
      return pool;
    },
    connectNats: async () => {
      order.push('nats.connect');
      return nats;
    },
    openRevokeListener: () => fakeListener(order),
    keepAlive: { start: () => () => undefined },
    clock: new FakeClock(1_000_000),
    log: (line) => logs.push(JSON.stringify(line)),
    frontDoor: () => ({
      listen: async () => {
        order.push('listen');
        return 8443;
      },
      close: async () => {
        order.push('front.close');
      },
    }),
  };
}

describe('loadStartConfig', () => {
  it('loads the shipped shard, which declares identity_mode: watched', async () => {
    const config = await loadStartConfig(SHARD_FILE, ENV);
    expect(config.sovereign.allowed).toBe(true);
  });

  it('refuses a sovereign shard without identity_mode: watched, before the loader runs', async () => {
    const file = shardCopy((text) => text.replace(/^identity_mode: watched.*\n/m, ''));
    const failure = await loadStartConfig(file, ENV).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConfigRejected);
    expect((failure as Error).message).toContain(
      'sovereign allowed requires identity_mode: watched',
    );
  });
});

describe('startMcp', () => {
  it('starts in the fixed order: secrets, pool, NATS, replay, then listen', async () => {
    const order: string[] = [];
    const config = await loadStartConfig(SHARD_FILE, ENV);
    const running = await startMcp(config, fakePorts(order, []));
    expect(running.port).toBe(8443);
    expect(order).toEqual([
      'secret:password',
      'secret:pepper',
      'pool.open',
      'nats.connect',
      'revoke.listen',
      'replay',
      'listen',
    ]);
  });

  it('stops in order: stop accepting, drain the consumer, stop the revoke listener, drain NATS, then close the pool', async () => {
    const order: string[] = [];
    const config = await loadStartConfig(SHARD_FILE, ENV);
    const running = await startMcp(config, fakePorts(order, []));
    order.length = 0;
    await running.stop();
    expect(order).toEqual(['front.close', 'replay.stop', 'revoke.stop', 'nats.drain', 'pool.end']);
  });

  it('closes what it opened when a later step fails, then rethrows', async () => {
    const order: string[] = [];
    const ports = fakePorts(order, []);
    ports.frontDoor = () => ({
      listen: async () => {
        throw new Error('address in use');
      },
      close: async () => {
        order.push('front.close');
      },
    });
    const config = await loadStartConfig(SHARD_FILE, ENV);
    await expect(startMcp(config, ports)).rejects.toThrow('address in use');
    expect(order.slice(-4)).toEqual(['replay.stop', 'revoke.stop', 'nats.drain', 'pool.end']);
  });

  it('keeps the password and the pepper out of every log line', async () => {
    const order: string[] = [];
    const logs: string[] = [];
    const ports = fakePorts(order, logs);
    const config = await loadStartConfig(SHARD_FILE, ENV);
    const running = await startMcp(config, ports);
    await running.stop();
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    expect(all).not.toContain(CANARY_PASSWORD);
    expect(all).not.toContain(CANARY_PEPPER);
  });
});

describe('pepper', () => {
  const key = 'k'.repeat(32);
  it('reads the pepper as the CLI does: one trailing LF or CRLF goes, nothing else', () => {
    expect(pepperBytes(`${key}\r\n`).toString()).toBe(key);
    expect(pepperBytes(`${key}\n`).toString()).toBe(key);
    expect(pepperBytes(`${key} `).toString()).toBe(`${key} `);
  });

  it('refuses a pepper under 32 bytes at startup, before the pool opens', async () => {
    const order: string[] = [];
    const config = await loadStartConfig(SHARD_FILE, ENV);
    const ports = fakePorts(order, []);
    const readSecret = ports.readSecret;
    ports.readSecret = async (path) => (path.endsWith('pepper') ? 'short' : readSecret(path));
    const failure = await startMcp(config, ports).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConfigRejected);
    expect(order).not.toContain('pool.open');
  });
});

describe('lazyLifeRegistry', () => {
  /** An agents store whose living lives change between reads; `names` maps a life to its name. */
  function fakeAgents(lifeSets: string[][], names: Record<string, string>) {
    let reads = 0;
    const store = {
      liveLifeIds: async () => {
        reads++;
        return lifeSets[Math.min(reads - 1, lifeSets.length - 1)] ?? [];
      },
      identity: async (lifeId: string) => {
        const name = names[lifeId];
        if (name === undefined) throw new Error(`no agent row for life ${lifeId}`);
        return { name, username: `${lifeId}_acct` };
      },
    } as unknown as PgAgentStore;
    return { store, lifeReads: () => reads };
  }

  it('picks up a life added while the server runs once the cached list is 5 s old', async () => {
    const clock = new FakeClock(0);
    const { store, lifeReads } = fakeAgents([['ag_a'], ['ag_a', 'ag_b']], {});
    const registry = lazyLifeRegistry(store, clock);
    expect(await registry.lives()).toEqual(['ag_a']);
    await clock.advance(LIFE_CACHE_MS - 1);
    expect(await registry.lives()).toEqual(['ag_a']);
    expect(lifeReads()).toBe(1);
    await clock.advance(1);
    expect(await registry.lives()).toEqual(['ag_a', 'ag_b']);
    expect(lifeReads()).toBe(2);
  });

  it('reads each life identity on first use and gives an unknown life an empty one', async () => {
    const clock = new FakeClock(0);
    const { store } = fakeAgents([[]], { ag_a: 'Kestrel' });
    const registry = lazyLifeRegistry(store, clock);
    expect(await registry.identity('ag_a')).toEqual({ name: 'Kestrel', username: 'ag_a_acct' });
    expect(await registry.identity('ag_missing')).toEqual({ name: '', username: '' });
  });
});

describe('tokenBucketLimiter', () => {
  it('allows the capacity, refuses the next call, and refills one token every 60/capacity seconds', () => {
    const limiter = tokenBucketLimiter(() => ({ capacity: 2, perMinute: 2 }));
    expect(limiter.take('ag-jason-01', 0).allowed).toBe(true);
    expect(limiter.take('ag-jason-01', 0).allowed).toBe(true);
    const refused = limiter.take('ag-jason-01', 0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(30_000);
    expect(limiter.take('ag-jason-01', 30_000).allowed).toBe(true);
    expect(limiter.take('other', 0).allowed).toBe(true);
  });

  it('gives each bucket the capacity its name calls for, through the real config rules', () => {
    const limits = {
      callsPerMinute: 60,
      ownerCallsPerMinute: 600,
      failedAuthPerMinute: 30,
      actMinSeconds: 2,
      sayMinSeconds: 3,
    };
    const count = (bucket: string): number => {
      const limiter = tokenBucketLimiter(bucketRules(limits));
      let allowed = 0;
      while (allowed < 1000 && limiter.take(bucket, 0).allowed) allowed += 1;
      return allowed;
    };
    expect(count('player:ag-jason-01')).toBe(60);
    expect(count('owner:steve')).toBe(600);
    expect(count('auth-failed:address:203.0.113.9')).toBe(30);
    expect(count('auth-failed:global')).toBe(300);
    expect(count('act:ag_jason')).toBe(1);
    expect(count('say:ag_jason')).toBe(1);
  });

  it('spaces act and say by their minimum seconds: one token each, refilled every N seconds', () => {
    const limiter = tokenBucketLimiter(
      bucketRules({
        callsPerMinute: 60,
        ownerCallsPerMinute: 600,
        failedAuthPerMinute: 30,
        actMinSeconds: 2,
        sayMinSeconds: 3,
      }),
    );
    expect(limiter.take('act:ag_jason', 0).allowed).toBe(true);
    expect(limiter.take('act:ag_jason', 1_999).allowed).toBe(false);
    expect(limiter.take('act:ag_jason', 2_000).allowed).toBe(true);
    expect(limiter.take('say:ag_jason', 0).allowed).toBe(true);
    expect(limiter.take('say:ag_jason', 2_999).allowed).toBe(false);
    expect(limiter.take('say:ag_jason', 3_000).allowed).toBe(true);
  });

  it('keeps counting after the table is swept of full buckets', () => {
    const limiter = tokenBucketLimiter(() => ({ capacity: 1, perMinute: 1 }));
    for (let i = 0; i < 1500; i += 1) limiter.take(`auth-failed:address:${i}`, 0);
    expect(limiter.take('auth-failed:address:0', 0).allowed).toBe(false);
    expect(limiter.take('auth-failed:address:0', 60_000).allowed).toBe(true);
    expect(limiter.take('auth-failed:address:fresh', 0).allowed).toBe(true);
  });
});
