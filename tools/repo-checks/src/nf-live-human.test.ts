import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The opt-in human lane (compose/nf-live-human.yml, NF_HUMAN=on) rendered from the files, read as YAML with the defaults and
// dummy values only (no docker, no env). The combined set is the base file with each overlay: the human overlay alone, with
// the telemetry overlays, and with the probe overlay. Compose merges these by service name, and the human overlay adds one
// service, so each file's services are checked on their own and together.
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const BASE = 'compose/nf-live.yml';
const HUMAN = 'compose/nf-live-human.yml';
const TOML = 'compose/velocity/velocity-nf-human.toml';
const OVERLAYS = [
  'compose/nf-live-telemetry.yml',
  'compose/nf-live-telemetry-off.yml',
  'compose/nf-live-probe.yml',
];
const DEFAULT_BIND = '127.0.0.1';
const DEFAULT_PORT = '46566';

type Service = {
  ports?: unknown[];
  volumes?: unknown[];
  secrets?: unknown[];
  networks?: unknown;
  cpus?: unknown;
  mem_limit?: unknown;
  memory?: unknown;
  deploy?: { resources?: { limits?: Record<string, unknown> } };
  pids_limit?: unknown;
  read_only?: unknown;
  cap_drop?: unknown;
  security_opt?: unknown;
  stop_grace_period?: unknown;
  memswap_limit?: unknown;
  [key: string]: unknown;
};
type Compose = { services?: Record<string, Service> };

const load = (f: string): Compose => parse(read(f)) as Compose;
const services = (f: string): Record<string, Service> => load(f).services ?? {};

// The human overlay's own publish, with the compose defaults applied (what `docker compose config` would print).
const humanPorts = (): string[] =>
  (services(HUMAN)['velocity-human']?.ports ?? []).map((p) =>
    String(p)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the compose variable syntax, not a template literal
      .replace('${NF_HUMAN_BIND:-127.0.0.1}', DEFAULT_BIND)
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the compose variable syntax, not a template literal
      .replace('${NF_HUMAN_PORT:-46566}', DEFAULT_PORT),
  );

// Every published entry of a compose file as a string. Short and long syntax both reduce to the host side and the target.
function publishedOf(f: string): { service: string; entry: string }[] {
  const out: { service: string; entry: string }[] = [];
  for (const [service, svc] of Object.entries(services(f))) {
    for (const p of svc.ports ?? []) out.push({ service, entry: String(p) });
  }
  return out;
}

// The loopback-capable publish is one that starts with 127.0.0.1: the rule every service but the human lane follows.
const isLoopback = (entry: string) => entry.startsWith('127.0.0.1:');

// The host port of a short-syntax publish with the defaults applied (ip:host:container).
const hostPortOf = (entry: string) =>
  entry
    .replace(/\$\{NF_HUMAN_BIND:-[^}]*\}/, DEFAULT_BIND)
    .replace(/\$\{NF_HUMAN_PORT:-([^}]*)\}/, '$1')
    .split(':')[1];

describe('the human lane overlay (compose/nf-live-human.yml) with the live base', () => {
  it('adds velocity-human and its one-shot velocity-human-init, and only re-declares nats and neoforge (for their nf-human network), no other service', () => {
    expect(Object.keys(services(HUMAN)).sort()).toEqual([
      'nats',
      'neoforge',
      'velocity-human',
      'velocity-human-init',
    ]);
  });

  it('publishes exactly one entry, the human mapping on 127.0.0.1:46566 by default', () => {
    expect(humanPorts()).toEqual([`${DEFAULT_BIND}:${DEFAULT_PORT}:25565`]);
  });

  it('is the one non-loopback-capable publish across base, human and every overlay', () => {
    const all = [BASE, HUMAN, ...OVERLAYS].flatMap((f) =>
      publishedOf(f).map((p) => ({ ...p, file: f })),
    );
    const nonLoopback = all.filter((p) => !isLoopback(p.entry));
    expect(nonLoopback.map((p) => p.service)).toEqual(['velocity-human']);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the compose variable syntax, not a template literal
    expect(nonLoopback[0]?.entry).toBe('${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565');
  });

  it('keeps the live velocity on 127.0.0.1:46565 only, and the other base services publish nothing', () => {
    const base = publishedOf(BASE);
    expect(base.filter((p) => p.service === 'velocity').map((p) => p.entry)).toEqual([
      '127.0.0.1:46565:25565',
    ]);
    for (const service of ['neoforge', 'nats', 'postgres', 'eventsink', 'identity-seed']) {
      expect(base.filter((p) => p.service === service)).toEqual([]);
    }
    expect(publishedOf(HUMAN).map((p) => p.service)).toEqual(['velocity-human']);
  });

  it('has its published host port differ from every other published port in compose/*.yml', () => {
    const dir = resolve(ROOT, 'compose');
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    const others = files
      .filter((f) => `compose/${f}` !== HUMAN)
      .flatMap((f) => publishedOf(`compose/${f}`))
      .map((p) => hostPortOf(p.entry));
    expect(others).not.toContain(DEFAULT_PORT);
    expect(others).toContain('46565');
  });

  it('sets the resource limits, the hardening and the stop grace on velocity-human', () => {
    const svc = services(HUMAN)['velocity-human'] ?? {};
    expect(svc.cpus ?? svc.deploy?.resources?.limits?.cpus).toBeDefined();
    expect(svc.mem_limit ?? svc.deploy?.resources?.limits?.memory).toBeDefined();
    expect(svc.deploy?.resources?.limits?.pids).toBe(256);
    expect(svc).not.toHaveProperty('pids_limit');
    expect(svc.read_only).toBe(true);
    expect(svc.cap_drop).toEqual(['ALL']);
    expect(svc.security_opt).toEqual(['no-new-privileges:true']);
    expect(svc.stop_grace_period).toBeDefined();
  });

  it('mounts only the toml, the data volume and the identity jar, and reads only the human NATS password and the forwarding secret', () => {
    const svc = services(HUMAN)['velocity-human'] ?? {};
    expect(svc.secrets).toEqual(['velocity-forwarding', 'nats-human.txt']);
    expect(svc.secrets).not.toContain('nats-velocity.txt');
    expect(svc.environment).toMatchObject({
      GELDAR_NATS_USER: 'human',
      GELDAR_NATS_PASSWORD_FILE: '/run/secrets/nats-human.txt',
    });
    const sources = (svc.volumes ?? []).map((v) =>
      typeof v === 'string' ? v.split(':')[0] : (v as { source: string }).source,
    );
    expect(sources).toEqual([
      './velocity/velocity-nf-human.toml',
      'velocity-human-data',
      '../plugin/velocity-identity/build/libs/geldar-velocity-identity.jar',
    ]);
    const secretFiles = Object.values(load(BASE).services ?? {}).flatMap(
      (s) => (s as Service).secrets ?? [],
    );
    expect(secretFiles).toContain('nats-velocity.txt');
    for (const name of [
      'rcon',
      'postgres',
      'nats-neoforge',
      'nats-sink',
      'nats-deploy',
      'nats-seed',
      'nats-body',
    ]) {
      expect(svc.secrets ?? []).not.toContain(name);
      expect(svc.secrets ?? []).not.toContain(`${name}.txt`);
    }
  });

  it('is on the nf-human network only (not nf), and depends on neoforge and nats', () => {
    const svc = services(HUMAN)['velocity-human'] ?? {};
    expect(svc.networks).toEqual(['nf-human']);
    expect(Object.keys(svc.depends_on as Record<string, unknown>).sort()).toEqual(
      ['identity-seed', 'nats', 'neoforge', 'velocity-human-init'].sort(),
    );
  });

  it('puts nats and neoforge on nf-human as well as nf, and puts no other overlay service on nf-human', () => {
    const over = services(HUMAN);
    expect(over.nats?.networks).toEqual(['nf', 'nf-human']);
    expect(over.neoforge?.networks).toEqual(['nf', 'nf-human']);
    const onHuman = Object.keys(over).filter((name) =>
      ((over[name]?.networks as string[] | undefined) ?? []).includes('nf-human'),
    );
    expect(onHuman.sort()).toEqual(['nats', 'neoforge', 'velocity-human']);
    const human = load(HUMAN) as { networks?: Record<string, unknown> };
    expect(Object.keys(human.networks ?? {})).toEqual(['nf-human']);
  });

  it('declares only its own network, its own NATS secret and the data volume on top of the base file', () => {
    const human = load(HUMAN) as Record<string, unknown>;
    expect(Object.keys(human).sort()).toEqual(
      ['name', 'networks', 'secrets', 'services', 'volumes', 'x-logging'].sort(),
    );
    expect(Object.keys(human.secrets as Record<string, unknown>)).toEqual(['nats-human.txt']);
  });
});

describe('the human lane toml (compose/velocity/velocity-nf-human.toml)', () => {
  const toml = read(TOML);

  it('is online-mode, with ping passthrough disabled', () => {
    expect(toml).toMatch(/^online-mode = true$/m);
    expect(toml).toMatch(/^ping-passthrough = "DISABLED"$/m);
    // haproxy-protocol true would let any client spoof its source address; [query] is off (no UDP is published).
    expect(toml).toMatch(/^haproxy-protocol = false$/m);
    expect(toml).not.toMatch(/^haproxy-protocol\s*=\s*true/m);
    expect(toml).toMatch(/^\[query\]\nenabled = false$/m);
    expect(toml).not.toMatch(/^\[query\][\s\S]*?^enabled\s*=\s*true/m);
  });

  it('names no 0.0.0.0 address other than the container bind, and no secret value', () => {
    const lines = toml.split('\n').filter((l) => l.includes('0.0.0.0'));
    expect(lines).toEqual(['bind = "0.0.0.0:25565"']);
    expect(toml).toMatch(/^forwarding-secret-file = "\/run\/secrets\/velocity-forwarding"$/m);
  });
});

// The security settings the human lane depends on. Each is a mutation the suite must catch: forwarding mode, the one-backend
// route, the NATS URL (without it the plugin admits without a registry), the lane marker, the healthcheck, tmpfs, user, restart
// and the jar's create_host_path.
describe('the human lane security settings (pinned)', () => {
  const sectionLines = (name: string): string[] => {
    const after = read(TOML).split(`\n[${name}]\n`)[1] ?? '';
    const body = after.split('\n[')[0] ?? '';
    return body.split('\n').filter((l) => /^[^#\s].* = /.test(l));
  };

  it('forwards with modern forwarding, and the toml routes only to neoforge', () => {
    expect(read(TOML)).toMatch(/^player-info-forwarding-mode = "modern"$/m);
    expect(sectionLines('servers')).toEqual(['neoforge = "neoforge:25565"', 'try = ["neoforge"]']);
    expect(sectionLines('forced-hosts')).toEqual(['"geldar-human.invalid" = ["neoforge"]']);
  });

  it('sets the NATS URL, the human lane marker and the healthcheck on velocity-human', () => {
    const svc = services(HUMAN)['velocity-human'] as Record<string, unknown>;
    const env = svc.environment as Record<string, string>;
    expect(env.GELDAR_NATS_URL).toBe('nats://nats:4222');
    expect(env.GELDAR_IDENTITY_LANE).toBe('human');
    expect(JSON.stringify(svc.healthcheck)).toContain('geldar-identity.ready');
  });

  it('pins the velocity-human healthcheck timings: a missing ready marker fails up --wait within 40 s', () => {
    const hc = (services(HUMAN)['velocity-human'] as Record<string, unknown>).healthcheck as Record<
      string,
      unknown
    >;
    expect(hc.start_period).toBe('20s');
    expect(hc.interval).toBe('5s');
    expect(hc.timeout).toBe('3s');
    expect(hc.retries).toBe(3);
    expect(20 + 3 * 5).toBeLessThan(40);
    expect(JSON.stringify(hc.test)).toContain('/tmp/geldar-identity.ready');
  });

  it('keeps tmpfs /tmp, the service user, restart unless-stopped and the jar with create_host_path false', () => {
    const svc = services(HUMAN)['velocity-human'] as Record<string, unknown>;
    expect(svc.tmpfs).toEqual(['/tmp']);
    expect(svc.user).toBeDefined();
    expect(svc.restart).toBe('unless-stopped');
    const jar = (svc.volumes as Record<string, unknown>[]).find(
      (v) => typeof v === 'object' && v.target === '/plugins/geldar-velocity-identity.jar',
    );
    expect(jar?.read_only).toBe(true);
    expect((jar?.bind as Record<string, unknown>)?.create_host_path).toBe(false);
  });
});

// The one-shot that chowns the human proxy's fresh volume (velocity-human-init). It is root for one chown and nothing else:
// no network, no secret, no port, one mount, CHOWN as its only capability. velocity-human stays non-root and read-only.
describe('the velocity-human-init one-shot (volume chown)', () => {
  const INIT = 'velocity-human-init';
  const init = (): Record<string, unknown> => services(HUMAN)[INIT] as Record<string, unknown>;
  const human = (): Record<string, unknown> =>
    services(HUMAN)['velocity-human'] as Record<string, unknown>;
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the compose variable syntax, not a template literal
  const UID_GID = '${NF_SERVICE_UID:-1000}:${NF_SERVICE_GID:-${NF_SERVICE_UID:-1000}}';

  it('exists, with the same image string (same digest) as velocity-human', () => {
    expect(services(HUMAN)[INIT]).toBeDefined();
    expect(init().image).toBe(human().image);
    expect(String(init().image)).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('runs as root once (user 0:0), restart no, read_only, and no-new-privileges', () => {
    expect(init().user).toBe('0:0');
    expect(init().restart).toBe('no');
    expect(init().read_only).toBe(true);
    expect(init().security_opt).toEqual(['no-new-privileges:true']);
  });

  it('keeps only CHOWN: cap_add exactly [CHOWN], cap_drop [ALL]', () => {
    expect(init().cap_add).toEqual(['CHOWN']);
    expect(init().cap_drop).toEqual(['ALL']);
  });

  it('has no network at all: network_mode none and no networks key', () => {
    expect(init().network_mode).toBe('none');
    expect(init()).not.toHaveProperty('networks');
  });

  it('mounts exactly velocity-human-data at /server, no secret, no port, no other volume', () => {
    expect(init().volumes).toEqual(['velocity-human-data:/server']);
    expect(init()).not.toHaveProperty('secrets');
    expect(init()).not.toHaveProperty('ports');
    expect(init()).not.toHaveProperty('tmpfs');
  });

  it('chowns /server to the same uid:gid expression velocity-human runs as, argv form with no shell', () => {
    expect(human().user).toBe(UID_GID);
    expect(init().entrypoint).toEqual(['/usr/bin/chown', UID_GID, '/server']);
  });

  it('has exactly the allowlisted keys: any other key (privileged, pid, volumes_from, environment, ...) fails', () => {
    expect(Object.keys(init()).sort()).toEqual(
      [
        'cap_add',
        'cap_drop',
        'deploy',
        'entrypoint',
        'healthcheck',
        'image',
        'labels',
        'logging',
        'network_mode',
        'read_only',
        'restart',
        'security_opt',
        'user',
        'volumes',
        'working_dir',
      ].sort(),
    );
  });

  it('does not inherit the image HEALTHCHECK (disabled) or the /server WORKDIR (working_dir /)', () => {
    expect(init().healthcheck).toEqual({ disable: true });
    expect(init().working_dir).toBe('/');
  });

  it('has the limits, logging and labels of velocity-human', () => {
    expect(init().deploy).toEqual({
      resources: { limits: { cpus: '0.1', memory: '64m', pids: 16 } },
    });
    expect(init().logging).toEqual(human().logging);
    expect(init().labels).toEqual(human().labels);
    expect(init().labels).toMatchObject({
      'geldar.project': 'geldar-nf',
      'com.centurylinklabs.watchtower.enable': 'false',
    });
  });

  it('is depended on by velocity-human with service_completed_successfully, and depends on nothing itself', () => {
    expect(init().depends_on).toBeUndefined();
    const deps = human().depends_on as Record<string, { condition: unknown }>;
    expect(deps[INIT]?.condition).toBe('service_completed_successfully');
  });

  it('leaves velocity-human non-root, read-only, cap_drop ALL, tmpfs /tmp without exec, and with no UID/GID env', () => {
    expect(human().user).toBeDefined();
    expect(human().read_only).toBe(true);
    expect(human().cap_drop).toEqual(['ALL']);
    expect(human().tmpfs).toEqual(['/tmp']);
    const env = (human().environment ?? {}) as Record<string, unknown>;
    expect(env).not.toHaveProperty('UID');
    expect(env).not.toHaveProperty('GID');
  });
});
