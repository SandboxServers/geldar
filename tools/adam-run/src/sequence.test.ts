import { describe, expect, it } from 'vitest';
import {
  CRITERIA,
  FakeClock,
  FakeProcesses,
  FakeReporter,
  FakeSampler,
  FakeSupervisor,
  MemoryFiles,
  MIN,
  passingPreflight,
  type Scenario,
  START_MS,
  scenario,
} from '../test/fakes.ts';
import { LIFE_ID, type Profile } from './manifest.ts';
import { runPaths } from './ports.ts';
import { type RunInput, runSequence, type SequenceDeps } from './sequence.ts';

const RUN_DIR = '.geldar/runs/run-1';
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
type Line = Record<string, unknown>;

function rig(
  profile: Profile,
  over: Partial<Scenario>,
  input: Partial<RunInput> = {},
  preflightOver: { otherChanges?: string[] } = {},
) {
  const clock = new FakeClock();
  const s = scenario(LIFE_ID[profile], over);
  const files = new MemoryFiles();
  const supervisor = new FakeSupervisor(clock, s);
  const reporter = new FakeReporter();
  const deps: SequenceDeps = {
    clock,
    files,
    processes: new FakeProcesses(),
    sampler: new FakeSampler(clock, s),
    supervisor,
    reporter,
    preflight: passingPreflight(profile, preflightOver),
    criteria: CRITERIA,
  };
  const run: RunInput = {
    runId: 'run-1',
    runDir: RUN_DIR,
    profile,
    seed: 7,
    durationMs: 30 * MIN,
    plannedRestartAtMs: null,
    bodyKillAtMs: null,
    ...input,
  };
  return {
    deps,
    run,
    files,
    sup: supervisor,
    reporter,
    lines: (): Line[] => files.lines(runPaths(RUN_DIR).status),
  };
}

/** Changes the fake stack from the given minute on. */
function from(minute: number, patch: Partial<Scenario>): Partial<Scenario> {
  return {
    onObserve: (now, s) => {
      if (now >= START_MS + minute * MIN) Object.assign(s, patch);
    },
  };
}

const samples = (lines: Line[]): Line[] => lines.filter((l) => l.event === undefined);
const events = (lines: Line[], event: string): Line[] => lines.filter((l) => l.event === event);

describe('runSequence', () => {
  it('runs 30 simulated minutes with a restart and a Body kill, then reports', async () => {
    const r = rig(
      'smoke',
      { intent: (t) => (t >= START_MS + 20 * MIN ? 'intent-1' : null) },
      { plannedRestartAtMs: START_MS + 10 * MIN, bodyKillAtMs: START_MS + 20 * MIN },
    );
    const out = await runSequence(r.deps, r.run);
    expect(out).toEqual({ status: 'completed', bodyKills: 1, reportFailed: false });
    expect(r.sup.count('restartStack')).toBe(1);
    expect(r.sup.count('restartBody')).toBe(1);
    expect(r.reporter.runs).toEqual(['run-1']);
    const lines = r.lines();
    expect(samples(lines).map((l) => l.minute)).toEqual(range(1, 30));
    expect(events(lines, 'restart_stack')).toMatchObject([{ minute: 10 }]);
    expect(events(lines, 'body_kill')).toMatchObject([{ minute: 20, detail: 'intent intent-1' }]);
    expect(lines.at(-1)).toMatchObject({ event: 'end', detail: 'completed' });
  });

  it('runs 3 simulated hours of the 32b profile with a restart and a Body kill', async () => {
    const r = rig(
      '32b',
      { intent: (t) => (t >= START_MS + 120 * MIN ? 'intent-1' : null) },
      {
        durationMs: 180 * MIN,
        plannedRestartAtMs: START_MS + 60 * MIN,
        bodyKillAtMs: START_MS + 120 * MIN,
      },
    );
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'completed', bodyKills: 1 });
    const lines = r.lines();
    expect(samples(lines).map((l) => l.minute)).toEqual(range(1, 180));
    expect(events(lines, 'restart_stack')).toMatchObject([{ minute: 60 }]);
    expect(events(lines, 'body_kill')).toMatchObject([{ minute: 120 }]);
    expect(JSON.parse(r.files.read(runPaths(RUN_DIR).manifest) ?? '{}')).toMatchObject({
      life_id: 'ag_adam_03',
    });
    expect(r.reporter.runs).toEqual(['run-1']);
  });

  it('kills the Body exactly once even when the intent flag stays true', async () => {
    const r = rig('smoke', { intent: () => 'intent-1' }, { bodyKillAtMs: START_MS + 5 * MIN });
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'completed', bodyKills: 1 });
    expect(r.sup.count('restartBody')).toBe(1);
    expect(events(r.lines(), 'body_kill')).toHaveLength(1);
  });

  it('does not kill the Body when no intent is active at the planned moment', async () => {
    const r = rig('smoke', { intent: () => null }, { bodyKillAtMs: START_MS + 10 * MIN });
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'completed', bodyKills: 0 });
    expect(r.sup.count('restartBody')).toBe(0);
    expect(events(r.lines(), 'body_kill')).toHaveLength(0);
  });

  it('writes one status line per simulated minute, with the harness lines on their own', async () => {
    const r = rig('smoke', {}, { plannedRestartAtMs: START_MS + 3 * MIN });
    await runSequence(r.deps, r.run);
    const lines = r.lines();
    const sampleMinutes = samples(lines).map((l) => l.minute);
    expect(sampleMinutes).toEqual(range(1, 30));
    expect(new Set(sampleMinutes).size).toBe(sampleMinutes.length);
  });

  it('refuses to start when the precheck fails, and writes and starts nothing', async () => {
    const r = rig('smoke', {}, {}, { otherChanges: ['animus/src/x.ts'] });
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'refused' });
    expect(r.sup.calls).toEqual([]);
    expect(r.files.writes).toBe(0);
  });

  it('restarts the stack and resumes sampling on the same life id', async () => {
    const r = rig('smoke', {}, { plannedRestartAtMs: START_MS + 10 * MIN });
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'completed' });
    expect(r.sup.count('restartStack')).toBe(1);
    expect(samples(r.lines()).at(-1)).toMatchObject({ minute: 30 });
  });

  it('aborts with restart_not_recovered when the stack comes back on another life id', async () => {
    const r = rig(
      'smoke',
      { lifeAfterRestart: 'ag_smoke_02' },
      {
        durationMs: 60 * MIN,
        plannedRestartAtMs: START_MS + 10 * MIN,
      },
    );
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({
      status: 'aborted',
      rule: 'restart_not_recovered',
      safeStopExit: 0,
    });
    expect(r.sup.calls.slice(-3)).toEqual(['stop:lantern-local', 'stop:animus', 'stop:body']);
    expect(r.reporter.runs).toEqual(['run-1']);
    expect(r.lines().at(-1)).toMatchObject({ event: 'abort', minute: 20 });
  });

  it('a life that ends ends the run as ended (life_ended): the safe stop, the report, an ended line, no abort', async () => {
    const r = rig('smoke', from(5, { deaths: 1 }), { durationMs: 60 * MIN });
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'ended', reason: 'life_ended', safeStopExit: 0 });
    expect(r.sup.calls.slice(-3)).toEqual(['stop:lantern-local', 'stop:animus', 'stop:body']);
    expect(r.reporter.runs).toEqual(['run-1']);
    expect(r.lines().at(-1)).toMatchObject({ event: 'ended', minute: 5 });
    expect(r.lines().some((l) => l.event === 'abort')).toBe(false);
  });

  it('aborts with body_not_recovered when the Body does not reconnect after the kill', async () => {
    const r = rig(
      'smoke',
      { bodyNeverBack: true, intent: () => 'intent-1' },
      { bodyKillAtMs: START_MS + 5 * MIN },
    );
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'aborted', rule: 'body_not_recovered', bodyKills: 1 });
    expect(r.sup.count('restartBody')).toBe(1);
  });

  it('aborts with error when the sampler fails, and still runs the safe stop and the report', async () => {
    const r = rig('smoke', { sampleFailsFrom: START_MS + 5 * MIN }, { durationMs: 60 * MIN });
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'aborted', rule: 'error', safeStopExit: 0 });
    expect(r.sup.calls.slice(-3)).toEqual(['stop:lantern-local', 'stop:animus', 'stop:body']);
    expect(r.reporter.runs).toEqual(['run-1']);
    expect(r.lines().at(-1)).toMatchObject({ event: 'abort' });
  });

  const ABORTS: [string, number, Partial<Scenario>, string][] = [
    ['gpu', 3, { gpuPresent: false }, 'gpu'],
    ['tps', 3, { tps: 10 }, 'tps'],
    ['latency', 3, { latencyP95Ms: 20_000 }, 'latency'],
    ['ollama', 3, { ollamaUp: false }, 'ollama'],
    ['postgres', 3, { postgresUp: false }, 'postgres'],
    ['nats', 3, { natsUp: false }, 'nats'],
    ['body', 3, { bodyDownUntil: Number.POSITIVE_INFINITY }, 'body'],
    ['disk', 3, { diskFreeGb: 5 }, 'disk'],
    ['no-thought', 0, { thinking: false }, 'no-thought'],
  ];
  it.each(ABORTS)(
    'the %s rule fires the safe stop, then the report, then an abort line',
    async (_n, minute, patch, rule) => {
      const r = rig('smoke', from(minute, patch), { durationMs: 60 * MIN });
      const out = await runSequence(r.deps, r.run);
      expect(out).toMatchObject({ status: 'aborted', rule, safeStopExit: 0 });
      expect(r.sup.calls.slice(-3)).toEqual(['stop:lantern-local', 'stop:animus', 'stop:body']);
      expect(r.reporter.runs).toEqual(['run-1']);
      expect(JSON.parse(r.files.read(runPaths(RUN_DIR).abort) ?? '{}')).toMatchObject({ rule });
      const lines = r.lines();
      expect(lines.at(-1)).toMatchObject({ event: 'abort' });
      expect(String(lines.at(-1)?.detail)).toContain(`${rule}:`);
    },
  );

  it('ends the run as operator_stop when a stop is requested mid-run, with the report and one abort line', async () => {
    const r = rig('smoke', {});
    let checks = 0;
    r.deps.stopRequested = () => ++checks >= 5;
    const out = await runSequence(r.deps, r.run);
    expect(out).toMatchObject({ status: 'aborted', rule: 'operator_stop', bodyKills: 0 });
    const aborts = events(r.lines(), 'abort');
    expect(aborts).toHaveLength(1);
    expect(String(aborts[0]?.detail)).toContain('operator_stop:');
  });
});
