import { describe, expect, it } from 'vitest';
import {
  type BodyOwner,
  ownershipProblem,
  type ProcessFacts,
  type RestartDeps,
  type RestartOptions,
  restartBody,
} from './body-restart.ts';
import { BODY, type Service } from './procs.ts';

const ENTRY = 'src/adam/main.ts';
const STARTED = '2026-11-10T00:00:00.000Z';
const ENV = { GELDAR_SHARD: 'phase0', OLLAMA_URL: 'http://127.0.0.1:11434' };
const BODY_PID = 100;
const ANIMUS_PID = 200;
const LANTERN_PID = 300;
const FRESH_PID = 400;
const OPTS: RestartOptions = { graceMs: 1_000, readyMs: 5_000, pollMs: 100 };
const STARTED_LINE =
  '{"at":"2026-11-10T00:00:01.000Z","event":"body_started","life_id":"ag_adam_01"}\n';

const owner = (pid = BODY_PID): BodyOwner => ({ pid, startedAt: STARTED, entry: ENTRY });
const facts = (pid = BODY_PID, over: Partial<ProcessFacts> = {}): ProcessFacts => ({
  pid,
  startedAt: STARTED,
  commandLine: `node C:/repo/golem/${ENTRY}`,
  ...over,
});

describe('ownershipProblem', () => {
  it('accepts the process the owner record names', () => {
    expect(ownershipProblem(owner(), facts(), ENTRY)).toBeNull();
  });

  it('accepts a start time a few seconds after the recorded spawn', () => {
    const created = '2026-11-10T00:00:02.000Z';
    expect(ownershipProblem(owner(), facts(BODY_PID, { startedAt: created }), ENTRY)).toBeNull();
  });

  it('refuses an unverifiable Body: no owner record', () => {
    expect(ownershipProblem(null, facts(), ENTRY)).toMatch(/no owner record/);
  });

  it('refuses a stale owner: the process is gone', () => {
    expect(ownershipProblem(owner(), null, ENTRY)).toMatch(/not running \(stale\)/);
  });

  it('refuses a process whose PID does not match the record', () => {
    expect(ownershipProblem(owner(), facts(BODY_PID + 1), ENTRY)).toMatch(/answered as pid/);
  });

  it('refuses a PID that was reused by a process started at another time', () => {
    const later = facts(BODY_PID, { startedAt: '2026-11-10T01:00:00.000Z' });
    expect(ownershipProblem(owner(), later, ENTRY)).toMatch(/another process/);
  });

  it('refuses a process that is not the Body entry point', () => {
    const animus = facts(BODY_PID, { commandLine: 'node C:/repo/animus/src/main.ts' });
    expect(ownershipProblem(owner(), animus, ENTRY)).toMatch(/is not running src\/adam\/main.ts/);
  });

  it('matches the entry point with Windows separators too', () => {
    const windows = facts(BODY_PID, { commandLine: 'node golem\\src\\adam\\main.ts' });
    expect(ownershipProblem(owner(), windows, ENTRY)).toBeNull();
  });

  it('refuses an unreadable start time', () => {
    const bad = facts(BODY_PID, { startedAt: 'not a time' });
    expect(ownershipProblem(owner(), bad, ENTRY)).toMatch(/no readable start time/);
  });
});

interface Fake {
  deps: RestartDeps;
  signals: [number, string][];
  spawns: { name: string; entry: string; env: Record<string, string> }[];
  table: Map<number, ProcessFacts>;
  alive: Set<number>;
}

/**
 * A fake process table. `exit` says which signal ends the Body (`term`, `kill` or `never`); `freshExits` ends the new
 * Body at once; `freshLogs` says whether the new Body logs `body_started`.
 */
function fake(
  opts: {
    adamUp?: boolean;
    owner?: BodyOwner | null;
    exit?: 'term' | 'kill' | 'never';
    freshExits?: boolean;
    freshLogs?: boolean;
    log?: string;
  } = {},
): Fake {
  const signals: [number, string][] = [];
  const spawns: Fake['spawns'] = [];
  const table = new Map<number, ProcessFacts>([
    [BODY_PID, facts(BODY_PID)],
    [ANIMUS_PID, facts(ANIMUS_PID, { commandLine: 'node C:/repo/animus/src/main.ts' })],
    [LANTERN_PID, facts(LANTERN_PID, { commandLine: 'node C:/repo/lantern-local/src/main.ts' })],
  ]);
  const alive = new Set([BODY_PID, ANIMUS_PID, LANTERN_PID]);
  let log = opts.log ?? '';
  let clock = 0;
  const deps: RestartDeps = {
    adamUp: () => opts.adamUp ?? true,
    owner: () => (opts.owner === undefined ? owner() : opts.owner),
    lookup: (pid) => table.get(pid) ?? null,
    alive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      const ends = opts.exit === 'term' ? 'SIGTERM' : opts.exit === 'kill' ? 'SIGKILL' : null;
      if (signal === ends) alive.delete(pid);
    },
    spawn: (service: Service, env) => {
      spawns.push({ name: service.name, entry: service.entry, env });
      if (opts.freshExits !== true) alive.add(FRESH_PID);
      if (opts.freshLogs !== false) log += STARTED_LINE;
      return { pid: FRESH_PID, startedAt: STARTED, entry: service.entry };
    },
    env: () => ENV,
    logSize: () => log.length,
    logSince: (offset) => log.slice(offset),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, signals, spawns, table, alive };
}

describe('restartBody', () => {
  it('refuses when adam is not up, and signals and starts nothing', async () => {
    const f = fake({ adamUp: false });
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/adam is not up/);
    expect(f.signals).toEqual([]);
    expect(f.spawns).toEqual([]);
  });

  it('refuses an unverifiable Body, and signals and starts nothing', async () => {
    const f = fake({ owner: null });
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/refusing to restart the Body/);
    expect(f.signals).toEqual([]);
    expect(f.spawns).toEqual([]);
  });

  it('refuses a PID that now belongs to another process, and signals nothing', async () => {
    const f = fake();
    f.table.set(BODY_PID, facts(BODY_PID, { commandLine: 'node C:/repo/animus/src/main.ts' }));
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/refusing to restart the Body/);
    expect(f.signals).toEqual([]);
    expect(f.spawns).toEqual([]);
  });

  it('refuses a stale Body PID, and signals nothing', async () => {
    const f = fake();
    f.table.delete(BODY_PID);
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/is not running \(stale\)/);
    expect(f.signals).toEqual([]);
  });

  it('signals only the Body PID, and never animus or lantern-local', async () => {
    const f = fake({ exit: 'term' });
    await restartBody(f.deps, OPTS);
    expect(f.signals).toEqual([[BODY_PID, 'SIGTERM']]);
    expect(f.alive.has(ANIMUS_PID)).toBe(true);
    expect(f.alive.has(LANTERN_PID)).toBe(true);
  });

  it('starts the fresh Body through the same service and environment as adam up', async () => {
    const f = fake({ exit: 'term' });
    await restartBody(f.deps, OPTS);
    expect(f.spawns).toEqual([{ name: 'body', entry: ENTRY, env: ENV }]);
    expect(f.spawns[0]?.name).toBe(BODY.name);
  });

  it('reports the old and the new PID once the fresh Body logs body_started', async () => {
    const f = fake({ exit: 'term' });
    await expect(restartBody(f.deps, OPTS)).resolves.toBe(
      `body restarted: pid ${BODY_PID} -> ${FRESH_PID}`,
    );
  });

  it('escalates to SIGKILL when the Body ignores SIGTERM past the grace period', async () => {
    const f = fake({ exit: 'kill' });
    await restartBody(f.deps, OPTS);
    expect(f.signals).toEqual([
      [BODY_PID, 'SIGTERM'],
      [BODY_PID, 'SIGKILL'],
    ]);
  });

  it('refuses to start a Body when the old one does not exit even after SIGKILL', async () => {
    const f = fake({ exit: 'never' });
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/did not exit after SIGKILL/);
    expect(f.spawns).toEqual([]);
  });

  it('fails when the fresh Body exits before it logs body_started', async () => {
    const f = fake({ exit: 'term', freshExits: true, freshLogs: false });
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/exited before body_started/);
  });

  it('fails, and stops the fresh Body, when body_started never appears', async () => {
    const f = fake({ exit: 'term', freshLogs: false });
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(
      /did not log body_started within 5000 ms/,
    );
    expect(f.signals).toContainEqual([FRESH_PID, 'SIGTERM']);
  });

  it('ignores a body_started line written before the restart', async () => {
    const f = fake({ exit: 'term', freshLogs: false, log: STARTED_LINE });
    await expect(restartBody(f.deps, OPTS)).rejects.toThrow(/did not log body_started/);
  });
});
