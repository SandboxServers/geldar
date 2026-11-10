import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeProcesses } from '../test/fakes.ts';
import {
  ADAM_UP_TIMEOUT_MS,
  countLifeRows,
  createClock,
  createFileStore,
  createGlassClient,
  createPreflight,
  createReporter,
  createRunner,
  createSampler,
  createSupervisor,
  EXEC_TIMEOUT_MS,
  readOnly,
  type SqlClient,
  startSecretPaths,
  unreadablePaths,
} from './adapters.ts';
import type { ExecResult, Runner } from './ports.ts';
import type { WorldVolumes } from './world-volume.ts';

const SRC = [join(import.meta.dirname, 'adapters.ts'), join(import.meta.dirname, 'cli.ts')];

/** A runner that records every call and answers with a fixed exit code. */
function recordingRunner(code = 0): {
  runner: Runner;
  calls: {
    file: string;
    args: readonly string[];
    env?: Record<string, string | undefined> | undefined;
  }[];
} {
  const calls: {
    file: string;
    args: readonly string[];
    env?: Record<string, string | undefined> | undefined;
  }[] = [];
  return {
    calls,
    runner: {
      exec: async (file, args, env): Promise<ExecResult> => {
        calls.push({ file, args: [...args], env });
        return { code, stdout: '', stderr: '' };
      },
    },
  };
}

/** A SQL client that records the statements it was given. */
function recordingSql(failOn?: string): { sql: SqlClient; texts: string[] } {
  const texts: string[] = [];
  return {
    texts,
    sql: {
      query: async (text) => {
        texts.push(text);
        if (failOn !== undefined && text.includes(failOn)) throw new Error(`boom at ${text}`);
        return { rows: [] };
      },
    },
  };
}

describe('the start reads the life rows', () => {
  it('counts the life thoughts and intents in one read-only transaction, then closes the client', async () => {
    const texts: string[] = [];
    const values: unknown[][] = [];
    let closed = false;
    const sql: SqlClient = {
      query: async (text, params) => {
        texts.push(text);
        values.push(params);
        return { rows: [{ t: 3, i: 2 }] };
      },
      close: async () => {
        closed = true;
      },
    };
    expect(await countLifeRows(sql, 'ag_adam_04')).toEqual({ thoughts: 3, intents: 2 });
    expect(texts[0]).toBe('BEGIN READ ONLY');
    expect(texts[texts.length - 1]).toBe('COMMIT');
    expect(texts[2]).toContain('FROM thoughts');
    expect(texts[2]).toContain('FROM intents');
    expect(values[2]).toEqual(['ag_adam_04']);
    expect(closed).toBe(true);
  });

  it('returns null when Postgres cannot be read, and still closes the client', async () => {
    let closed = false;
    const sql: SqlClient = {
      query: async () => {
        throw new Error('connection refused');
      },
      close: async () => {
        closed = true;
      },
    };
    expect(await countLifeRows(sql, 'ag_adam_04')).toBeNull();
    expect(closed).toBe(true);
  });
});

describe('the sampler death count', () => {
  it('counts death events of the life since the run start, never agents.died_at', async () => {
    const START = Date.UTC(2026, 10, 10, 9);
    const texts: string[] = [];
    const params: unknown[][] = [];
    const sql: SqlClient = {
      query: async (text, values) => {
        texts.push(text);
        params.push(values ?? []);
        return { rows: text.includes("type = 'death'") ? [{ n: 2 }] : [] };
      },
    };
    const runner = {
      exec: async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' }),
    } as unknown as Runner;
    const sampler = createSampler({
      runner,
      sql,
      processes: new FakeProcesses(),
      clock: new FakeClock(),
      lifeId: () => 'ag_adam_04',
      repoRoot: tmpdir(),
    });
    const obs = await sampler.observe(START);
    expect(obs.deaths).toBe(2);
    const i = texts.findIndex((t) => t.includes("type = 'death'"));
    expect(texts[i]).toContain('FROM events');
    expect(texts.join('\n')).not.toContain('died_at');
    expect(params[i]).toEqual(['ag_adam_04', new Date(START)]);
  });
});

describe('the sampler reads only this run', () => {
  it('the thought count, the latency and the active intent are bounded by the run start', async () => {
    const START = Date.UTC(2026, 10, 10, 9);
    const texts: string[] = [];
    const params: unknown[][] = [];
    const sql: SqlClient = {
      query: async (text, values) => {
        texts.push(text);
        params.push(values ?? []);
        return { rows: [] };
      },
    };
    const runner = {
      exec: async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' }),
    } as unknown as Runner;
    const sampler = createSampler({
      runner,
      sql,
      processes: new FakeProcesses(),
      clock: new FakeClock(),
      lifeId: () => 'ag_adam_04',
      repoRoot: tmpdir(),
    });
    await sampler.observe(START);
    const since = [new Date(START)];
    const count = texts.findIndex((t) => t.includes('count(*)::int AS n, max(at)'));
    expect(texts[count]).toContain('at >= $2');
    expect(params[count]).toEqual(['ag_adam_04', ...since]);
    const p95 = texts.findIndex((t) => t.includes('percentile_cont'));
    expect(texts[p95]).toContain('at >= $2');
    expect(params[p95]).toEqual(['ag_adam_04', ...since]);
    const intent = texts.findIndex((t) => t.includes('FROM intents'));
    expect(texts[intent]).toContain(
      'thought_id IN (SELECT thought_id FROM thoughts WHERE life_id = $1 AND at >= $2)',
    );
    expect(params[intent]).toEqual(['ag_adam_04', ...since]);
  });
});

describe('the forbidden-flags rule', () => {
  it('no adapter or CLI source contains a volume-removing or pruning command', () => {
    const forbidden = ['down -v', '--volumes', 'rm -f', 'volume rm', 'prune'];
    for (const file of SRC) {
      const text = readFileSync(file, 'utf8');
      for (const word of forbidden) expect(text, `${file} contains "${word}"`).not.toContain(word);
    }
  });
});

describe('the run-folder file store', () => {
  it('refuses a path that resolves outside the run folder, for reads and writes', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'adam-run-'));
    const files = createFileStore(runDir);
    const outside = join(runDir, '..', 'outside.txt');
    expect(() => files.write(outside, 'x')).toThrow(/outside the run folder/);
    expect(() => files.read(outside)).toThrow(/outside the run folder/);
    expect(() => files.append(join(runDir, '..', '..', 'x.log'), 'x')).toThrow(
      /outside the run folder/,
    );
  });

  it('writes and appends inside the run folder', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'adam-run-'));
    const files = createFileStore(runDir);
    const path = join(runDir, 'status.log');
    expect(files.read(path)).toBeNull();
    files.append(path, 'a\n');
    files.append(path, 'b\n');
    expect(files.read(path)).toBe('a\nb\n');
    writeFileSync(join(runDir, 'x.txt'), 'y');
    expect(files.read(join(runDir, 'x.txt'))).toBe('y');
  });
});

describe('the read-only SQL reads', () => {
  it('opens a READ ONLY transaction with the statement timeout first, and commits', async () => {
    const { sql, texts } = recordingSql();
    await readOnly(sql, async (q) => q.query('SELECT 1', []));
    expect(texts[0]).toBe('BEGIN READ ONLY');
    expect(texts[1]).toBe("SET LOCAL statement_timeout = '5s'");
    expect(texts.at(-1)).toBe('COMMIT');
  });

  it('rolls back and rethrows when a read fails', async () => {
    const { sql, texts } = recordingSql('thoughts');
    await expect(readOnly(sql, (q) => q.query('SELECT 1 FROM thoughts', []))).rejects.toThrow(
      /boom/,
    );
    expect(texts.at(-1)).toBe('ROLLBACK');
    expect(texts).not.toContain('COMMIT');
  });

  it('never prints the glass password, even when the connection fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adam-run-pw-'));
    const file = join(dir, 'pw.txt');
    writeFileSync(file, 'not-a-real-secret-xyz\n');
    const client = createGlassClient({
      GELDAR_GLASS_PG_PASSWORD_FILE: file,
      GELDAR_GLASS_PG_PORT: '1',
    });
    const err = await client.query('SELECT 1', []).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain('not-a-real-secret-xyz');
  });
});

describe('timeouts on the child processes', () => {
  it('a child past its timeout is killed and reads as a failed exec, not a hang', async () => {
    const res = await createRunner(process.cwd()).exec(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)'],
      undefined,
      300,
    );
    expect(res.code).toBe(124);
    expect(res.stderr).toContain('timed out');
  }, 15_000);

  it('adam up waits up to 600 s; every other call gets the 60 s default', async () => {
    const seen: Array<number | undefined> = [];
    const runner: Runner = {
      exec: async (_file, _args, _env, timeoutMs) => {
        seen.push(timeoutMs);
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const sup = createSupervisor(runner, '/repo');
    await sup.up();
    await sup.restartStack();
    expect(seen).toEqual([ADAM_UP_TIMEOUT_MS, undefined]);
    expect(EXEC_TIMEOUT_MS).toBe(60_000);
  });
});

describe('the supervisor and reporter argument arrays', () => {
  it('restarts only the Paper, Velocity and eventsink services, by argument array', async () => {
    const { runner, calls } = recordingRunner();
    await createSupervisor(runner, '/repo').restartStack();
    expect(calls).toEqual([
      {
        file: 'docker',
        args: [
          'compose',
          '-f',
          'compose/phase0.yml',
          '-p',
          'geldar-phase0',
          'restart',
          'paper',
          'velocity',
          'eventsink',
        ],
      },
    ]);
  });

  it('calls the adam CLI up and down through node with argument arrays', async () => {
    const { runner, calls } = recordingRunner();
    const sup = createSupervisor(runner, '/repo');
    await sup.up();
    await sup.stop('body');
    expect(calls.map((c) => [c.file, c.args.slice(1)])).toEqual([
      ['node', ['up']],
      ['node', ['down']],
    ]);
  });

  it('a failing supervisor call throws, so the sequence aborts', async () => {
    const { runner } = recordingRunner(3);
    await expect(createSupervisor(runner, '/repo').up()).rejects.toThrow(/adam up exited 3/);
  });

  it('a failing supervisor call carries the last lines of the child stderr, redacted', async () => {
    const stderr = Array.from({ length: 25 }, (_, i) => `stderr line ${i + 1}`).join('\n');
    const runner: Runner = {
      exec: async (): Promise<ExecResult> => ({
        code: 1,
        stdout: '',
        stderr: `${stderr}\nPOSTGRES_PASSWORD=do-not-print-me`,
      }),
    };
    const err = await createSupervisor(runner, '/repo')
      .up()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message.startsWith('adam up exited 1: ')).toBe(true);
    expect(message).toContain('stderr line 25');
    expect(message).not.toContain('stderr line 5 ');
    expect(message).toContain('POSTGRES_PASSWORD=<redacted>');
    expect(message).not.toContain('do-not-print-me');
  });

  it('the Body kill runs adam-cli restart-body through node, with an argument array', async () => {
    const { runner, calls } = recordingRunner();
    await createSupervisor(runner, '/repo').restartBody();
    expect(calls.map((c) => [c.file, c.args.slice(1)])).toEqual([['node', ['restart-body']]]);
    expect(calls[0]?.args[0]).toBe(join('/repo', 'tools', 'adam-cli', 'src', 'cli.ts'));
  });

  it('a refused Body restart throws, so the sequence aborts', async () => {
    const { runner } = recordingRunner(1);
    await expect(createSupervisor(runner, '/repo').restartBody()).rejects.toThrow(
      /restart-body exited 1/,
    );
  });

  it('the reporter passes the run folder and the manifest to adam-report', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'adam-run-rep-'));
    const files = createFileStore(runDir);
    files.write(
      join(runDir, 'manifest.json'),
      JSON.stringify({ started_at: '2026-11-10T00:00:00.000Z' }),
    );
    const { runner, calls } = recordingRunner();
    await createReporter(
      runner,
      repoWithGlassSecret(),
      runDir,
      files,
      createClock(),
      () => 'ag_smoke_01',
      'smoke',
      {},
    ).reportRun('run-1');
    expect(calls[0]?.args).toContain('2026-11-10T00:00:00.000Z');
    expect(calls[0]?.args).toContain('--life');
    expect(calls[0]?.args).toContain('ag_smoke_01');
    expect(calls[0]?.args).toContain('--out');
    expect(calls[0]?.args).toContain(runDir);
  });

  it('the reporter gives adam-report the glass password file path and the read-only DB address, never the password', async () => {
    const repo = repoWithGlassSecret();
    const runDir = reportRunDir();
    const { runner, calls } = recordingRunner();
    await createReporter(
      runner,
      repo,
      runDir,
      createFileStore(runDir),
      createClock(),
      () => 'ag_smoke_01',
      'smoke',
      {},
    ).reportRun('run-1');
    expect(calls[0]?.env).toMatchObject({
      GELDAR_REPORT_DB_PASSWORD_FILE: join(repo, 'compose', 'secrets', 'postgres-glass.txt'),
      GELDAR_REPORT_DB_USER: 'geldar_glass',
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'geldar',
    });
    expect(JSON.stringify(calls)).not.toContain(GLASS_SECRET);
  });

  it('the reporter refuses, naming the missing glass password file, and runs nothing', async () => {
    const runDir = reportRunDir();
    const { runner, calls } = recordingRunner();
    await expect(
      createReporter(
        runner,
        join(runDir, 'no-repo'),
        runDir,
        createFileStore(runDir),
        createClock(),
        () => 'ag_smoke_01',
        'smoke',
        {},
      ).reportRun('run-1'),
    ).rejects.toThrow(/postgres-glass\.txt/);
    expect(calls).toEqual([]);
  });
});

describe('the start checks the secret files exist and are readable, never their contents', () => {
  it('lists the missing secret files by path, and the present ones are not listed', () => {
    const repo = repoWithGlassSecret(); // only postgres-glass.txt exists
    const shard = join(repo, 'compose', 'secrets');
    writeFileSync(join(shard, 'postgres.txt'), 'pg-value\n');
    const missing = unreadablePaths(startSecretPaths(repo, {}));
    expect(missing).toEqual([join(shard, 'rcon.txt'), join(shard, 'velocity-forwarding.txt')]);
    expect(missing.join('\n')).not.toContain(GLASS_SECRET);
    expect(missing.join('\n')).not.toContain('pg-value');
  });

  it('takes the glass file from GELDAR_GLASS_PG_PASSWORD_FILE when the environment names one', () => {
    const repo = repoWithGlassSecret();
    const env = { GELDAR_GLASS_PG_PASSWORD_FILE: join(repo, 'nowhere', 'glass.txt') };
    expect(startSecretPaths(repo, env)).toContain(join(repo, 'nowhere', 'glass.txt'));
    expect(unreadablePaths(startSecretPaths(repo, env))).toContain(
      join(repo, 'nowhere', 'glass.txt'),
    );
  });
});

const GLASS_SECRET = 'glass-secret-value-7731';

/** A repo root whose compose/secrets/postgres-glass.txt holds a value the tests must never see printed. */
function repoWithGlassSecret(): string {
  const repo = mkdtempSync(join(tmpdir(), 'adam-run-repo-'));
  mkdirSync(join(repo, 'compose', 'secrets'), { recursive: true });
  writeFileSync(join(repo, 'compose', 'secrets', 'postgres-glass.txt'), `${GLASS_SECRET}\n`);
  return repo;
}

/** A run folder with a manifest that has a start time, which the reporter needs. */
function reportRunDir(): string {
  const runDir = mkdtempSync(join(tmpdir(), 'adam-run-rep-'));
  createFileStore(runDir).write(
    join(runDir, 'manifest.json'),
    JSON.stringify({ started_at: '2026-11-10T00:00:00.000Z' }),
  );
  return runDir;
}

describe('the preflight facts', () => {
  it('reads the newest bench result from bench-results/ and the prepared volume from the run folder', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'adam-repo-'));
    const runDir = join(repoRoot, '.geldar', 'runs', 'run-1');
    mkdirSync(join(repoRoot, 'shards'));
    writeFileSync(
      join(repoRoot, 'shards', 'phase0.yaml'),
      'model_pins:\n  qwen3:8b:\n    digest: sha256:bbb\nmind:\n  run_tier: fast\n  agent:\n    username: ag_adam_04\n    tier: fast\n',
    );
    mkdirSync(join(repoRoot, 'bench-results'));
    const benchName = '20261110T024026Z-eba101b.json';
    writeFileSync(join(repoRoot, 'bench-results', benchName), '{"meta":{}}');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'manifest.json'),
      JSON.stringify({
        schema: 'adam-run-prepared/1',
        profile: '8b',
        runId: 'run-1',
        worldVolume: 'geldar-phase0-world-run-1',
        preparedAt: '2026-11-10T00:00:00Z',
      }),
    );
    const runner: Runner = {
      exec: async (): Promise<ExecResult> => ({ code: 0, stdout: 'eba101b\n', stderr: '' }),
    } as Runner;
    const worldVolumes: WorldVolumes = {
      inspect: async () => ({ exists: true, labelled: true, empty: true, usedBy: [] }),
      create: async () => {},
      paperVolumes: async () => ['geldar-phase0-world-run-1'],
    };
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
    try {
      const preflight = createPreflight({
        runner,
        repoRoot,
        runDir,
        profile: '8b',
        criteriaText: '{}',
        files: createFileStore(runDir),
        worldVolumes,
        sql: recordingSql().sql,
        env: { GELDAR_WORLD_VOLUME: 'geldar-phase0-world-run-1' },
      });
      const { facts } = await preflight.gather();
      expect(facts.bench).toEqual({ file: benchName, text: '{"meta":{}}' });
      expect(facts.prepared?.worldVolume).toBe('geldar-phase0-world-run-1');
      expect(facts.volume?.exists).toBe(true);
      expect(facts.paperVolumes).toEqual(['geldar-phase0-world-run-1']);
      expect(facts.worldVolumeEnv).toBe('geldar-phase0-world-run-1');
      expect(facts.mind).toEqual({ username: 'ag_adam_04', tier: 'fast', runTier: 'fast' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
