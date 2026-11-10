import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createClock,
  createFileStore,
  createGlassClient,
  createReporter,
  createSupervisor,
  readOnly,
  type SqlClient,
} from './adapters.ts';
import type { ExecResult, Runner } from './ports.ts';

const SRC = [join(import.meta.dirname, 'adapters.ts'), join(import.meta.dirname, 'cli.ts')];

/** A runner that records every call and answers with a fixed exit code. */
function recordingRunner(code = 0): {
  runner: Runner;
  calls: { file: string; args: readonly string[] }[];
} {
  const calls: { file: string; args: readonly string[] }[] = [];
  return {
    calls,
    runner: {
      exec: async (file, args): Promise<ExecResult> => {
        calls.push({ file, args: [...args] });
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

  it('the Body kill is refused until adam-cli has a per-service stop', async () => {
    const { runner, calls } = recordingRunner();
    await expect(createSupervisor(runner, '/repo').killBody()).rejects.toThrow(
      /no per-service Body stop/,
    );
    expect(calls).toHaveLength(0);
  });

  it('the reporter passes the run folder and the manifest to adam-report', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'adam-run-rep-'));
    const files = createFileStore(runDir);
    files.write(
      join(runDir, 'manifest.json'),
      JSON.stringify({ startedAt: '2026-11-10T00:00:00.000Z' }),
    );
    const { runner, calls } = recordingRunner();
    await createReporter(
      runner,
      '/repo',
      runDir,
      files,
      createClock(),
      () => 'ag_smoke_01',
      'smoke',
    ).reportRun('run-1');
    expect(calls[0]?.args).toContain('--life');
    expect(calls[0]?.args).toContain('ag_smoke_01');
    expect(calls[0]?.args).toContain('--out');
    expect(calls[0]?.args).toContain(runDir);
  });
});
