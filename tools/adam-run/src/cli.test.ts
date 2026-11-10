import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA,
  FakeClock,
  FakeReporter,
  FakeSampler,
  FakeWorldVolumes,
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
import { parsePrepared } from './world-volume.ts';

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
    restartBody: async () => {
      calls.push('restartBody');
    },
    stop: async (service: Service) => {
      calls.push(`stop:${service}`);
    },
  };
}

function harness(
  opts: {
    processes?: ProcessView[];
    otherChanges?: string[];
    reporter?: Reporter;
    runFolders?: string[];
  } = {},
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
  const worldVolumes = new FakeWorldVolumes();
  const h: Harness = {
    worldVolumes,
    clock,
    processes,
    supervisor: recordingSupervisor(calls),
    sampler: () => new FakeSampler(clock, scenario(LIFE_ID.smoke)),
    runFiles: () => files,
    runsFiles: files,
    runFolders: () => opts.runFolders ?? [],
    preflight: (profile: Profile) =>
      passingPreflight(profile, { otherChanges: opts.otherChanges ?? [] }),
    reporter: () => reporter,
    criteria: CRITERIA,
    criteriaText: '{}',
  };
  return { h, files, calls, signals, worldVolumes };
}

/** A prepared record as `prepare-volume` writes it, for the given profile and run. */
function preparedJson(profile: string, runId: string): string {
  const worldVolume = `geldar-phase0-world-${runId}`;
  return JSON.stringify({
    schema: 'adam-run-prepared/1',
    profile,
    runId,
    worldVolume,
    preparedAt: '2026-11-10T00:00:00.000Z',
  });
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
    const { h, calls, files } = harness({ otherChanges: ['animus/src/x.ts'] });
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

describe('status and report without --run-id', () => {
  const OLD = join(REPO, '.geldar', 'runs', 'smoke-20261109T230000Z');
  const NEW = join(REPO, '.geldar', 'runs', 'smoke-20261110T121408Z');
  const folders = ['smoke-20261109T230000Z', 'smoke-20261110T121408Z', '8b-20261111T000000Z'];

  it('status reads the newest folder of the profile, not the id the current time gives', async () => {
    const out = capture();
    const { h, files } = harness({ runFolders: folders });
    files.write(runPaths(OLD).manifest, JSON.stringify({ started_at: '2026-11-09T23:00:00Z' }));
    files.write(runPaths(OLD).status, '{"event":"old"}\n');
    files.write(runPaths(NEW).manifest, JSON.stringify({ started_at: '2026-11-10T12:14:08Z' }));
    files.write(runPaths(NEW).status, '{"event":"sample"}\n');
    expect(await runCli(['smoke', 'status'], REPO, h, out.log)).toBe(0);
    expect(out.text()).toContain('{"event":"sample"}');
  });

  it('report passes the newest folder id to the reporter', async () => {
    const out = capture();
    const seen: string[] = [];
    const { h, files } = harness({
      runFolders: folders,
      reporter: { reportRun: async (id) => void seen.push(id) },
    });
    files.write(runPaths(NEW).manifest, JSON.stringify({ started_at: '2026-11-10T12:14:08Z' }));
    expect(await runCli(['smoke', 'report'], REPO, h, out.log)).toBe(0);
    expect(seen).toEqual(['smoke-20261110T121408Z']);
  });

  it('stop with no --run-id asks the newest folder of the profile to stop, as status and report do', async () => {
    const out = capture();
    const { h, files } = harness({
      runFolders: folders,
      processes: [
        {
          pid: 777,
          startedAt: '2026-11-10T12:14:08.000Z',
          commandLine:
            'node C:/repo/tools/adam-run/src/cli.ts smoke start --run-id smoke-20261110T121408Z',
        },
      ],
    });
    files.write(runPaths(NEW).manifest, JSON.stringify({ started_at: '2026-11-10T12:14:08Z' }));
    files.write(
      join(NEW, 'run.pid.json'),
      JSON.stringify({
        pid: 777,
        startedAt: '2026-11-10T12:14:08.000Z',
        runId: 'smoke-20261110T121408Z',
      }),
    );
    expect(await runCli(['smoke', 'stop'], REPO, h, out.log)).toBe(0);
    expect(files.read(join(NEW, 'stop-request.json'))).not.toBeNull();
    expect(files.read(join(OLD, 'stop-request.json'))).toBeNull();
  });
});

describe('a run aborted before it started', () => {
  const abortRecord = JSON.stringify({
    schema: 'adam-run-abort/1',
    rule: 'error',
    reason: 'adam up failed: boom',
    at: '2026-11-10T00:00:01.000Z',
    exitCode: 0,
  });

  it('status and report print the rule and reason, every criterion UNKNOWN, and call no reporter', async () => {
    const out = capture();
    const seen: string[] = [];
    const { h, files } = harness({ reporter: { reportRun: async (id) => void seen.push(id) } });
    files.write(runPaths(RUN_DIR).abort, abortRecord);
    expect(await runCli(['smoke', 'status', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(out.text()).toContain('rule: error');
    expect(out.text()).toContain('reason: adam up failed: boom');
    expect(out.text()).toContain('tpsMin: UNKNOWN');
    expect(await runCli(['smoke', 'report', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(out.text()).not.toContain('no startedAt');
    expect(seen).toEqual([]);
  });

  it('report on its own prints the reason and every criterion UNKNOWN', async () => {
    const out = capture();
    const { h, files } = harness();
    files.write(runPaths(RUN_DIR).abort, abortRecord);
    expect(await runCli(['smoke', 'report', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(out.text()).toContain('reason: adam up failed: boom');
    for (const k of Object.keys(CRITERIA)) expect(out.text()).toContain(`  ${k}: UNKNOWN`);
  });

  it('stop says the run is already aborted and signals nothing', async () => {
    const out = capture();
    const { h, files, signals, calls } = harness({ processes: [] });
    files.write(runPaths(RUN_DIR).abort, abortRecord);
    expect(await runCli(['smoke', 'stop', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(out.text()).toContain('already aborted');
    expect(signals).toEqual([]);
    expect(calls).toEqual([]);
    expect(files.read(join(RUN_DIR, 'stop-request.json'))).toBeNull();
  });
});

describe('stop', () => {
  it('reads started_at from the manifest, so a service started in this run is owned and signalled', async () => {
    const out = capture();
    const service: ProcessView = {
      pid: 4343,
      startedAt: '2026-11-09T23:30:00.000Z',
      commandLine: 'node C:/repo/golem/src/adam/main.ts',
    };
    const { h, files, signals } = harness({ processes: [service] });
    files.write(
      runPaths(RUN_DIR).manifest,
      JSON.stringify({ started_at: '2026-11-09T23:00:00.000Z' }),
    );
    await runCli(['smoke', 'stop', '--run-id', RUN], REPO, h, out.log);
    expect(signals.map((s) => s.pid)).toContain(4343);
  });

  it('with a stale pid file does not signal the recorded pid and runs the safe stop', async () => {
    const out = capture();
    const { h, files, signals, calls } = harness({ processes: [] });
    files.write(
      runPaths(RUN_DIR).manifest,
      JSON.stringify({ started_at: '2026-11-10T00:00:00.000Z' }),
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
    files.write(runPaths(RUN_DIR).manifest, JSON.stringify({ started_at: start }));
    files.write(
      join(RUN_DIR, 'run.pid.json'),
      JSON.stringify({ pid: 4242, startedAt: start, runId: RUN }),
    );
    expect(await runCli(['smoke', 'stop', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(files.read(join(RUN_DIR, 'stop-request.json'))).not.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('prepare-volume', () => {
  it('makes one new volume, records it in manifest.json, and prints how to select it', async () => {
    const out = capture();
    const { h, files, worldVolumes, calls } = harness();
    const code = await runCli(['8b', 'prepare-volume', '--run-id', RUN], REPO, h, out.log);
    expect(code).toBe(0);
    const name = `geldar-phase0-world-${RUN}`;
    expect(worldVolumes.calls).toEqual([
      `inspect:${name}`,
      `create:${name}:${RUN}`,
      `inspect:${name}`,
    ]);
    expect(JSON.parse(files.read(runPaths(RUN_DIR).manifest) ?? '{}').worldVolume).toBe(name);
    expect(out.text()).toContain(`$env:GELDAR_WORLD_VOLUME = '${name}'`);
    expect(calls).toEqual([]);
  });

  it('refuses a folder that already holds a run, and creates nothing', async () => {
    const out = capture();
    const { h, files, worldVolumes } = harness();
    files.write(runPaths(RUN_DIR).manifest, JSON.stringify({ started_at: '2026-11-10T00:00:00Z' }));
    expect(await runCli(['8b', 'prepare-volume', '--run-id', RUN], REPO, h, out.log)).toBe(1);
    expect(out.text()).toContain('already holds a manifest');
    expect(worldVolumes.calls.filter((c) => c.startsWith('create'))).toEqual([]);
  });

  it('refuses when the volume name already exists, and never reuses it', async () => {
    const out = capture();
    const { h, worldVolumes, files } = harness();
    worldVolumes.volumes.set(`geldar-phase0-world-${RUN}`, {
      exists: true,
      labelled: true,
      empty: true,
      usedBy: [],
    });
    expect(await runCli(['8b', 'prepare-volume', '--run-id', RUN], REPO, h, out.log)).toBe(1);
    expect(out.text()).toContain('already exists');
    expect(files.read(runPaths(RUN_DIR).manifest)).toBeNull();
  });

  it('is for 32b and 8b only: smoke is a usage error', () => {
    expect(parseArgs(['smoke', 'prepare-volume']).ok).toBe(false);
    expect(parseArgs(['32b', 'prepare-volume']).ok).toBe(true);
  });
});

describe('a prepared-only folder', () => {
  it('status reports it as prepared, not stopped', async () => {
    const out = capture();
    const { h, files } = harness();
    files.write(runPaths(RUN_DIR).manifest, preparedJson('8b', RUN));
    expect(await runCli(['8b', 'status', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(out.text()).toContain('state: prepared');
  });

  it('stop runs no safe stop: no supervisor call and no signal', async () => {
    const out = capture();
    const { h, files, signals, calls } = harness({ processes: [] });
    files.write(runPaths(RUN_DIR).manifest, preparedJson('8b', RUN));
    expect(await runCli(['8b', 'stop', '--run-id', RUN], REPO, h, out.log)).toBe(0);
    expect(out.text()).toContain('no safe stop run');
    expect(calls).toEqual([]);
    expect(signals).toEqual([]);
  });

  it('start accepts the prepared record and replaces it with the run manifest', async () => {
    const out = capture();
    const { h, files } = harness();
    files.write(runPaths(RUN_DIR).manifest, preparedJson('32b', RUN));
    await runCli(['32b', 'start', '--run-id', RUN, '--hours', '0.02'], REPO, h, out.log);
    expect(out.text()).not.toContain('already holds a run');
    expect(parsePrepared(files.read(runPaths(RUN_DIR).manifest))).toBeNull();
    expect(JSON.parse(files.read(runPaths(RUN_DIR).manifest) ?? '{}').schema).toBe(
      'adam-run-manifest/1',
    );
  });
});

describe('report', () => {
  it('regenerates the report from the run folder', async () => {
    const out = capture();
    const seen: string[] = [];
    const { h, files } = harness({ reporter: { reportRun: async (id) => void seen.push(id) } });
    files.write(
      runPaths(RUN_DIR).manifest,
      JSON.stringify({ started_at: '2026-11-10T00:00:00.000Z' }),
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
