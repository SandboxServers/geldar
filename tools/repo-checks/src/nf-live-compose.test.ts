/**
 * The live NeoForge shard's compose project (compose/nf-live.yml): its services, caps, loopback-only ports, no shared
 * port with the autonomous shard, the scratch stacks or telemetry, no external network or volume, and no secret value.
 * The file is rendered with `docker compose config --format json`, once with dummy secret files and a dummy mod jar in a
 * temp dir, and once with no environment (ci.yml renders every compose file with none). Nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NF_PATH = 'compose/nf-live.yml';
const NF_TEXT = readFileSync(`${ROOT}${NF_PATH}`, 'utf8');
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

/** Skips the render tests when docker compose is missing; in CI a missing docker fails the run instead. */
if (!DOCKER && process.env.CI)
  throw new Error('docker compose is not on PATH and CI is set: the nf-live render tests must run');

const DUMMY_MARKER = 'DUMMY-NF-SECRET-MARKER-7f3a9c';
const DUMMY_SHA256 = 'a'.repeat(64);
const SECRET_FILES = [
  'postgres.txt',
  'velocity-forwarding.txt',
  'nats-auth.conf',
  'nats-sink.txt',
  'nats-neoforge.txt',
  'nats-velocity.txt',
  'nats-deploy.txt',
];
/** The service that is a one-shot; every other service must restart unless-stopped. */
const ONE_SHOT = 'identity-seed';

interface Port {
  host_ip?: string;
  published?: string | number;
  target?: number;
}
interface Svc {
  deploy?: { resources?: { limits?: { cpus?: unknown; memory?: unknown; pids?: unknown } } };
  pids_limit?: unknown;
  memswap_limit?: unknown;
  restart?: string;
  labels?: Record<string, string>;
  logging?: { driver?: string; options?: Record<string, string> };
  ports?: Port[];
  volumes?: { type?: string; target?: string; read_only?: boolean }[];
}
interface Rendered {
  name?: string;
  services: Record<string, Svc>;
  networks?: Record<string, { external?: boolean; name?: string }>;
  volumes?: Record<string, { external?: boolean }>;
}

function renderNf(extra: Record<string, string> | null): { status: number | null; stdout: string } {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NF_')) delete env[key];
  Object.assign(env, extra ?? {});
  const run = spawnSync(
    'docker',
    ['compose', '-p', 'geldar-nf', '-f', NF_PATH, 'config', '--format', 'json'],
    { cwd: ROOT, encoding: 'utf8', env },
  );
  return { status: run.status, stdout: run.stdout };
}

let rendered: Rendered;
let renderedText: string;
let bareStatus: number | null;
let tmp: string;

beforeAll(() => {
  if (!DOCKER) return;
  tmp = mkdtempSync(join(tmpdir(), 'nf-live-'));
  const secrets = join(tmp, 'secrets');
  mkdirSync(secrets);
  for (const name of SECRET_FILES) writeFileSync(join(secrets, name), `${DUMMY_MARKER}\n`);
  const jar = join(tmp, 'geldar-neoforge.jar');
  writeFileSync(jar, 'dummy jar, not a real mod');
  const withDummies = renderNf({
    NF_SECRETS_DIR: secrets,
    NF_MOD_JAR_HOST: jar,
    NF_MOD_SHA256: DUMMY_SHA256,
  });
  bareStatus = renderNf(null).status;
  renderedText = withDummies.stdout;
  rendered = JSON.parse(withDummies.stdout) as Rendered;
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** Host ports the other compose files and the scratch and telemetry env blocks already publish or default to. */
function takenHostPorts(): Set<number> {
  const taken = new Set<number>();
  const composeFiles = [
    ...readdirSync(`${ROOT}compose`).map((f) => `compose/${f}`),
    ...readdirSync(`${ROOT}compose/opt-in`).map((f) => `compose/opt-in/${f}`),
  ];
  for (const rel of composeFiles) {
    if (!/\.ya?ml$/.test(rel) || rel === NF_PATH) continue;
    addPorts(taken, readFileSync(`${ROOT}${rel}`, 'utf8'));
  }
  for (const file of readdirSync(`${ROOT}deploy/scratch`)) {
    if (!file.endsWith('.env')) continue;
    for (const m of readFileSync(`${ROOT}deploy/scratch/${file}`, 'utf8').matchAll(
      /^SCRATCH_[A-Z_]*PORT=(\d{1,5})\s*$/gm,
    ))
      taken.add(Number(m[1]));
  }
  return taken;
}

/** Literal `"127.0.0.1:<port>:<container>"` and defaulted `${NAME:-<port>}:<container>` host ports. */
function addPorts(taken: Set<number>, text: string): void {
  for (const m of text.matchAll(/"127\.0\.0\.1:(\d{1,5}):\d{1,5}"/g)) taken.add(Number(m[1]));
  for (const m of text.matchAll(/\$\{[A-Z][A-Z0-9_]*:-(\d{1,5})\}:\d{1,5}/g))
    taken.add(Number(m[1]));
}

const services = () => Object.entries(rendered.services);

describe('nf-live compose: project and services', () => {
  it('renders with dummy secret files and a dummy mod jar', () => {
    expect(rendered.name).toBe('geldar-nf');
  });

  it('renders with no environment set, as ci.yml does', () => {
    expect(bareStatus).toBe(0);
  });

  it('has exactly the six services of the live shard', () => {
    expect(Object.keys(rendered.services).sort()).toEqual(
      ['eventsink', 'identity-seed', 'nats', 'neoforge', 'postgres', 'velocity'].sort(),
    );
  });

  it('names neoforge as the game server, not paper', () => {
    expect(rendered.services.paper).toBeUndefined();
    expect(rendered.services.neoforge).toBeDefined();
  });

  it('gives every service cpus, memory and pids caps', () => {
    for (const [name, svc] of services()) {
      const limits = svc.deploy?.resources?.limits;
      expect(limits?.cpus, `${name} cpus`).toBeDefined();
      expect(limits?.memory, `${name} memory`).toBeDefined();
      expect(limits?.pids ?? svc.pids_limit, `${name} pids`).toBeDefined();
    }
  });

  it('restarts every long-running service unless-stopped and the one-shot never', () => {
    for (const [name, svc] of services()) {
      expect(svc.restart, name).toBe(name === ONE_SHOT ? 'no' : 'unless-stopped');
    }
  });

  it('labels every service geldar.project=geldar-nf and rotates its logs', () => {
    for (const [name, svc] of services()) {
      expect(svc.labels?.['geldar.project'], name).toBe('geldar-nf');
      expect(svc.logging?.driver, name).toBe('json-file');
      expect(svc.logging?.options?.['max-size'], name).toBe('10m');
    }
  });
});

describe('nf-live compose: ports', () => {
  it('publishes only on 127.0.0.1, never on another address', () => {
    for (const [name, svc] of services()) {
      for (const port of svc.ports ?? []) {
        expect(port.host_ip, `${name} port ${port.published}`).toBe('127.0.0.1');
      }
    }
  });

  it('never publishes 25565 or 25566 on the host', () => {
    for (const [, svc] of services()) {
      for (const port of svc.ports ?? []) {
        expect(['25565', '25566']).not.toContain(String(port.published));
      }
    }
  });

  it('shares no host port with the colo, scratch, phase0 or telemetry files', () => {
    const taken = takenHostPorts();
    // Parser sanity: the sources it reads must include a colo port, a scratch default and a telemetry port.
    expect(taken.has(25567)).toBe(true);
    expect(taken.has(15432)).toBe(true);
    expect(taken.has(25432)).toBe(true);
    for (const [name, svc] of services()) {
      for (const port of svc.ports ?? []) {
        expect(taken.has(Number(port.published)), `${name} ${port.published}`).toBe(false);
      }
    }
  });
});

describe('nf-live compose: isolation', () => {
  it('declares no external network or volume', () => {
    expect(NF_TEXT).not.toMatch(/^\s*external\s*:/m);
    for (const net of Object.values(rendered.networks ?? {})) expect(net.external).toBeFalsy();
    for (const vol of Object.values(rendered.volumes ?? {})) expect(vol.external).toBeFalsy();
  });

  it('uses its own project network, named with the project prefix', () => {
    expect(rendered.networks?.nf?.name).toMatch(/^geldar-nf/);
  });

  it('does not reference the colo overlay file or the autonomous project name', () => {
    expect(NF_TEXT).not.toMatch(/colo\.yml|geldar-colo/);
    expect(renderedText).not.toMatch(/geldar-colo|colo\.yml/);
  });

  it('mounts the mod jar read-only', () => {
    const mod = rendered.services.neoforge?.volumes?.find(
      (v) => v.target === '/geldar/mods/geldar-neoforge.jar',
    );
    expect(mod?.read_only).toBe(true);
  });
});

describe('nf-live compose: secrets', () => {
  it('holds no secret value: the dummy secret text is not in the render', () => {
    expect(renderedText).not.toContain(DUMMY_MARKER);
    expect(NF_TEXT).not.toMatch(/(PASSWORD|SECRET|TOKEN)[A-Z_]*:[ \t]*["']?[A-Za-z0-9]/i);
  });

  it('reads its secrets from files under the per-project directory', () => {
    expect(NF_TEXT).toMatch(/file: \$\{NF_SECRETS_DIR:-\.\/secrets-nf\}\/postgres\.txt/);
  });
});
