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
import { DOCKER_COMPOSE_PROBE, toolAvailable } from '../../../deploy/test/tool-probe.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NF_PATH = 'compose/nf-live.yml';
const NF_TEXT = readFileSync(`${ROOT}${NF_PATH}`, 'utf8');
/** The render tests skip, with a message naming docker compose, when it is missing; in CI a missing docker fails the run. */
const DOCKER = toolAvailable(DOCKER_COMPOSE_PROBE);

const DUMMY_MARKER = 'DUMMY-NF-SECRET-MARKER-7f3a9c';
const DUMMY_SHA256 = 'a'.repeat(64);
const SECRET_FILES = [
  'postgres.txt',
  'rcon.txt',
  'velocity-forwarding.txt',
  'nats-auth.conf',
  'nats-sink.txt',
  'nats-neoforge.txt',
  'nats-velocity.txt',
  'nats-deploy.txt',
  'nats-seed.txt',
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
  volumes?: { type?: string; source?: string; target?: string; read_only?: boolean }[];
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
}, 30_000);

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

describe.skipIf(!DOCKER)('nf-livecompose: project and services', () => {
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

describe.skipIf(!DOCKER)('nf-livecompose: ports', () => {
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

describe.skipIf(!DOCKER)('nf-livecompose: isolation', () => {
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

describe.skipIf(!DOCKER)('nf-livecompose: secrets', () => {
  it('holds no secret value: the dummy secret text is not in the render', () => {
    expect(renderedText).not.toContain(DUMMY_MARKER);
    expect(NF_TEXT).not.toMatch(/(PASSWORD|SECRET|TOKEN)[A-Z_]*:[ \t]*["']?[A-Za-z0-9]/i);
  });

  it('reads its secrets from files under the per-project directory', () => {
    expect(NF_TEXT).toMatch(/file: \$\{NF_SECRETS_DIR:-\.\/secrets-nf\}\/postgres\.txt/);
  });
});

/** The bot-ingress Velocity config the velocity service mounts. Read lazily, so the other tests load without it. */
const VELOCITY_PATH = 'compose/velocity/velocity-nf.toml';
const velocityText = (): string => readFileSync(`${ROOT}${VELOCITY_PATH}`, 'utf8');

describe.skipIf(!DOCKER)('nf-livecompose: service uid and gid', () => {
  // The services run as NF_SERVICE_UID:NF_SERVICE_GID, and the gid defaults to the uid. Rendered only; no container starts.
  const withIds = (env: Record<string, string>) => {
    const dirs = {
      NF_SECRETS_DIR: join(tmp, 'secrets'),
      NF_MOD_JAR_HOST: join(tmp, 'geldar-neoforge.jar'),
    };
    const run = renderNf({ ...dirs, NF_MOD_SHA256: DUMMY_SHA256, ...env });
    return JSON.parse(run.stdout) as {
      services: Record<string, { user?: string; environment?: Record<string, string> }>;
    };
  };

  it.skipIf(!DOCKER)(
    'takes the uid and the gid from NF_SERVICE_UID and NF_SERVICE_GID (1001 and 1002)',
    () => {
      const r = withIds({ NF_SERVICE_UID: '1001', NF_SERVICE_GID: '1002' });
      expect(r.services.eventsink?.user).toBe('1001:1002');
      expect(r.services['identity-seed']?.user).toBe('1001:1002');
      for (const svc of ['neoforge', 'velocity']) {
        expect(r.services[svc]?.environment?.UID, svc).toBe('1001');
        expect(r.services[svc]?.environment?.GID, svc).toBe('1002');
      }
    },
    60_000,
  );

  it.skipIf(!DOCKER)(
    'defaults the gid to the uid when NF_SERVICE_GID is unset',
    () => {
      const r = withIds({ NF_SERVICE_UID: '1001' });
      expect(r.services.eventsink?.user).toBe('1001:1001');
      expect(r.services['identity-seed']?.user).toBe('1001:1001');
      expect(r.services.neoforge?.environment?.GID).toBe('1001');
      expect(r.services.velocity?.environment?.GID).toBe('1001');
    },
    60_000,
  );
});

/** The services that list a named secret in their `secrets:`, sorted. A short entry is a string; a long one is an object. */
const servicesMounting = (secret: string): string[] =>
  services()
    .filter(([, svc]) => {
      const refs = (svc as { secrets?: (string | { source?: string })[] }).secrets ?? [];
      return refs.some((ref) => (typeof ref === 'string' ? ref : ref.source) === secret);
    })
    .map(([name]) => name)
    .sort();

describe.skipIf(!DOCKER)('nf-livecompose: secret mounts', () => {
  it('mounts velocity-forwarding into exactly velocity and neoforge (both sides of the shared secret)', () => {
    expect(servicesMounting('velocity-forwarding')).toEqual(['neoforge', 'velocity']);
  });

  it('mounts the Postgres password into exactly postgres and eventsink', () => {
    expect(servicesMounting('postgres')).toEqual(['eventsink', 'postgres']);
  });

  it('mounts rcon.txt into exactly neoforge (the RCON password file of the itzg image)', () => {
    expect(servicesMounting('rcon')).toEqual(['neoforge']);
  });
});

describe.skipIf(!DOCKER)('nf-livecompose: RCON', () => {
  it('enables RCON on neoforge from the rcon secret file, and publishes no port', () => {
    const neo = services().find(([name]) => name === 'neoforge')?.[1] as
      | { environment?: Record<string, string>; ports?: unknown[] }
      | undefined;
    expect(neo?.environment?.ENABLE_RCON).toBe('TRUE');
    expect(neo?.environment?.RCON_PASSWORD_FILE).toBe('/run/secrets/rcon');
    expect(neo?.ports ?? [], 'RCON (25575) is reachable on the project network only').toEqual([]);
  });
});

/** The `key = value` lines of one TOML table (comments and blank lines dropped), trimmed. */
function tomlTable(text: string, name: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf(`[${name}]`);
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('[')) break;
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) body.push(trimmed);
  }
  return body;
}

/** The unquoted value of a top-level `key = value` line, or undefined. */
function tomlValue(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, 'm'));
  return m?.[1]?.replace(/^"(.*)"$/, '$1');
}

describe.skipIf(!DOCKER)('nf-livevelocity config: bot ingress', () => {
  it('exists at the path the velocity service mounts', () => {
    expect(velocityText().length).toBeGreaterThan(0);
  });

  it('is mounted read-only over the velocity config path', () => {
    const mount = rendered.services.velocity?.volumes?.find(
      (v) => v.target === '/config/velocity.toml',
    );
    expect(mount?.read_only).toBe(true);
    expect(mount?.source).toMatch(/velocity-nf\.toml$/);
  });

  it('binds 0.0.0.0:25565 inside the container', () => {
    expect(tomlValue(velocityText(), 'bind')).toBe('0.0.0.0:25565');
  });

  it('runs offline: online-mode is false and never true', () => {
    const text = velocityText();
    expect(tomlValue(text, 'online-mode')).toBe('false');
    expect(text).not.toMatch(/^online-mode\s*=\s*true/m);
  });

  it('forwards with modern forwarding and the secret from its file', () => {
    const text = velocityText();
    expect(tomlValue(text, 'player-info-forwarding-mode')).toBe('modern');
    expect(tomlValue(text, 'forwarding-secret-file')).toBe('/run/secrets/velocity-forwarding');
    expect(text).not.toMatch(/^forwarding-secret\s*=/m);
  });

  it('has one backend, neoforge at neoforge:25565, and tries it first', () => {
    expect(tomlTable(velocityText(), 'servers')).toEqual([
      'neoforge = "neoforge:25565"',
      'try = ["neoforge"]',
    ]);
  });

  it('points the backend at the neoforge service name in nf-live.yml, on port 25565', () => {
    const backend = tomlValue(velocityText(), 'neoforge') ?? '';
    const [host, port] = backend.split(':');
    expect(host).toBe('neoforge');
    expect(port).toBe('25565');
    expect(Object.keys(rendered.services)).toContain(host);
  });

  it('has empty forced-hosts', () => {
    expect(tomlTable(velocityText(), 'forced-hosts')).toEqual([]);
  });

  it('names no colo or paper backend', () => {
    expect(velocityText()).not.toMatch(/colo|paper/i);
  });

  it('holds no secret value: no inline secret and no long token-like run', () => {
    const text = velocityText();
    expect(text).not.toMatch(/secret\s*=/i);
    expect(text).not.toMatch(/[A-Za-z0-9+]{32,}/);
  });

  it('keeps the safe defaults: ping passthrough off, login rate limit off, neutral motd', () => {
    const text = velocityText();
    expect(tomlValue(text, 'ping-passthrough')).toBe('DISABLED');
    expect(tomlValue(text, 'login-ratelimit')).toBe('0');
    expect(tomlValue(text, 'motd')).toBe('Geldar');
    expect(text).not.toMatch(/agent|watch/i);
  });
});
