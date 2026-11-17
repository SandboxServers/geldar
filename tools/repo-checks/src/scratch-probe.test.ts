/**
 * The scratch P0 probe overlay (compose/opt-in/scratch-probe.yml, service `p0-probe`): a one-shot that only the probe verb
 * of deploy/scratch/scratch.sh starts. Text checks run everywhere; the render checks run `docker compose config` on the
 * merged files, with dummy auth files, and skip when docker compose is not installed. Nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { slash } from './scratch-harness.js';

const ROOT = new URL('../../../', import.meta.url);
const OVERLAY_TEXT = readFileSync(new URL('compose/opt-in/scratch-probe.yml', ROOT), 'utf8');
const SCRATCH_SH = readFileSync(new URL('deploy/scratch/scratch.sh', ROOT), 'utf8');
const NATS_FILES = [
  'nats-auth.conf',
  'nats-paper.txt',
  'nats-velocity.txt',
  'nats-eventsink.txt',
  'nats-seed.txt',
  'nats-body.txt',
];

/** The text of one service block of an overlay file, from its key to the next service or top-level key. */
function serviceBlock(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || /^ {2}\S/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

describe('scratch P0 probe overlay (text)', () => {
  const probe = serviceBlock(OVERLAY_TEXT, 'p0-probe');

  it('defines the p0-probe service under the p0 profile, restart no, labelled as scratch', () => {
    expect(probe).not.toBe('');
    expect(probe).toContain('profiles: ["p0"]');
    expect(probe).toContain('restart: "no"');
    expect(probe).toContain('geldar.scratch: "true"');
  });

  it('runs the golem probe from the body image, as the account uid:gid, with the scratch image name', () => {
    expect(probe).toContain('image: ${GELDAR_P0_IMAGE:?set by deploy/scratch/scratch.sh}');
    expect(probe).toContain('build:');
    expect(probe).toContain('dockerfile: golem/Dockerfile');
    expect(probe).toContain('entrypoint: ["node", "src/p0/probe.ts"]');
    expect(probe).toContain(
      'user: "${SCRATCH_RUN_UID:?set by deploy/scratch/scratch.sh}:${SCRATCH_RUN_GID:?set by deploy/scratch/scratch.sh}"',
    );
  });

  it('carries the isolation variable GELDAR_P0_PROJECT, set from the compose project name', () => {
    expect(probe).toContain('GELDAR_P0_PROJECT: ${COMPOSE_PROJECT_NAME:?');
  });

  it('publishes no port and waits for nats, velocity and paper to be healthy', () => {
    expect(probe).not.toMatch(/^\s+ports:/m);
    for (const svc of ['nats', 'velocity', 'paper'])
      expect(probe).toMatch(new RegExp(`${svc}:\\s*\\n\\s*condition: service_healthy`));
  });

  it('mounts only the body NATS password and the scratch rcon secret', () => {
    expect(probe).toContain('secrets: [nats-body.txt, rcon]');
    expect(probe).not.toMatch(/nats-(mind|mcp|seed|paper|velocity|eventsink)/);
  });

  it('declares nats-body.txt as a top-level secret read from the NATS auth dir', () => {
    expect(OVERLAY_TEXT).toMatch(
      /\n {2}nats-body\.txt:\n {4}file: \$\{SCRATCH_NATS_AUTH_DIR:\?set by deploy\/scratch\/scratch\.sh\}\/nats-body\.txt/,
    );
  });

  it('scratch.sh names the probe overlay and the body file only in the probe path', () => {
    expect(SCRATCH_SH).toContain('compose/opt-in/scratch-probe.yml');
    expect(SCRATCH_SH).toContain('nats-body.txt');
    expect(SCRATCH_SH).toMatch(/PROBE_NATS_FILES="\$NATS_FILES nats-body\.txt"/);
    expect(SCRATCH_SH).toMatch(
      /NATS_FILES="nats-auth\.conf nats-paper\.txt nats-velocity\.txt nats-eventsink\.txt nats-seed\.txt"/,
    );
  });
});

const COMPOSE = spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' });
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A dir with the six NATS files (non-empty) and the secrets dir, for the render. */
function dummyDirs(): { auth: string; secrets: string } {
  const auth = mkdtempSync(join(tmpdir(), 'probe-render-auth-'));
  const secrets = mkdtempSync(join(tmpdir(), 'probe-render-secrets-'));
  made.push(auth, secrets);
  for (const f of NATS_FILES) writeFileSync(join(auth, f), 'x');
  for (const f of ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt'])
    writeFileSync(join(secrets, f), 'x');
  return { auth: slash(auth), secrets: slash(secrets) };
}

/** The NATS override the probe verb writes: the six files (five for up), each pointed at the auth dir. */
function overrideText(dir: string, files: string[]): string {
  const lines = ['secrets:'];
  for (const f of files) lines.push(`  ${f}:`, `    file: "${dir}/${f}"`);
  return `${lines.join('\n')}\n`;
}

describe.skipIf(COMPOSE.status !== 0)('scratch P0 probe overlay: docker compose config', () => {
  const { auth, secrets } = dummyDirs();
  const override = join(secrets, 'nats-override.yml');
  writeFileSync(override, overrideText(auth, NATS_FILES));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMPOSE_PROJECT_NAME: 'scratch-nf',
    SCRATCH_SECRETS_DIR: secrets,
    SCRATCH_NATS_AUTH_DIR: auth,
    GELDAR_WORLD_VOLUME: 'scratch-nf_paper-data',
    GELDAR_P0_IMAGE: 'geldar-body:scratch-nf',
    SCRATCH_RUN_UID: '1000',
    SCRATCH_RUN_GID: '1000',
  };
  const compose = (files: string[], profile: boolean) =>
    spawnSync(
      'docker',
      [
        'compose',
        '-p',
        'scratch-nf',
        ...(profile ? ['--profile', 'p0'] : []),
        ...files.flatMap((f) => ['-f', f]),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env },
    );
  const at = (rel: string) => slash(fileURLToPath(new URL(rel, ROOT)));
  const base = [
    at('compose/phase0.yml'),
    at('compose/nats-auth.yml'),
    at('compose/opt-in/scratch.yml'),
  ];
  const probeFiles = [...base, at('compose/opt-in/scratch-probe.yml'), override];
  type Svc = Record<string, unknown> & {
    profiles?: string[];
    user?: string;
    ports?: unknown[];
    restart?: string;
    secrets?: { source: string }[];
    depends_on?: Record<string, { condition: string }>;
    environment?: Record<string, string>;
    entrypoint?: string[];
    working_dir?: string;
    image?: string;
  };

  it('renders p0-probe with the profile, the user, no ports, the two secrets, healthy dependencies and restart no', () => {
    const run = compose(probeFiles, true);
    expect(run.status, run.stderr).toBe(0);
    const svc = (JSON.parse(run.stdout) as { services: Record<string, Svc> }).services['p0-probe'];
    expect(svc).toBeDefined();
    expect(svc?.profiles).toEqual(['p0']);
    expect(svc?.user).toBe('1000:1000');
    expect(svc?.ports).toBeUndefined();
    expect(svc?.restart).toBe('no');
    expect(svc?.secrets?.map((s) => s.source).sort()).toEqual(['nats-body.txt', 'rcon']);
    expect(Object.keys(svc?.depends_on ?? {}).sort()).toEqual(['nats', 'paper', 'velocity']);
    for (const dep of ['nats', 'paper', 'velocity'])
      expect(svc?.depends_on?.[dep]?.condition).toBe('service_healthy');
    expect(svc?.image).toBe('geldar-body:scratch-nf');
    expect(svc?.entrypoint).toEqual(['node', 'src/p0/probe.ts']);
    expect(svc?.working_dir).toBe('/opt/geldar/golem');
  });

  it('carries the env block, with GELDAR_P0_PROJECT set to the scratch project', () => {
    const run = compose(probeFiles, true);
    expect(run.status, run.stderr).toBe(0);
    const svc = (JSON.parse(run.stdout) as { services: Record<string, Svc> }).services['p0-probe'];
    expect(svc?.environment).toEqual({
      GELDAR_P0_PROJECT: 'scratch-nf',
      GELDAR_IN_NETWORK_HOSTS: '1',
      GELDAR_MC_HOST: 'velocity',
      GELDAR_MC_PORT: '25565',
      GELDAR_NATS_URL: 'nats://nats:4222',
      GELDAR_NATS_USER: 'body',
      GELDAR_NATS_PASSWORD_FILE: '/run/secrets/nats-body.txt',
      GELDAR_RCON_HOST: 'paper',
      GELDAR_RCON_PORT: '25575',
      GELDAR_RCON_PASSWORD_FILE: '/run/secrets/rcon',
    });
  });

  it('keeps p0-probe out of the plain up render, even with the p0 profile on', () => {
    const plain = [...base, override];
    expect(compose(plain, false).stdout).not.toContain('p0-probe');
    expect(compose(plain, true).stdout).not.toContain('p0-probe');
  });
});
