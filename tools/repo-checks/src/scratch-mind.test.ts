/**
 * The scratch Mind overlay (compose/opt-in/scratch-mind.yml) and its verbs (scratch.sh mind-up, mind-token), which live in
 * deploy/scratch/scratch-mind.sh. Static checks read the overlay text; the verb checks run the script under the docker
 * stubs of scratch-harness.ts. No container starts: every docker call is recorded by the stub, and every refusal must
 * leave the list of compose calls empty.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type Env,
  JARS,
  type Run,
  runScript,
  SCRIPT,
  SCRIPT_PATH,
  skipWithoutSh,
  slash,
} from './scratch-harness.js';

const OVERLAY_PATH = SCRIPT_PATH.replace(
  'deploy/scratch/scratch.sh',
  'compose/opt-in/scratch-mind.yml',
);
const OVERLAY = readFileSync(OVERLAY_PATH, 'utf8');
const MIND_SERVICES = ['mind-migrate', 'mind-mint', 'geldar-mcp', 'players-host'];
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** An auth dir with the given files, each non-empty. */
function authDir(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mind-auth-'));
  made.push(dir);
  for (const f of files) writeFileSync(join(dir, f), 'x');
  return slash(dir);
}

/** The state dir of project scratch-a under the stub base; up writes its three secrets there. */
function stateDir(base: string): string {
  return join(base, 'state', 'geldar-scratch', 'scratch-a');
}

/** The state of a project that up started: the three up secrets, plus any extra files. */
function upSecrets(base: string, extra: string[] = []): void {
  const dir = stateDir(base);
  mkdirSync(dir, { recursive: true });
  for (const f of ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt', ...extra]) {
    writeFileSync(join(dir, f), 'x');
  }
}

const MIND_NATS = authDir(['nats-mcp.txt', 'nats-body.txt']);
const MIND_UP: Env = { STUB_PROJECT_UP: '1', SCRATCH_NATS_AUTH_DIR: MIND_NATS };
const TOKEN_MARKER = 'MIND-TOKEN-MARKER-NEVER-PRINTED';

/** Every compose call a run made. Refusals must leave this list empty. */
const composeCalls = (run: Run) => run.calls.filter((c) => c.includes('-p scratch-'));

describe.skipIf(skipWithoutSh())('scratch.sh mind verbs', () => {
  it('refuses mind-token for any name but the one test player, and runs nothing', () => {
    for (const player of ['Bad_Name', '1start', 'ag-jason-01', '', 'a'.repeat(32)]) {
      const run = runScript(['mind-token', 'a', player], MIND_UP, JARS);
      expect(run.status, player).toBe(2);
      expect(composeCalls(run), player).toEqual([]);
    }
  }, 30_000);

  it('refuses mind-up without SCRATCH_NATS_AUTH_DIR, and runs nothing', () => {
    const run = runScript(['mind-up', 'a'], { STUB_PROJECT_UP: '1' }, JARS);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('SCRATCH_NATS_AUTH_DIR');
    expect(composeCalls(run)).toEqual([]);
  }, 30_000);

  it('refuses mind-up when nats-body.txt is missing from the auth dir, and names the file', () => {
    const noBody = authDir(['nats-mcp.txt']);
    const run = runScript(
      ['mind-up', 'a'],
      { STUB_PROJECT_UP: '1', SCRATCH_NATS_AUTH_DIR: noBody },
      { ...JARS, prepare: (base) => upSecrets(base) },
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('nats-body.txt');
    expect(composeCalls(run)).toEqual([]);
  }, 30_000);

  it('refuses mind-up when the project is not up (no secrets dir), and runs nothing', () => {
    const run = runScript(['mind-up', 'a'], MIND_UP, JARS);
    expect(run.status).toBe(2);
    expect(composeCalls(run)).toEqual([]);
  }, 30_000);

  it('refuses mind-up when no healthy container is running, and starts no mind service', () => {
    const run = runScript(
      ['mind-up', 'a'],
      { SCRATCH_NATS_AUTH_DIR: MIND_NATS },
      {
        ...JARS,
        prepare: (base) => upSecrets(base),
      },
    );
    expect(run.status).toBe(2);
    expect(run.calls.some((c) => c.includes('mind-migrate') || c.includes('geldar-mcp'))).toBe(
      false,
    );
  }, 30_000);

  it('refuses mind-token before mind-up has written the mcp secrets', () => {
    const run = runScript(['mind-token', 'a', 'ag-test-01'], MIND_UP, {
      ...JARS,
      prepare: (base) => upSecrets(base),
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('mind-up has not run');
    expect(composeCalls(run)).toEqual([]);
  }, 30_000);

  it('refuses mind-token when the token file already exists, and never prints the token', () => {
    const run = runScript(['mind-token', 'a', 'ag-test-01'], MIND_UP, {
      ...JARS,
      prepare: (base) =>
        upSecrets(base, ['postgres-mcp.txt', 'mcp-token-pepper.txt', 'mind-token.txt']),
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('already exists');
    expect(composeCalls(run)).toEqual([]);
    expect(run.stdout + run.stderr + run.calls.join('\n')).not.toContain(TOKEN_MARKER);
  }, 30_000);

  it('runs the password one-shot, then starts only geldar-mcp and players-host, with the mind overlay', () => {
    const run = runScript(['mind-up', 'a'], MIND_UP, {
      ...JARS,
      prepare: (base) => upSecrets(base),
    });
    expect(run.status).toBe(0);
    expect(run.calls.some((c) => c.includes('mind-migrate'))).toBe(true);
    const up = run.calls.find((c) => c.includes(' up ') && c.includes('geldar-mcp'));
    expect(up).toContain('players-host');
    expect(run.calls.some((c) => c.includes('mind-mint'))).toBe(false);
    expect(run.calls.some((c) => c.includes('scratch-mind.yml'))).toBe(true);
  }, 30_000);

  it('never puts the token in any mind-up output or argv', () => {
    const run = runScript(['mind-up', 'a'], MIND_UP, {
      ...JARS,
      prepare: (base) => upSecrets(base, ['mind-token.txt']),
    });
    expect(run.stdout + run.stderr + run.calls.join('\n')).not.toContain(TOKEN_MARKER);
  }, 30_000);

  it('keeps the mind overlay out of status', () => {
    const run = runScript(['status', 'a'], { STUB_PROJECT_UP: '1' }, JARS);
    expect(run.calls.some((c) => c.includes('scratch-mind'))).toBe(false);
  }, 30_000);

  it('down removes the mind token with the secrets dir, and keeps its compose flags', () => {
    const TOKEN = 'state/geldar-scratch/scratch-a/mind-token.txt';
    const run = runScript(
      ['down', 'a'],
      { STUB_PROJECT_UP: '1' },
      {
        ...JARS,
        prepare: (base) =>
          upSecrets(base, ['mind-token.txt', 'postgres-mcp.txt', 'mcp-token-pepper.txt']),
        watch: [TOKEN],
      },
    );
    expect(run.status).toBe(0);
    expect(run.calls.some((c) => c.includes('down') && c.includes('--remove-orphans'))).toBe(true);
    expect(run.calls.some((c) => c.includes(' down ') && c.includes(' -v '))).toBe(true);
    expect(run.stdout + run.stderr).not.toContain(TOKEN_MARKER);
    expect(run.present[TOKEN]).toBe(false);
  }, 30_000);
});

describe('scratch-mind.yml overlay (static)', () => {
  it('declares the four mind services, each in profile mind, restart no, the scratch label', () => {
    for (const svc of MIND_SERVICES) expect(OVERLAY).toMatch(new RegExp(`^  ${svc}:$`, 'm'));
    expect(OVERLAY.match(/profiles: \["mind"\]/g)).toHaveLength(4);
    expect(OVERLAY.match(/restart: "no"/g)).toHaveLength(4);
    expect(OVERLAY.match(/geldar\.scratch: "true"/g)).toHaveLength(4);
  }, 30_000);

  it('publishes exactly one port, the MCP port, bound to loopback', () => {
    const published = [...OVERLAY.matchAll(/^\s+- "([^"]+:[^"]+)"$/gm)].map((m) => m[1]);
    expect(published).toEqual([`127.0.0.1:\${SCRATCH_MCP_PORT:-18788}:8788`]);
  }, 30_000);

  it('sets hard caps on every mind service: cpus, memory, memswap and pids', () => {
    expect(OVERLAY.match(/cpus: /g)).toHaveLength(4);
    expect(OVERLAY.match(/memory: /g)).toHaveLength(4);
    expect(OVERLAY.match(/memswap_limit: /g)).toHaveLength(4);
    expect(OVERLAY.match(/pids_limit: (128|256)/g)).toHaveLength(4);
    expect(OVERLAY.match(/pids: (128|256)/g)).toHaveLength(4);
  }, 30_000);

  it('mounts the scratch shard file and no colo file, and has no Caddy', () => {
    expect(OVERLAY).toContain('../shards/phase0.yaml:/opt/geldar/shards/phase0.yaml:ro');
    expect(OVERLAY).not.toMatch(/shards\/colo/);
    expect(OVERLAY.toLowerCase()).not.toContain('caddy');
  }, 30_000);

  it('takes its secrets from the scratch secrets dir and the NATS auth dir, never from compose/secrets', () => {
    expect(OVERLAY).toContain(
      `\${SCRATCH_NATS_AUTH_DIR:-/nonexistent-scratch-nats-auth}/nats-mcp.txt`,
    );
    expect(OVERLAY).toContain(
      `\${SCRATCH_NATS_AUTH_DIR:-/nonexistent-scratch-nats-auth}/nats-body.txt`,
    );
    expect(OVERLAY).toContain(
      `\${SCRATCH_SECRETS_DIR:-/nonexistent-scratch-secrets}/postgres-mcp.txt`,
    );
    expect(OVERLAY).not.toContain('../compose/secrets');
  }, 30_000);

  it('mints into the secrets dir only, through admin.sh, for the test player', () => {
    expect(OVERLAY).toContain('"token-mint"');
    expect(OVERLAY).toContain('"/out/mind-token.txt"');
    expect(OVERLAY).toContain(`\${SCRATCH_SECRETS_DIR:-/nonexistent-scratch-secrets}:/out`);
    expect(OVERLAY).toContain('ag-test-01');
  }, 30_000);

  it('makes every variable optional, so a bare render needs no environment', () => {
    expect(OVERLAY).not.toMatch(/:\?/);
  }, 30_000);

  it('sources the mind file only from the two mind verbs, and keeps scratch.sh under 660 lines', () => {
    expect(SCRIPT.match(/scratch-mind\.sh/g)).toHaveLength(2);
    expect(SCRIPT.split('\n').length).toBeLessThan(660);
  }, 30_000);
});
