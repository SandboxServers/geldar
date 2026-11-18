/**
 * The human listener on the scratch stack (SCRATCH_HUMAN_LANE=1): its overlay (compose/opt-in/scratch-human.yml), its
 * toml (compose/velocity/velocity-human.toml), its port defaults and the script wiring (deploy/scratch/scratch-human.sh,
 * scratch.sh). The overlay is parsed with the yaml package. The script runs under sh with the stubs, so no container starts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AUTH, JARS, type Run, runScript, skipWithoutSh, started } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');
const HUMAN_TEXT = read('compose/opt-in/scratch-human.yml');
const TOML_TEXT = read('compose/velocity/velocity-human.toml');
const PHASE0_TEXT = read('compose/phase0.yml');
const SCRATCH_TEXT = read('compose/opt-in/scratch.yml');
const MIND_TEXT = read('compose/opt-in/scratch-mind.yml');
const NF_TEXT = read('compose/opt-in/scratch-neoforge.yml');
const NF_ENV_TEXT = read('deploy/scratch/nf.env');
const TELEMETRY_TEXT = read('deploy/scratch/telemetry.env');

interface HumanService {
  image: string;
  environment: Record<string, string>;
  secrets: string[];
  volumes: string[];
  ports: string[];
  depends_on: Record<string, { condition: string }>;
  deploy: { resources: { limits: { memory: string; cpus: string; pids?: number } } };
  memswap_limit: string;
  labels: Record<string, string>;
  restart: string;
  healthcheck: { test: string[] };
  user?: string;
}
interface HumanPaper {
  services: Record<string, HumanService>;
  secrets?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
}
const HUMAN = parse(HUMAN_TEXT) as HumanPaper;
const PHASE0 = parse(PHASE0_TEXT) as { services: { velocity: { image: string } } };
const svc = HUMAN.services['velocity-human'] as HumanService;
const HUMAN_PORT_DEFAULT = Number(/SCRATCH_HUMAN_PORT:-(\d+)/.exec(HUMAN_TEXT)?.[1]);

/** The compose calls of one run, for the overlay checks: each docker line that reaches compose with the project flag. */
const composeLines = (run: Run) => run.calls.filter((c) => c.includes('-p scratch-'));
const UP_NF = { SCRATCH_PLATFORM: 'neoforge', SCRATCH_HUMAN_LANE: '1' };
const withHuman = (run: Run) => composeLines(run).some((c) => c.includes('scratch-human.yml'));

describe('human overlay: the service', () => {
  it('adds one service, velocity-human, and one volume', () => {
    expect(Object.keys(HUMAN.services)).toEqual(['velocity-human']);
    expect(Object.keys(HUMAN.volumes ?? {})).toEqual(['velocity-human-data']);
  });

  it('uses the same itzg/mc-proxy image and digest as the scratch velocity', () => {
    expect(svc.image).toBe(PHASE0.services.velocity.image);
    expect(svc.image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('publishes on loopback only, on the human port, and no other port', () => {
    expect(svc.ports).toEqual(['127.0.0.1:${SCRATCH_HUMAN_PORT:-35566}:25565']);
    expect(HUMAN_TEXT).not.toMatch(/0\.0\.0\.0|\[::\]/);
  });

  it('is capped: memory 768m with no swap, 0.5 CPU, and a pids limit', () => {
    expect(svc.deploy.resources.limits).toEqual({ memory: '768m', cpus: '0.5', pids: 256 });
    expect(svc.memswap_limit).toBe('768m');
    // One pids form only: a top-level pids_limit beside deploy.resources.limits.pids breaks the combined render.
    expect(svc).not.toHaveProperty('pids_limit');
  });

  it('is labelled geldar.scratch, restart no, and has no user override', () => {
    expect(svc.labels).toEqual({ 'geldar.scratch': 'true' });
    expect(svc.restart).toBe('no');
    expect(svc.user).toBeUndefined();
  });

  it('sets the human lane and the velocity NATS user, with no new role', () => {
    expect(svc.environment.GELDAR_IDENTITY_LANE).toBe('human');
    expect(svc.environment.GELDAR_NATS_USER).toBe('velocity');
    expect(svc.environment.GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-velocity.txt');
    expect(svc.environment.GELDAR_NATS_URL).toBe('nats://nats:4222');
    expect(svc.environment.UID).toBe('${SCRATCH_RUN_UID:?set by deploy/scratch/scratch.sh}');
    expect(svc.environment.GID).toBe('${SCRATCH_RUN_GID:?set by deploy/scratch/scratch.sh}');
    expect(HUMAN_TEXT).not.toMatch(/GELDAR_IDENTITY_LANE: agent/);
  });

  it('uses the existing secrets only: no top-level secret of its own', () => {
    expect(svc.secrets.sort()).toEqual(['nats-velocity.txt', 'velocity-forwarding']);
    expect(HUMAN.secrets).toBeUndefined();
  });

  it('mounts its own config and the identity jar, and its own data volume', () => {
    expect(svc.volumes).toEqual([
      './velocity/velocity-human.toml:/config/velocity.toml:ro',
      'velocity-human-data:/server',
      '../plugin/velocity-identity/build/libs/geldar-velocity-identity.jar:/plugins/geldar-velocity-identity.jar:ro',
    ]);
  });

  it('waits for paper healthy, nats healthy and identity-seed completed', () => {
    expect(svc.depends_on).toEqual({
      paper: { condition: 'service_healthy' },
      nats: { condition: 'service_healthy' },
      'identity-seed': { condition: 'service_completed_successfully' },
    });
  });

  it('checks its own identity ready file and the port', () => {
    expect(svc.healthcheck.test.join(' ')).toContain('/tmp/geldar-identity.ready');
    expect(svc.healthcheck.test.join(' ')).toContain('/dev/tcp/127.0.0.1/25565');
  });
});

describe('human overlay: the toml', () => {
  it('is online-mode, with modern forwarding and the forwarding secret as a file', () => {
    expect(TOML_TEXT).toMatch(/^online-mode = true$/m);
    expect(TOML_TEXT).not.toMatch(/^online-mode = false/m);
    expect(TOML_TEXT).toMatch(/^player-info-forwarding-mode = "modern"$/m);
    expect(TOML_TEXT).toMatch(/^forwarding-secret-file = "\/run\/secrets\/velocity-forwarding"$/m);
  });

  it('has no secret value in it', () => {
    expect(TOML_TEXT).not.toMatch(/forwarding-secret\s*=/);
    expect(TOML_TEXT).not.toMatch(/password|token/i);
  });

  it('routes to the scratch NeoForge server only', () => {
    expect(TOML_TEXT).toMatch(/^paper = "paper:25565"$/m);
    expect(TOML_TEXT).toMatch(/^try = \["paper"\]$/m);
  });
});

describe('human overlay: the port defaults', () => {
  it('is a port of its own, in no other default of the scratch blocks', () => {
    const others = [
      ...SCRATCH_TEXT.matchAll(/SCRATCH_\w+_PORT:-(\d+)/g),
      ...MIND_TEXT.matchAll(/SCRATCH_\w+_PORT:-(\d+)/g),
      ...NF_TEXT.matchAll(/SCRATCH_\w+_PORT:-(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(others).not.toContain(HUMAN_PORT_DEFAULT);
    expect(HUMAN_PORT_DEFAULT).toBeGreaterThan(1024);
  });

  it('is set in nf.env as the scratch-a default plus 20000, and no other port changes', () => {
    expect(NF_ENV_TEXT).toMatch(/^SCRATCH_HUMAN_PORT=55566$/m);
    const nfPorts = [...NF_ENV_TEXT.matchAll(/=(\d+)/g)].map((m) => Number(m[1]));
    expect(nfPorts).not.toContain(HUMAN_PORT_DEFAULT);
    expect(nfPorts.filter((p) => p !== 55566)).not.toContain(55566);
    expect(TELEMETRY_TEXT).not.toMatch(/SCRATCH_HUMAN_PORT/);
  });
});

describe('scratch.sh: the human lane', () => {
  skipWithoutSh();
  const SLOW = { timeout: 30_000 };

  it('the default up renders no human service', SLOW, () => {
    const run = runScript(['up', 'nf'], { ...AUTH, SCRATCH_PLATFORM: 'neoforge' }, JARS);
    expect(run.status).toBe(0);
    expect(started(run)).toBe(true);
    expect(withHuman(run)).toBe(false);
  });

  it('SCRATCH_HUMAN_LANE=1 adds the overlay on up', SLOW, () => {
    const run = runScript(['up', 'nf'], { ...AUTH, ...UP_NF }, JARS);
    expect(run.status).toBe(0);
    expect(withHuman(run)).toBe(true);
  });

  it('refuses the paper platform with exit 2 and starts nothing', SLOW, () => {
    const run = runScript(
      ['up', 'nf'],
      { ...AUTH, SCRATCH_PLATFORM: 'paper', SCRATCH_HUMAN_LANE: '1' },
      JARS,
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/neoforge/);
    expect(started(run)).toBe(false);
  });

  it('refuses a missing NATS auth dir with exit 2 and starts nothing', SLOW, () => {
    const run = runScript(
      ['up', 'nf'],
      { SCRATCH_PLATFORM: 'neoforge', SCRATCH_HUMAN_LANE: '1' },
      JARS,
    );
    expect(run.status).toBe(2);
    expect(started(run)).toBe(false);
  });

  it('refuses any value but 1 with exit 2 and starts nothing', SLOW, () => {
    const run = runScript(
      ['up', 'nf'],
      { ...AUTH, SCRATCH_PLATFORM: 'neoforge', SCRATCH_HUMAN_LANE: 'yes' },
      JARS,
    );
    expect(run.status).toBe(2);
    expect(started(run)).toBe(false);
  });

  it('status and down include the overlay with and without the variable', {
    timeout: 120_000,
  }, () => {
    for (const verb of ['status', 'down']) {
      const without = runScript([verb, 'nf'], { SCRATCH_PLATFORM: 'neoforge' }, JARS);
      const withVar = runScript([verb, 'nf'], { ...AUTH, ...UP_NF }, JARS);
      expect(without.status).toBe(0);
      expect(withVar.status).toBe(0);
      expect(withHuman(without)).toBe(true);
      expect(withHuman(withVar)).toBe(true);
    }
  });
});
