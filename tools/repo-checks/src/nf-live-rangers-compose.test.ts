// The rangers overlay (compose/nf-live-rangers.yml, opt-in, project geldar-nf). The structural checks read the YAML and always run.
// The render checks run only where docker compose is present: the overlay renders with the base file, and the base services
// render exactly as they do without it (so adding the overlay never recreates a live service).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { dockerComposeProbe, toolAvailable } from '../../../deploy/test/tool-probe.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE_PATH = `${ROOT}compose/nf-live.yml`;
const RANGERS_PATH = `${ROOT}compose/nf-live-rangers.yml`;
const RANGERS_TEXT = readFileSync(RANGERS_PATH, 'utf8');
// biome-ignore lint/suspicious/noExplicitAny: the parsed compose file is untyped YAML
type Doc = Record<string, any>;
// merge: true resolves the `<<: *ranger-body` anchor merge the five Bodies use.
const overlay = parse(RANGERS_TEXT, { merge: true }) as Doc;
const base = parse(readFileSync(BASE_PATH, 'utf8'), { merge: true }) as Doc;

const RANGER_SERVICES = [
  'ranger-yellow',
  'ranger-green',
  'ranger-blue',
  'ranger-red',
  'ranger-pink',
];
const PLAYER_IDS = [
  'ag-turboyelo-01',
  'ag-turbogreen-01',
  'ag-turboblue-01',
  'ag-turbored-01',
  'ag-turbopink-01',
];
const OVERLAY_SERVICES = [...RANGER_SERVICES, 'geldar-mcp', 'rangers-admin'];
const RANGER_SECRETS = [
  'nats-ranger.txt',
  'nats-mcp.txt',
  'postgres-mcp.txt',
  'mcp-token-pepper.txt',
];
const DOCKER = toolAvailable(dockerComposeProbe());

const services = (): [string, Doc][] => Object.entries(overlay.services as Record<string, Doc>);

describe('nf-live-rangers overlay: structure', () => {
  it('names the project geldar-nf and declares exactly the seven services', () => {
    expect(overlay.name).toBe('geldar-nf');
    expect(Object.keys(overlay.services).sort()).toEqual([...OVERLAY_SERVICES].sort());
  });

  it('declares no base service name, so adding the overlay recreates nothing', () => {
    const baseNames = Object.keys(base.services);
    for (const name of Object.keys(overlay.services)) expect(baseNames).not.toContain(name);
  });

  it('publishes exactly one port, 127.0.0.1:46788 to the MCP, and nothing else', () => {
    const published = services().flatMap(([name, s]) =>
      (s.ports ?? []).map((p: string) => `${name} ${p}`),
    );
    expect(published).toEqual(['geldar-mcp 127.0.0.1:46788:8788']);
  });

  it('joins the nf network only, and declares no external network or volume', () => {
    for (const [name, s] of services()) expect(s.networks, name).toEqual(['nf']);
    expect(Object.keys(overlay.networks)).toEqual(['nf']);
    expect(overlay.networks.nf).toEqual({});
    expect(overlay.volumes).toBeUndefined();
  });

  it('gives every service read-only root, cap_drop ALL, no-new-privileges, cpu_shares 256 and no swap', () => {
    for (const [name, s] of services()) {
      expect(s.read_only, `${name} read_only`).toBe(true);
      expect(s.cap_drop, `${name} cap_drop`).toEqual(['ALL']);
      expect(s.security_opt, `${name} security_opt`).toEqual(['no-new-privileges:true']);
      expect(s.cpu_shares, `${name} cpu_shares`).toBe(256);
      const mem = s.deploy.resources.limits.memory;
      expect(s.memswap_limit, `${name} memswap_limit equals memory`).toBe(mem);
      expect(s.pids_limit, `${name} pids_limit`).toBe(128);
      expect(s.deploy.resources.limits.pids, `${name} pids`).toBe(128);
    }
  });

  it('caps each Body at 0.5 CPU, 512m and 128 pids, and geldar-mcp at 0.25 CPU, 256m and 128 pids', () => {
    for (const name of RANGER_SERVICES) {
      const l = (overlay.services as Doc)[name].deploy.resources.limits;
      expect({ name, cpus: l.cpus, memory: l.memory }).toEqual({
        name,
        cpus: '0.5',
        memory: '512m',
      });
    }
    const mcp = (overlay.services as Doc)['geldar-mcp'].deploy.resources.limits;
    expect({ cpus: mcp.cpus, memory: mcp.memory }).toEqual({ cpus: '0.25', memory: '256m' });
    const admin = (overlay.services as Doc)['rangers-admin'].deploy.resources.limits;
    expect({ cpus: admin.cpus, memory: admin.memory }).toEqual({ cpus: '0.5', memory: '512m' });
  });

  it('runs the five Bodies as players-host, each with its own player id, and no other command', () => {
    const ids = RANGER_SERVICES.map((name) => {
      const s = (overlay.services as Doc)[name];
      expect(s.entrypoint).toEqual(['node', 'src/players/main.ts']);
      expect(s.command[0]).toBe('--player');
      return s.command[1];
    });
    expect(ids).toEqual(PLAYER_IDS);
    expect(RANGERS_TEXT).not.toMatch(/ag-turboyellow/);
  });

  it('keeps RCON off paper and on the neoforge service name, with the in-network opt-in', () => {
    for (const name of RANGER_SERVICES) {
      const env = (overlay.services as Doc)[name].environment;
      expect(env.GELDAR_RCON_HOST).toBe('neoforge');
      expect(env.GELDAR_IN_NETWORK_HOSTS).toBe('1');
      expect(env.GELDAR_SHARD).toBe('nf');
    }
    expect(RANGERS_TEXT).not.toMatch(/\bpaper\b/);
  });

  it('sets no telemetry or OTEL variable on any service', () => {
    for (const [name, s] of services()) {
      for (const key of Object.keys(s.environment ?? {})) {
        expect(key, `${name} env ${key}`).not.toMatch(/TELEMETRY|OTEL/i);
      }
    }
  });

  it('gives the Bodies the ranger NATS user and the MCP the mcp user, each with its own password file', () => {
    for (const name of RANGER_SERVICES) {
      const env = (overlay.services as Doc)[name].environment;
      expect(env.GELDAR_NATS_USER).toBe('ranger');
      expect(env.GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-ranger.txt');
    }
    const mcp = (overlay.services as Doc)['geldar-mcp'].environment;
    expect(mcp.GELDAR_NATS_USER).toBe('mcp');
    expect(mcp.GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-mcp.txt');
  });

  it('declares the four ranger secret files, each read from the per-project directory', () => {
    for (const file of RANGER_SECRETS) {
      expect(overlay.secrets[file], file).toEqual({
        file: `\${NF_SECRETS_DIR:-./secrets-nf}/${file}`,
      });
    }
  });

  it('puts the rangers-admin one-shot behind the admin profile, and no other service has a profile', () => {
    for (const [name, s] of services()) {
      if (name === 'rangers-admin') {
        expect(s.profiles).toEqual(['admin']);
        expect(s.restart).toBe('no');
      } else {
        expect(s.profiles, name).toBeUndefined();
      }
    }
  });

  it('restarts the Bodies and the MCP unless-stopped, and no service depends on a base service', () => {
    for (const name of [...RANGER_SERVICES, 'geldar-mcp']) {
      expect((overlay.services as Doc)[name].restart, name).toBe('unless-stopped');
      expect((overlay.services as Doc)[name].depends_on, name).toBeUndefined();
    }
  });

  it('stays under the 500-line soft cap', () => {
    expect(RANGERS_TEXT.split('\n').length).toBeLessThan(500);
  });
});

describe.skipIf(!DOCKER)('nf-live-rangers overlay: render', () => {
  let dir = '';
  const compose = (files: string[], extra: string[] = []) =>
    spawnSync(
      'docker',
      ['compose', '-p', 'geldar-nf', ...files.flatMap((f) => ['-f', f]), ...extra],
      {
        cwd: join(ROOT, 'compose'),
        encoding: 'utf8',
        env: { ...process.env, NF_SECRETS_DIR: dir },
      },
    );

  beforeAll(() => {
    // Dummy secret files: every name either file declares, so both files render (compose reads the secret paths).
    dir = mkdtempSync(join(tmpdir(), 'nf-rangers-secrets-'));
    mkdirSync(dir, { recursive: true });
    const names = new Set<string>();
    for (const doc of [base, overlay]) {
      for (const s of Object.values(doc.secrets ?? {}) as Doc[])
        names.add(String(s.file).split('/').pop() ?? '');
    }
    for (const n of names) writeFileSync(join(dir, n), 'dummy\n');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('renders the overlay together with the base file', () => {
    const res = compose([BASE_PATH, RANGERS_PATH], ['config', '--quiet']);
    expect(res.stderr).not.toMatch(/invalid|error/i);
    expect(res.status).toBe(0);
  });

  it('renders each base service exactly as it renders without the overlay', () => {
    const alone = compose([BASE_PATH], ['config', '--format', 'json']);
    // The admin profile is named so that rangers-admin renders too (profiles are off by default).
    const both = compose(
      [BASE_PATH, RANGERS_PATH],
      ['--profile', 'admin', 'config', '--format', 'json'],
    );
    expect(alone.status).toBe(0);
    expect(both.status).toBe(0);
    const a = JSON.parse(alone.stdout).services;
    const b = JSON.parse(both.stdout).services;
    for (const name of Object.keys(a)) expect(b[name], name).toEqual(a[name]);
    expect(Object.keys(b).sort()).toEqual([...Object.keys(a), ...OVERLAY_SERVICES].sort());
  });
});
