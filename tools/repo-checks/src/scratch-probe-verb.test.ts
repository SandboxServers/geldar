/**
 * The scratch probe verb (`sh deploy/scratch/scratch.sh probe <suffix>`): runs the p0-probe one-shot against a scratch
 * project that is already up. Each case runs a copy of the script under sh with the docker stubs from
 * scratch-harness.ts, so nothing starts a container. The probe itself is tested in golem/.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Env, type Run, runScript, skipWithoutSh, slash } from './scratch-harness.js';

const FIVE = [
  'nats-auth.conf',
  'nats-paper.txt',
  'nats-velocity.txt',
  'nats-eventsink.txt',
  'nats-seed.txt',
];
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** An auth dir for the probe: the five files, plus nats-body.txt when `body` is true. */
function probeAuth(body: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'probe-auth-'));
  made.push(dir);
  for (const f of [...FIVE, ...(body ? ['nats-body.txt'] : [])]) writeFileSync(join(dir, f), 'x');
  return dir;
}

/** A project that `up` started: its state directory holds the NATS override that `up` wrote (five files). */
function upState(base: string): void {
  const dir = join(base, 'state', 'geldar-scratch', 'scratch-a');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nats-override.yml'), 'secrets:\n');
}

const runsProbe = (run: Run) => run.calls.filter((c) => c.includes(' run --rm'));

describe.skipIf(skipWithoutSh())('scratch probe verb', () => {
  const body = slash(probeAuth(true));
  const noBody = slash(probeAuth(false));
  const up: Env = { STUB_PROJECT_UP: '1', SCRATCH_NATS_AUTH_DIR: body };

  it('refuses with nats-body.txt named when the auth dir holds only the five files; nothing runs', () => {
    const run = runScript(
      ['probe', 'a'],
      { STUB_PROJECT_UP: '1', SCRATCH_NATS_AUTH_DIR: noBody },
      { prepare: upState },
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('nats-body.txt');
    expect(run.stderr).toContain('six files');
    expect(runsProbe(run)).toEqual([]);
  });

  it('refuses when the project is not up (no running container); nothing runs', () => {
    const run = runScript(['probe', 'a'], { SCRATCH_NATS_AUTH_DIR: body }, { prepare: upState });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('scratch-a is not up');
    expect(runsProbe(run)).toEqual([]);
  });

  it('refuses when the project was not started with an auth dir (no NATS override); nothing runs', () => {
    const run = runScript(['probe', 'a'], up);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('no NATS override');
    expect(runsProbe(run)).toEqual([]);
  });

  it('refuses an invalid SCRATCH_PLATFORM before anything else; nothing runs', () => {
    const run = runScript(
      ['probe', 'a'],
      { ...up, SCRATCH_PLATFORM: 'bogus' },
      { prepare: upState },
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('SCRATCH_PLATFORM must be paper or neoforge');
    expect(runsProbe(run)).toEqual([]);
  });

  it('refuses a suffix that does not make a scratch-<suffix> project, exit 2', () => {
    const run = runScript(['probe', 'Colo'], up, { prepare: upState });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('suffix must match [a-z0-9]{1,9}');
    expect(run.calls).toEqual([]);
  });

  it('runs the p0-probe one-shot with the probe overlay and the six-file override, and passes its exit code through', () => {
    const run = runScript(['probe', 'a'], up, { prepare: upState });
    expect(run.status).toBe(0);
    const [call] = runsProbe(run);
    expect(call).toContain('-p scratch-a');
    expect(call).toContain('compose/opt-in/scratch-probe.yml');
    expect(call).toContain('--profile p0 run --rm --no-deps --build p0-probe');
    expect(call).not.toContain(' up ');
    expect(run.calls).toContain('BODY_SECRET_IN_OVERRIDE');
  });

  it('passes a failing probe exit code through unchanged', () => {
    const run = runScript(['probe', 'a'], { ...up, STUB_RUN_EXIT: '7' }, { prepare: upState });
    expect(run.status).toBe(7);
  });

  it('keeps up at five files: up with the five files and no nats-body.txt still reaches compose up', () => {
    const run = runScript(['up', 'a'], { SCRATCH_NATS_AUTH_DIR: noBody }, { tree: { jars: true } });
    expect(run.stderr).not.toContain('nats-body.txt');
    expect(run.calls.some((c) => c.includes(' up -d --wait --build'))).toBe(true);
    expect(run.calls).not.toContain('BODY_SECRET_IN_OVERRIDE');
  }, 30000);
});
