import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createClock,
  createFileStore,
  createGlassClient,
  createPreflight,
  createReporter,
  createSupervisor,
  readOnly,
  type SqlClient,
} from './adapters.ts';
import type { ExecResult, Runner } from './ports.ts';
import type { WorldVolumes } from './world-volume.ts';

const SRC = [join(import.meta.dirname, 'adapters.ts'), join(import.meta.dirname, 'cli.ts')];

/** A runner that records every call and answers with a fixed exit code. */
function recordingRunner(code = 0): {
  runner: Runner;
  calls: { file: string; args: readonly string[]; env?: Record<string, string | undefined> }[];
} {
  const calls: {
    file: string;
    args: readonly string[];
    env?: Record<string, string | undefined>;
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
        env: { GELDAR_WORLD_VOLUME: 'geldar-phase0-world-run-1' },
      });
      const { facts } = await preflight.gather();
      expect(facts.bench).toEqual({ file: benchName, text: '{"meta":{}}' });
      expect(facts.prepared?.worldVolume).toBe('geldar-phase0-world-run-1');
      expect(facts.volume?.exists).toBe(true);
      expect(facts.worldVolumeEnv).toBe('geldar-phase0-world-run-1');
      expect(facts.mind).toEqual({ username: 'ag_adam_04', tier: 'fast', runTier: 'fast' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
