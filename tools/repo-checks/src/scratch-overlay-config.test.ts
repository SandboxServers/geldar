// Config tests for the scratch overlay and script text: ports, caps, secrets and the script's order of work.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CollectionTag, parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY_TEXT = readFileSync(`${ROOT}compose/opt-in/scratch.yml`, 'utf8');
const SCRIPT_PATH = `${ROOT}deploy/scratch/scratch.sh`;
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');
const PHASE0_TEXT = readFileSync(`${ROOT}compose/phase0.yml`, 'utf8');

/** compose replaces the list under !override instead of appending to it; the parsed value is marked. */
const OVERRIDE: CollectionTag = {
  tag: '!override',
  collection: 'seq',
  resolve: (node: unknown) => ({ override: true, items: (node as { toJSON(): unknown }).toJSON() }),
};

interface Service {
  ports?: { override: boolean; items: string[] } | string[];
  deploy?: { resources: { limits: { memory: string; cpus: string } } };
  memswap_limit?: string;
  restart?: string;
  labels?: Record<string, string>;
}
interface Overlay {
  services: Record<string, Service>;
  secrets: Record<string, { file: string }>;
}

const OVERLAY = parse(OVERLAY_TEXT, { customTags: [OVERRIDE] }) as Overlay;
const BASE = parse(PHASE0_TEXT) as { services: Record<string, { ports?: string[] }> };
const OVERLAY_SERVICES = ['postgres', 'nats', 'paper', 'velocity', 'eventsink'];

/** The host port of a published mapping such as "127.0.0.1:5432:5432" (host is the second field from the end). */
function hostPort(mapping: string): number {
  const match = mapping.match(/(\d+):\d+$/);
  if (!match?.[1]) throw new Error(`no host port in ${mapping}`);
  return Number(match[1]);
}

describe('scratch overlay: ports', () => {
  it('replaces the ports of postgres, nats and velocity with exact loopback mappings', () => {
    expect(OVERLAY.services.postgres?.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_PG_PORT:-15432}:5432`],
    });
    expect(OVERLAY.services.nats?.ports).toEqual({
      override: true,
      items: [
        `127.0.0.1:\${SCRATCH_NATS_PORT:-14222}:4222`,
        `127.0.0.1:\${SCRATCH_NATS_MON_PORT:-18222}:8222`,
      ],
    });
    expect(OVERLAY.services.velocity?.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_MC_PORT:-35565}:25565`],
    });
  });

  it('gives paper and eventsink no ports key, so they publish nothing', () => {
    expect(OVERLAY.services.paper).not.toHaveProperty('ports');
    expect(OVERLAY.services.eventsink).not.toHaveProperty('ports');
  });

  it('uses the four defaults the runbook names, and none of them is a phase0 host port', () => {
    const defaults = [...OVERLAY_TEXT.matchAll(/\$\{SCRATCH_[A-Z_]+:-(\d+)\}/g)].map((m) =>
      Number(m[1]),
    );
    expect(defaults.sort((a, b) => a - b)).toEqual([14222, 15432, 18222, 35565]);
    const phase0Hosts = Object.values(BASE.services).flatMap((s) => (s.ports ?? []).map(hostPort));
    expect(phase0Hosts).toContain(5432);
    for (const port of defaults) expect(phase0Hosts).not.toContain(port);
  });

  it('binds every overlay mapping to 127.0.0.1 and no other address', () => {
    expect(OVERLAY_TEXT).not.toMatch(/0\.0\.0\.0/);
    const addresses = OVERLAY_TEXT.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    expect(addresses.filter((address) => address !== '127.0.0.1')).toEqual([]);
    expect(OVERLAY_TEXT).not.toMatch(/container_name/);
  });
});

describe('scratch overlay: caps and secrets', () => {
  it.each(OVERLAY_SERVICES)(
    'caps %s, sets memswap to the memory cap, restart "no", and the label',
    (name) => {
      const service = OVERLAY.services[name];
      const limits = service?.deploy?.resources.limits;
      expect(limits?.memory).toMatch(/^\d+m$/);
      expect(limits?.cpus).toMatch(/^[\d.]+$/);
      expect(service?.memswap_limit).toBe(limits?.memory);
      expect(service?.restart).toBe('no');
      expect(service?.labels).toEqual({ 'geldar.scratch': 'true' });
    },
  );

  it('caps every service that phase0.yml defines, so a new service cannot run uncapped', () => {
    for (const name of Object.keys(BASE.services)) {
      expect(OVERLAY.services[name]?.deploy?.resources.limits.memory, name).toBeDefined();
    }
  });

  it('keeps the paper heap default at 2G and the paper cap at 3072m', () => {
    expect(OVERLAY_TEXT).toContain(`MEMORY: \${PAPER_MEMORY:-2G}`);
    expect(OVERLAY.services.paper?.deploy?.resources.limits.memory).toBe('3072m');
  });

  it('takes the postgres, rcon and forwarding secrets from the state directory only', () => {
    expect(OVERLAY.secrets.postgres?.file).toBe(
      `\${SCRATCH_SECRETS_DIR:?set by deploy/scratch/scratch.sh}/postgres.txt`,
    );
    expect(OVERLAY_TEXT).not.toContain('./secrets/');
  });
});

describe('scratch script: text', () => {
  it('tears down with -v, the local images and orphans, and never names /tmp', () => {
    expect(SCRIPT).toContain('down -v --rmi local --remove-orphans');
    expect(SCRIPT).not.toMatch(/TMPDIR|\/tmp/);
  });

  it('reads free disk on the Docker data root as well as the repo', () => {
    expect(SCRIPT).toContain('{{.DockerRootDir}}');
  });

  it('sets the compose variables first, then checks NATS, the gate and the jars, before compose up', () => {
    const up = SCRIPT.slice(SCRIPT.indexOf('do_up() {'), SCRIPT.indexOf('do_status() {'));
    const at = (needle: string) => up.indexOf(needle);
    expect(at('set_env')).toBeGreaterThanOrEqual(0);
    expect(at('set_env')).toBeLessThan(at('check_compose'));
    expect(at('set_env')).toBeLessThan(
      at('docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"'),
    );
    expect(up).not.toContain('compose_run ps -aq');
    expect(at('check_nats')).toBeLessThan(at('  gate'));
    expect(at('  gate')).toBeLessThan(at('check_plugins'));
    expect(at('check_plugins')).toBeLessThan(at('compose_run up'));
  });
});
