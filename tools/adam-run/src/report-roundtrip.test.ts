import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runAdamReport } from '@geldar/adam-report/src/cli.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { type Clock, createFileStore, createReporter } from './adapters.ts';
import { buildManifest, type ManifestInput, writeManifest } from './manifest.ts';
import type { ExecResult, Runner } from './ports.ts';

const REPORT_CLI = /adam-report[\\/]src[\\/]cli\.ts$/;
const NOW_MS = Date.parse('2026-11-10T10:00:00.000Z');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake run folder under a temp root, with no shard file and no report yet. */
function fakeRunFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'adam-rt-'));
  dirs.push(dir);
  return dir;
}

const input: ManifestInput = {
  runId: 'smoke-rt-1',
  profile: 'smoke',
  seed: 7,
  startedAt: '2026-11-10T09:00:00.000Z',
  plannedRestartAt: null,
  git: { sha: 'abc1234def5678', clean: true },
  shardConfigSha256: 'cfg0123',
  shardEdit: null,
  pins: [{ tag: 'qwen3:8b', digest: 'sha256:500a1f' }],
  observedDigests: { 'qwen3:8b': 'sha256:500a1f' },
  bench: null,
  criteriaSha256: 'crit0123',
};

/**
 * A runner that answers the reporter's `node adam-report/src/cli.ts <args>` call in-process: the report CLI
 * reads the real manifest file the reporter names. The database is empty, so every criterion is UNKNOWN.
 */
function inProcessReportRunner(logs: string[]): Runner {
  return {
    exec: async (file, args): Promise<ExecResult> => {
      if (file !== 'node' || !REPORT_CLI.test(args[0] ?? ''))
        throw new Error(`unexpected call: ${file} ${args.join(' ')}`);
      const code = await runAdamReport(args.slice(1), {
        env: {},
        connect: () => () => ({
          connect: async () => undefined,
          query: async () => ({ rows: [] }),
          end: async () => undefined,
        }),
        now: () => new Date(NOW_MS),
        log: (line) => logs.push(line),
      });
      return { code, stdout: '', stderr: '' };
    },
  };
}

const clock: Clock = {
  nowMs: () => NOW_MS,
  sleep: async () => undefined,
};

describe('adam-run writes a manifest that adam-report reads', () => {
  it('reportRun reads the writer output and writes run-report.json with the manifest fields', async () => {
    const runDir = fakeRunFolder();
    const files = createFileStore(runDir);
    writeManifest(files, runDir, buildManifest(input));
    const logs: string[] = [];
    await createReporter(
      inProcessReportRunner(logs),
      join(runDir, 'repo'),
      runDir,
      files,
      clock,
      () => 'ag_smoke_01',
      'smoke',
    ).reportRun('smoke-rt-1');

    const report = JSON.parse(readFileSync(join(runDir, 'run-report.json'), 'utf8')) as {
      runId: string;
      lifeId: string;
      manifest: {
        worldSeed: string;
        gitSha: string;
        modelTags: { tag: string; digest: string }[];
        shardConfigHash: string;
        startTime: string;
        tpsTarget: number;
        restarts: unknown[];
      };
    };
    expect(report.runId).toBe('smoke-rt-1');
    expect(report.lifeId).toBe('ag_smoke_01');
    expect(report.manifest).toMatchObject({
      worldSeed: '7',
      gitSha: 'abc1234def5678',
      modelTags: [{ tag: 'qwen3:8b', digest: 'sha256:500a1f' }],
      shardConfigHash: 'cfg0123',
      startTime: '2026-11-10T09:00:00.000Z',
      tpsTarget: 20,
      restarts: [],
    });
    expect(logs.join('\n')).toContain('run-report.json');
  });

  it('a report step that cannot read the manifest fails with the reader message', async () => {
    const runDir = fakeRunFolder();
    const files = createFileStore(runDir);
    files.write(
      join(runDir, 'manifest.json'),
      JSON.stringify({ schema: 'adam-run-manifest/0', started_at: '2026-11-10T09:00:00.000Z' }),
    );
    const logs: string[] = [];
    await expect(
      createReporter(
        inProcessReportRunner(logs),
        join(runDir, 'repo'),
        runDir,
        files,
        clock,
        () => 'ag_smoke_01',
        'smoke',
      ).reportRun('smoke-rt-1'),
    ).rejects.toThrow('adam-report exited 1');
    expect(logs.join('\n')).toContain('manifest: schema must be adam-run-manifest/1');
  });
});
