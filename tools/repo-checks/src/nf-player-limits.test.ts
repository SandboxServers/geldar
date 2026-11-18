/**
 * The NeoForge shard's player limits. compose/nf-live.yml (the neoforge service) and the scratch NeoForge overlay
 * (compose/opt-in/scratch-neoforge.yml, the paper service, merged over phase0.yml and scratch.yml) must both give the
 * itzg image the same three values: MAX_PLAYERS, VIEW_DISTANCE and SIMULATION_DISTANCE. The autonomous Paper values in
 * compose/phase0.yml must not change. Both files are rendered with `docker compose config`, so the values are what
 * compose hands the container after merging. Nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LIMITS: Record<string, string> = {
  MAX_PLAYERS: '10',
  VIEW_DISTANCE: '8',
  SIMULATION_DISTANCE: '6',
};
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
if (!DOCKER && process.env.CI) {
  throw new Error(
    'docker compose is not on PATH and CI is set: the nf player-limit render tests must run',
  );
}
const suite = DOCKER ? describe : describe.skip;

// Dummy secret and jar files, so the render needs no real secret. Their content never appears in the output.
const DUMMY_FILES = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-auth.conf',
  'nats-sink.txt',
  'nats-neoforge.txt',
  'nats-velocity.txt',
  'nats-seed.txt',
  'nats-paper.txt',
  'nats-eventsink.txt',
  'nats-deploy.txt',
  'geldar-neoforge.jar',
];

interface Service {
  environment?: Record<string, string>;
}
interface Rendered {
  services: Record<string, Service>;
}

function renderFiles(
  project: string,
  files: string[],
  env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const args = ['compose', '-p', project];
  for (const file of files) args.push('-f', file);
  args.push('config', '--format', 'json');
  const run = spawnSync('docker', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function renderOrThrow(project: string, files: string[], env: Record<string, string>): Rendered {
  const run = renderFiles(project, files, env);
  if (run.status !== 0)
    throw new Error(`docker compose config failed for ${project}: ${run.stderr}`);
  return JSON.parse(run.stdout) as Rendered;
}

function autonomousPaperEnv(): Record<string, string> {
  const text = readFileSync(join(ROOT, 'compose', 'phase0.yml'), 'utf8');
  const parsed = parse(text) as { services: Record<string, Service> };
  return parsed.services.paper?.environment ?? {};
}

describe('compose/phase0.yml autonomous Paper limits', () => {
  it('keeps VIEW_DISTANCE 6, SIMULATION_DISTANCE 5 and MAX_PLAYERS 400', () => {
    const env = autonomousPaperEnv();
    expect(env.VIEW_DISTANCE).toBe('6');
    expect(env.SIMULATION_DISTANCE).toBe('5');
    expect(env.MAX_PLAYERS).toBe('400');
  });
});

suite('NeoForge player limits in the rendered compose config', () => {
  let dummyDir = '';
  let live: Rendered;
  let scratch: Rendered;

  beforeAll(() => {
    dummyDir = mkdtempSync(join(tmpdir(), 'nf-player-limits-'));
    mkdirSync(dummyDir, { recursive: true });
    for (const name of DUMMY_FILES) writeFileSync(join(dummyDir, name), '');
    const secretEnv = {
      NF_SECRETS_DIR: dummyDir,
      NF_MOD_JAR_HOST: join(dummyDir, 'geldar-neoforge.jar'),
      NF_MOD_SHA256: '0'.repeat(64),
      SCRATCH_SECRETS_DIR: dummyDir,
      SCRATCH_NATS_AUTH_DIR: dummyDir,
      SCRATCH_RUN_UID: '1000',
      SCRATCH_RUN_GID: '1000',
      GELDAR_WORLD_VOLUME: 'scratch-nf_paper-data',
    };
    live = renderOrThrow('geldar-nf', ['compose/nf-live.yml'], secretEnv);
    scratch = renderOrThrow(
      'scratch-nf',
      ['compose/phase0.yml', 'compose/opt-in/scratch.yml', 'compose/opt-in/scratch-neoforge.yml'],
      secretEnv,
    );
  });

  afterAll(() => {
    if (dummyDir) rmSync(dummyDir, { recursive: true, force: true });
  });

  it('pins the three values on the live neoforge service, exactly', () => {
    const env = live.services.neoforge?.environment ?? {};
    for (const [key, value] of Object.entries(LIMITS)) {
      expect(env[key], `neoforge ${key}`).toBe(value);
    }
  });

  it('pins the same three values on the scratch paper service, after the merge over phase0.yml', () => {
    const env = scratch.services.paper?.environment ?? {};
    for (const [key, value] of Object.entries(LIMITS)) {
      expect(env[key], `scratch paper ${key}`).toBe(value);
    }
  });

  it('renders the scratch paper service as NeoForge, so the limits are on the platform they are for', () => {
    expect(scratch.services.paper?.environment?.TYPE).toBe('NEOFORGE');
    expect(live.services.neoforge?.environment?.TYPE).toBe('NEOFORGE');
  });
});
