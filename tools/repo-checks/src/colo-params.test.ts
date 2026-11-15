import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// G0-03: compose/colo.yml takes its project, network, subnet and loopback host ports from GELDAR_* variables.
// With none set, the merged config must equal the golden captured before the parameters existed, so `colo`
// is unchanged. A second environment must share no published port, network, volume, secret or container name.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GOLDEN = resolve(ROOT, 'deploy/test/fixtures/colo-default-config.yml');
const TIMEOUT_MS = 60_000;
/** The variables this check sets or clears; a developer's shell must not change the default render. */
const PARAM_VARS = [
  'GELDAR_PROJECT',
  'GELDAR_NETWORK',
  'GELDAR_COLO_SUBNET',
  'GELDAR_STATE_DIR',
  'GELDAR_PORT_BOT',
  'GELDAR_PORT_MCP',
  'GELDAR_PORT_REGISTER',
  'GELDAR_PORT_GLASS',
  'GELDAR_PORT_BLUEMAP',
  'COMPOSE_PROJECT_NAME',
];
const SECOND_ENV: Record<string, string> = {
  GELDAR_PROJECT: 'geldar-b',
  GELDAR_NETWORK: 'geldar-b',
  GELDAR_COLO_SUBNET: '198.51.100.0/24',
  GELDAR_PORT_BOT: '26567',
  GELDAR_PORT_MCP: '26788',
  GELDAR_PORT_REGISTER: '28090',
  GELDAR_PORT_GLASS: '26787',
  GELDAR_PORT_BLUEMAP: '26100',
};

const dockerOk = (() => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** The merged config `shard up colo` starts, rendered by compose with the given variables over a clean environment. */
function render(overrides: Record<string, string> = {}): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of PARAM_VARS) delete env[name];
  return execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'compose/colo.yml',
      '-f',
      'compose/nats-auth.yml',
      'config',
      '--no-path-resolution',
    ],
    {
      cwd: ROOT,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

interface Rendered {
  name?: string;
  services?: Record<string, { ports?: { published?: string | number }[] }>;
  networks?: Record<string, { name?: string; ipam?: { config?: { subnet?: string }[] } }>;
  volumes?: Record<string, { name?: string }>;
  secrets?: Record<string, { name?: string }>;
}

function parseRender(text: string): Rendered {
  return parse(text) as Rendered;
}

/** Every host port a service publishes. */
function hostPorts(doc: Rendered): string[] {
  return Object.values(doc.services ?? {}).flatMap((service) =>
    (service.ports ?? []).map((port) => String(port.published)),
  );
}

/** Every network, volume and secret name compose would create. */
function resourceNames(doc: Rendered): string[] {
  const names = [
    ...Object.values(doc.networks ?? {}).map((network) => network.name),
    ...Object.values(doc.volumes ?? {}).map((volume) => volume.name),
    ...Object.values(doc.secrets ?? {}).map((secret) => secret.name),
  ];
  return names.filter((name): name is string => typeof name === 'string');
}

/** The container names compose derives: `<project>-<service>-1`. No service may set container_name. */
function containerNames(doc: Rendered): string[] {
  return Object.keys(doc.services ?? {}).map((service) => `${doc.name}-${service}-1`);
}

function shared(a: string[], b: string[]): string[] {
  return a.filter((item) => b.includes(item));
}

describe.skipIf(!dockerOk)('colo compose parameters (docker compose config)', () => {
  it(
    'the default environment renders byte for byte the golden',
    () => {
      expect(render()).toBe(readFileSync(GOLDEN, 'utf8'));
    },
    TIMEOUT_MS,
  );

  it(
    'a second environment shares no host port, network, volume, secret or container name with the default',
    () => {
      const base = parseRender(render());
      const other = parseRender(render(SECOND_ENV));
      expect(hostPorts(base)).toHaveLength(4);
      expect(hostPorts(other)).toHaveLength(4);
      expect(shared(hostPorts(base), hostPorts(other))).toEqual([]);
      expect(shared(resourceNames(base), resourceNames(other))).toEqual([]);
      expect(resourceNames(base).length).toBeGreaterThan(0);
      expect(other.name).toBe('geldar-b');
      expect(shared(containerNames(base), containerNames(other))).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'the second environment takes its own subnet and its own loopback ports',
    () => {
      const other = parseRender(render(SECOND_ENV));
      expect(other.networks?.colo?.ipam?.config?.[0]?.subnet).toBe('198.51.100.0/24');
      // register (GELDAR_PORT_REGISTER) is not in this render: its service is outside the default profiles.
      expect(hostPorts(other).sort()).toEqual(['26100', '26567', '26787', '26788']);
    },
    TIMEOUT_MS,
  );
});
