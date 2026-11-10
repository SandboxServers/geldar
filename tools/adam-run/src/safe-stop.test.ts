import { describe, expect, it } from 'vitest';
import {
  FakeClock,
  FakeProcesses,
  FakeSupervisor,
  MemoryFiles,
  MIN,
  START_MS,
  scenario,
} from '../test/fakes.ts';
import { type ProcessView, runPaths } from './ports.ts';
import { ownership, type SafeStopDeps, type SafeStopInput, safeStop } from './safe-stop.ts';

const RUN_DIR = '.geldar/runs/run-1';
const OWNED_AT = new Date(START_MS + 2 * MIN).toISOString();
const BEFORE_RUN = new Date(START_MS - MIN).toISOString();

function rig() {
  const clock = new FakeClock();
  const s = scenario('ag_smoke_01');
  const deps: SafeStopDeps = {
    clock,
    files: new MemoryFiles(),
    processes: new FakeProcesses(),
    supervisor: new FakeSupervisor(clock, s),
  };
  const input: SafeStopInput = {
    runDir: RUN_DIR,
    runStartedAtMs: START_MS,
    rule: 'tps',
    reason: 'TPS under 19.5 for 5 minutes',
    lastObservation: null,
  };
  return {
    deps,
    input,
    files: deps.files as MemoryFiles,
    sup: deps.supervisor as FakeSupervisor,
    procs: deps.processes as FakeProcesses,
  };
}

const proc = (pid: number, startedAt: string, commandLine: string): ProcessView => ({
  pid,
  startedAt,
  commandLine,
});

describe('ownership', () => {
  const cases: [string, ProcessView, 'other' | 'owned' | 'unverifiable'][] = [
    [
      'a service entry file started during the run',
      proc(1, OWNED_AT, 'node C:\\repo\\animus\\src\\main.ts'),
      'owned',
    ],
    [
      'a quoted path with a space',
      proc(2, OWNED_AT, 'node "C:/my repo/golem/src/adam/main.ts"'),
      'owned',
    ],
    [
      'the same entry file started before the run',
      proc(3, BEFORE_RUN, 'node animus/src/main.ts'),
      'other',
    ],
    [
      'a marker with an unreadable start time',
      proc(4, '', 'node animus/src/main.ts'),
      'unverifiable',
    ],
    ['an unrelated process', proc(5, OWNED_AT, 'node server.js'), 'other'],
    ['a process with an unreadable command line', proc(6, OWNED_AT, ''), 'other'],
  ];
  it.each(cases)('%s', (_name, p, want) => {
    expect(ownership(p, START_MS)).toBe(want);
  });
});

describe('safeStop', () => {
  it('stops lantern-local, animus and the Body, in that order', async () => {
    const r = rig();
    const out = await safeStop(r.deps, r.input);
    expect(r.sup.calls).toEqual(['stop:lantern-local', 'stop:animus', 'stop:body']);
    expect(out).toMatchObject({ orphans: 'pass', exitCode: 0, alreadyStopped: false });
  });

  it('writes abort.json with the reason, the orphan result and the last sample, and a safe_stop line', async () => {
    const r = rig();
    const sample = {
      atMs: START_MS + 9 * MIN,
      lifeId: 'ag_smoke_01',
      alive: {
        animus: true,
        body: true,
        'lantern-local': true,
        ollama: false,
        postgres: true,
        nats: true,
        paper: true,
      },
      thoughts: 3,
      lastThoughtAtMs: START_MS + 9 * MIN,
      tps: 10,
      latencyP95Ms: 4000,
      activeIntentId: null,
      deaths: 0,
      gpuPresent: true,
      diskFreeGb: 50,
      bodyConnected: true,
      errorsSinceLast: 0,
    };
    await safeStop(r.deps, { ...r.input, lastObservation: sample });
    const abort = JSON.parse(r.files.read(runPaths(RUN_DIR).abort) ?? 'null') as Record<
      string,
      unknown
    >;
    expect(abort).toMatchObject({
      schema: 'adam-run-abort/1',
      rule: 'tps',
      reason: 'TPS under 19.5 for 5 minutes',
      orphanCheck: { result: 'pass', detail: [] },
      exitCode: 0,
    });
    expect(abort.lastSample).toMatchObject({ minute: 9, tps: 10 });
    const lines = r.files.lines(runPaths(RUN_DIR).status);
    expect(lines.at(-1)).toMatchObject({ event: 'safe_stop', detail: 'orphans: pass' });
  });

  it('signals an owned leftover gracefully, then forces it once when it survives', async () => {
    const r = rig();
    r.procs.table = [proc(40, OWNED_AT, 'node golem/src/adam/main.ts')];
    r.procs.survives.add(40);
    const out = await safeStop(r.deps, r.input);
    expect(r.procs.signals).toEqual([
      { pid: 40, force: false },
      { pid: 40, force: true },
    ]);
    expect(out).toMatchObject({ orphans: 'fail', exitCode: 1 });
  });

  it('does not force a leftover that exits on the graceful request', async () => {
    const r = rig();
    r.procs.table = [proc(41, OWNED_AT, 'node lantern-local/src/main.ts')];
    const out = await safeStop(r.deps, r.input);
    expect(r.procs.signals).toEqual([{ pid: 41, force: false }]);
    expect(out).toMatchObject({ orphans: 'pass', exitCode: 0 });
  });

  it('does not signal a process it cannot verify, and exits non-zero', async () => {
    const r = rig();
    r.procs.table = [proc(42, '', 'node animus/src/main.ts')];
    r.procs.survives.add(42);
    const out = await safeStop(r.deps, r.input);
    expect(r.procs.signals).toEqual([]);
    expect(out).toMatchObject({ orphans: 'unverifiable', exitCode: 1 });
    expect(out.orphanDetail).toEqual(['pid 42: unverifiable']);
  });

  it('leaves a process from before the run alone', async () => {
    const r = rig();
    r.procs.table = [proc(43, BEFORE_RUN, 'node animus/src/main.ts')];
    const out = await safeStop(r.deps, r.input);
    expect(r.procs.signals).toEqual([]);
    expect(out.orphans).toBe('pass');
  });

  it('records a stop error and still stops the other services', async () => {
    const r = rig();
    (r.sup as FakeSupervisor).failStop = 'animus';
    const out = await safeStop(r.deps, r.input);
    expect(r.sup.calls).toEqual(['stop:lantern-local', 'stop:animus', 'stop:body']);
    expect(out.stopErrors).toEqual(['animus: animus would not stop']);
    expect(out.exitCode).toBe(1);
  });

  it('is a no-op the second time: no stop, no signal, no new line', async () => {
    const r = rig();
    const first = await safeStop(r.deps, r.input);
    const abortPath = runPaths(RUN_DIR).abort;
    const abortBefore = r.files.read(abortPath);
    const writesBefore = r.files.writes;
    const callsBefore = [...r.sup.calls];
    const signalsBefore = r.procs.signals.length;
    const second = await safeStop(r.deps, r.input);
    expect(second).toMatchObject({
      alreadyStopped: true,
      orphans: first.orphans,
      exitCode: first.exitCode,
    });
    expect(r.sup.calls).toEqual(callsBefore);
    expect(r.procs.signals.length).toBe(signalsBefore);
    expect(r.files.writes).toBe(writesBefore);
    expect(r.files.read(abortPath)).toBe(abortBefore);
  });
});
