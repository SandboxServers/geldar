/**
 * The opt-in probe overlay of the live NeoForge project (compose/nf-live-probe.yml, profile probe, added on top of
 * compose/nf-live.yml only by `deploy/nf-deploy.sh probe`). The renders use dummy inputs and fixture paths; nothing here
 * starts a container.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE = 'compose/nf-live.yml';
const PROBE = 'compose/nf-live-probe.yml';
const DUMMY_SHA = 'a'.repeat(64);
// The ten secret files of the set: the nine of compose/nf-live.yml and nats-body.txt, which only the probe overlay declares.
const SECRET_NAMES = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-auth.conf',
  'nats-sink.txt',
  'nats-neoforge.txt',
  'nats-velocity.txt',
  'nats-deploy.txt',
  'nats-seed.txt',
  'nats-body.txt',
];
const BASE_SERVICES = ['eventsink', 'identity-seed', 'nats', 'neoforge', 'postgres', 'velocity'];
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
if (!DOCKER && process.env.CI)
  throw new Error(
    'docker compose is not on PATH and CI is set: the nf-live probe render tests must run',
  );

interface Svc {
  image?: string;
  profiles?: string[];
  restart?: string;
  ports?: unknown[];
  networks?: Record<string, unknown>;
  secrets?: { source: string }[];
  environment?: Record<string, string | null>;
  user?: string;
  volumes?: unknown[];
  pids_limit?: unknown;
  memswap_limit?: unknown;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  stop_grace_period?: string;
  deploy?: { resources?: { limits?: Record<string, unknown> } };
}
interface Rendered {
  services: Record<string, Svc>;
}

function render(
  files: string[],
  env: Record<string, string>,
): { status: number | null; stdout: string } {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(merged))
    if (key.startsWith('NF_') || key === 'COMPOSE_PROFILES') delete merged[key];
  Object.assign(merged, env);
  const fileArgs = files.flatMap((f) => ['-f', f]);
  const run = spawnSync(
    'docker',
    ['compose', '-p', 'geldar-nf', ...fileArgs, 'config', '--format', 'json'],
    { cwd: ROOT, encoding: 'utf8', env: merged },
  );
  return { status: run.status, stdout: run.stdout };
}

let base: Rendered;
let probed: Rendered;
let common: Record<string, string>;
let tmp: string;

beforeAll(() => {
  if (!DOCKER) return;
  tmp = mkdtempSync(join(tmpdir(), 'nf-live-probe-'));
  const secrets = join(tmp, 'secrets');
  mkdirSync(secrets);
  for (const name of SECRET_NAMES) writeFileSync(join(secrets, name), 'DUMMY-NF-SECRET\n');
  const jar = join(tmp, 'geldar-neoforge.jar');
  writeFileSync(jar, 'dummy jar, not a real mod');
  common = { NF_SECRETS_DIR: secrets, NF_MOD_JAR_HOST: jar, NF_MOD_SHA256: DUMMY_SHA };
  const baseRun = render([BASE], common);
  if (baseRun.status !== 0) throw new Error('compose config of the base file failed');
  base = JSON.parse(baseRun.stdout) as Rendered;
  // The probe profile is active only for this render; the base render above never has it.
  const probeRun = render([BASE, PROBE], { ...common, COMPOSE_PROFILES: 'probe' });
  if (probeRun.status !== 0)
    throw new Error('compose config of base plus the probe overlay failed');
  probed = JSON.parse(probeRun.stdout) as Rendered;
}, 30_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('nf-live probe overlay: the file (no docker needed)', () => {
  it('publishes no port, and declares the probe profile and no restart', () => {
    const text = readFileSync(join(ROOT, PROBE), 'utf8');
    const doc = parse(text) as { services: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.services)).toEqual(['probe']);
    expect(doc.services.probe?.ports).toBeUndefined();
    expect(text).not.toMatch(/^\s*ports:/m);
    expect(doc.services.probe?.profiles).toEqual(['probe']);
    expect(doc.services.probe?.restart).toBe('no');
  });
});

describe.skipIf(!DOCKER)('nf-live probe overlay: the render', () => {
  it('the base file alone has no probe service and no nats-body secret', () => {
    expect(Object.keys(base.services).sort()).toEqual(BASE_SERVICES);
    for (const svc of Object.values(base.services))
      expect((svc.secrets ?? []).map((s) => s.source)).not.toContain('nats-body.txt');
  });

  it('with the overlay the render adds only the probe service, and the base services are unchanged', () => {
    expect(Object.keys(probed.services).sort()).toEqual([...BASE_SERVICES, 'probe'].sort());
    const { probe: _probe, ...rest } = probed.services;
    expect(rest).toEqual(base.services);
  });

  it('only the probe mounts the nats-body secret', () => {
    const holders = Object.entries(probed.services)
      .filter(([, svc]) => (svc.secrets ?? []).some((s) => s.source === 'nats-body.txt'))
      .map(([name]) => name);
    expect(holders).toEqual(['probe']);
  });

  it('puts the probe on the project network only, with no ports, restart no and the probe profile', () => {
    const probe = probed.services.probe;
    expect(probe).toBeDefined();
    expect(Object.keys(probe?.networks ?? {})).toEqual(['nf']);
    expect(Object.keys(probe?.networks ?? {})).not.toContain('telemetry');
    expect(probe?.ports ?? []).toEqual([]);
    expect(probe?.restart).toBe('no');
    expect(probe?.profiles).toEqual(['probe']);
    expect(probe?.image).toBe('geldar-body:geldar-nf');
  });

  it('runs as the body NATS user against the project hosts, with the RCON host neoforge', () => {
    const env = probed.services.probe?.environment ?? {};
    expect(env.GELDAR_NATS_USER).toBe('body');
    expect(env.GELDAR_NATS_URL).toBe('nats://nats:4222');
    expect(env.GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-body.txt');
    expect(env.GELDAR_RCON_HOST).toBe('neoforge');
    expect(env.GELDAR_P0_PROJECT).toBe('geldar-nf');
  });

  it('renders alone with the probe profile active (CI and geldar.ps1 check render each file alone)', () => {
    const alone = render([PROBE], { ...common, COMPOSE_PROFILES: 'probe' });
    expect(alone.status).toBe(0);
    const doc = JSON.parse(alone.stdout) as Rendered;
    expect(Object.keys(doc.services)).toEqual(['probe']);
    expect(Object.keys(doc.services.probe?.networks ?? {})).toEqual(['nf']);
    expect((doc.services.probe?.secrets ?? []).map((s) => s.source)).toEqual([
      'nats-body.txt',
      'rcon',
    ]);
  }, 30_000);

  it('the probe runs as the service user, with no volumes and the project memswap and pids caps', () => {
    const probe = probed.services.probe;
    expect(probe?.user).toBe('1000:1000');
    expect(probe?.volumes ?? []).toEqual([]);
    expect(probe?.pids_limit).toBe(256);
    expect(probe?.memswap_limit).toBeDefined();
    const limits = probe?.deploy?.resources?.limits;
    expect(Number(limits?.memory)).toBe(1024 ** 3);
    expect(Number(limits?.cpus)).toBe(1);
    expect(limits?.pids).toBe(256);
  });

  it('the probe mounts exactly the nats-body and rcon secrets', () => {
    const names = (probed.services.probe?.secrets ?? []).map((s) => s.source).sort();
    expect(names).toEqual(['nats-body.txt', 'rcon']);
  });

  it('the probe is hardened: read-only root, no capabilities, no new privileges, a 60 s stop grace period', () => {
    const probe = probed.services.probe;
    expect(probe?.read_only).toBe(true);
    expect(probe?.cap_drop).toEqual(['ALL']);
    expect(probe?.security_opt).toEqual(['no-new-privileges:true']);
    // compose normalises the duration in its rendered output: 60s is '1m0s'
    expect(probe?.stop_grace_period).toBe('1m0s');
  });

  it('the probe environment has no plain password, and no RCON_PASSWORD', () => {
    const env = probed.services.probe?.environment ?? {};
    const plain = Object.keys(env).filter((k) => /PASSWORD/.test(k) && !k.endsWith('_FILE'));
    expect(plain).toEqual([]);
    expect(env.RCON_PASSWORD).toBeUndefined();
    expect(env.GELDAR_RCON_PASSWORD).toBeUndefined();
  });
});
