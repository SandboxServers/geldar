import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA,
  FakeClock,
  FakeReporter,
  FakeSampler,
  MemoryFiles,
  passingPreflight,
  scenario,
} from '../test/fakes.ts';
import { type Harness, parseArgs, runCli, USAGE } from './cli.ts';
import { LIFE_ID, type Profile } from './manifest.ts';
import {
  type Processes,
  type ProcessView,
  type Reporter,
  runPaths,
  type Service,
  type Supervisor,
} from './ports.ts';

const REPO = '/repo';
const RUN = 'run-1';
const RUN_DIR = join(REPO, '.geldar', 'runs', RUN);

/** A supervisor that records each call; a run must make none on a dry run. */
function recordingSupervisor(calls: string[]): Supervisor {
  return {
    up: async () => {
      calls.push('up');
    },
    restartStack: async () => {
      calls.push('restartStack');
    },
    killBody: async () => {
      calls.push('killBody');
    },
    stop: async (service: Service) => {
      calls.push(`stop:${service}`);
    },
  };
}

function harness(
  opts: { processes?: ProcessView[]; cleanTree?: boolean; reporter?: Reporter } = {},
) {
  const clock = new FakeClock();
  const files = new MemoryFiles();
  const calls: string[] = [];
  const signals: { pid: number; force: boolean }[] = [];
  const processes: Processes = {
    list: () => opts.processes ?? [],
    signal: (pid, force) => {
      signals.push({ pid, force });
    },
  };
  const reporter = opts.reporter ?? new FakeReporter();
  const h: Harness = {
    clock,
    processes,
    supervisor: recordingSupervisor(calls),
    sampler: () => new FakeSampler(clock, scenario(LIFE_ID.smoke)),
    runFiles: () => files,
    runsFiles: files,
    preflight: (profile: Profile) =>
      passingPreflight(profile, { cleanTree: opts.cleanTree ?? true }),
    reporter: () => reporter,
    criteria: CRITERIA,
    criteriaText: '{}',
  };
  return { h, files, calls, signals };
}

function capture(): { log: (s: string) => void; text: () => string } {
  const lines: string[] = [];
  return { log: (s) => lines.push(s), text: () => lines.join('\n') };
}

describe('parseArgs', () => {
  it.each([
    [[], /unknown profile/],
    [['smoke'], /unknown command/],
    [['smoke', 'fly'], /unknown command/],
    [['7b', 'start'], /unknown profile/],
    [['smoke', 'start', '--bogus'], /unknown flag "--bogus"/],
    [['smoke', 'start', '--hours'], /--hours needs a value/],
    [['smoke', 'start', '--hours', '-1'], /--hours must be a positive number/],
    [['smoke', 'start', '--hours', 'abc'], /--hours must be a positive number/],
    [['smoke', 'start', '--run-id', '../x'], /--run-id/],
    [['smoke', 'start', '--body-kill-after-minutes', '-2'], /--body-kill-after-minutes/],
    [['smoke', 'status', '--dry-run'], /--dry-run applies to start only/],
    [
      ['32b', 'start', '--hours', '2', '--restart-at-hours', '3'],
      /--restart-at-hours must be before the end/,
    ],
  ])('refuses %j with a usage error', (argv, message) => {
    const r = parseArgs(argv as string[]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('accepts a full start line', () => {
    const r = parseArgs([
      '32b',
      'start',
      '--run-id',
      'ops-1',
      '--hours',
      '3',
      '--restart-at-hours',
      '1.5',
      '--body-kill-after-minutes',
      '20',
      '--dry-run',
    ]);
    expect(r).toMatchObject({
      ok: true,
      args: {
        profile: '32b',
        command: 'start',
        runId: 'ops-1',
        hours: 3,
        restartAtHours: 1.5,
        bodyKillAfterMinutes: 20,
        dryRun: true,
      },
    });
  });

  it('a usage error exits 2 and prints the usage text', async () => {
    const out = capture();
    const { h } = harness();
    expect(await runCli(['smoke', 'fly'], REPO, h, out.log)).toBe(2);
    expect(out.text()).toContain(USAGE);
  });
});

describe('start', () => {
  it('dry run prints the plan and makes no supervisor call and writes nothing', async () => {
    const out = capture();
    const { h, calls, files } = harness();
    const code = await runCli(['smoke', 'start', '--dry-run', '--run-id', RUN], REPO, h, out.log);
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(files.read(runPaths(RUN_DIR).manifest)).toBeNull();
    expect(out.text()).toContain('nothing was started');
  });

  it('refuses with the missing items and starts nothing when the tree is dirty', async () => {
    const out = capture();
    const { h, calls, files } = harness({ cleanTree: false });
    const code = await runCli(['smoke', 'start', '--run-id', RUN], REPO, h, out.log);
    expect(code).toBe(1);
    expect(out.text()).toContain('start refused:');
    expect(calls).toEqual([]);
    expect(files.read(runPaths(RUN_DIR).manifest)).toBeNull();
  });
});

describe('status', () => {
  it('on a missing run folder exits 1 with a message and no side effects', async () => {
    const out = capture();
    const { h, calls } = harness();
    expect(await runCli(['smoke', 'status', '--run-id', 'nope'], REPO, h, out.log)).toBe(1);
    expect(out.text()).toContain('no run at');
    expect(calls).toEqual([]);
  });
});

describe('stop', () => {
  it('with a stale pid file does not signal the recorded pid and runs the safe stop', async () => {
    const out = capture();
    const { h, files, signals, calls } = harness({ processes: [] });
    files.write(
      runPaths(RUN_DIR).manifest,
      JSON.stringify({ startedAt: '2026-11-10T00:00:00.000Z' }),
    );
    files.write(
      join(RUN_DIR, 'run.pid.json'),
      JSON.stringify({ pid: 4242, startedAt: '2026-11-10T00:00:00.000Z', runId: RUN }),
    );
    const code = await runCli(['smoke', 'stop', '--run-id', RUN], REPO, h, out.log);
    expect(code).toBe(0);
    expect(signals).toEqual([]);
    expect(out.text()).toContain('safe stop');
    expect(calls.every((c) => c.startsWith('stop:'))).toBe(true);
  });

  it('writes a stop request, and does not safe-stop, when the recorded run is live', async () => {
    const out = capture();
    const start = '2026-11-10T00:00:00.000Z';
    const live: ProcessView = {
      pid: 4242,
      startedAt: start,
      commandLine: 'node C:/repo/tools/adam-run/src/cli.ts smoke start --run-id run-1',
    };
    const { h, files, calls } = harness({ processes: [live] });
    files.write(runPaths(RUN_DIR).manifest, JSON.stringify({ startedAt: start }));
    files.write(
      join(RUN_DIR, 'run.pid.json'),
      JSON.stringify({ pid: 4242, startedAt: start, runId: RUN }),
    );
    expect(await runCli(['smoke', 'stop', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(files.read(join(RUN_DIR, 'stop-request.json'))).not.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('report', () => {
  it('regenerates the report from the run folder', async () => {
    const out = capture();
    const seen: string[] = [];
    const { h, files } = harness({ reporter: { reportRun: async (id) => void seen.push(id) } });
    files.write(
      runPaths(RUN_DIR).manifest,
      JSON.stringify({ startedAt: '2026-11-10T00:00:00.000Z' }),
    );
    expect(await runCli(['smoke', 'report', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(seen).toEqual([RUN]);
  });

  it('exits 1 when there is no run to report', async () => {
    const out = capture();
    const { h } = harness();
    expect(await runCli(['smoke', 'report', '--run-id', 'missing'], REPO, h, out.log)).toBe(1);
  });
});
