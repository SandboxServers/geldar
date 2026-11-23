import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCKER_COMPOSE_PROBE, toolAvailable } from '../../../deploy/test/tool-probe.js';

// The explicit NF_TELEMETRY=off overlay, rendered by the docker compose CLI (it reads the files and starts nothing).
// The overlay sets GELDAR_NF_TELEMETRY=off on neoforge only; the base file has no such key.
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const BASE = 'compose/nf-live.yml';
const OFF = 'compose/nf-live-telemetry-off.yml';
const SPAWN_MS = 60_000;

type Service = { environment?: Record<string, string> | string[] };

function compose(files: string[], ...args: string[]) {
  const fileArgs = files.flatMap((f) => ['-f', resolve(ROOT, f)]);
  return spawnSync('docker', ['compose', ...fileArgs, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: SPAWN_MS,
  });
}

function renderJson(files: string[]): { services: Record<string, Service> } {
  const r = compose(files, 'config', '--format', 'json');
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

// Compose renders environment as a map; the list form is read too, so either shape is checked the same way.
function envOf(svc: Service | undefined): Record<string, string> {
  const env = svc?.environment ?? {};
  if (!Array.isArray(env)) return env;
  return Object.fromEntries(
    env.map((kv) => {
      const at = kv.indexOf('=');
      return [kv.slice(0, at), kv.slice(at + 1)];
    }),
  );
}

const DOCKER = toolAvailable(DOCKER_COMPOSE_PROBE);

describe.skipIf(!DOCKER)('the NF_TELEMETRY=off overlay under docker compose config', () => {
  it(
    'sets GELDAR_NF_TELEMETRY=off on neoforge and on no other service',
    () => {
      const rendered = renderJson([BASE, OFF]);
      expect(envOf(rendered.services.neoforge).GELDAR_NF_TELEMETRY).toBe('off');
      for (const [name, svc] of Object.entries(rendered.services)) {
        if (name !== 'neoforge') expect(envOf(svc)).not.toHaveProperty('GELDAR_NF_TELEMETRY');
      }
    },
    SPAWN_MS,
  );

  it(
    'renders alone, the way CI renders it (config --quiet)',
    () => {
      const r = compose([OFF], 'config', '--quiet');
      expect(r.status, r.stderr).toBe(0);
    },
    SPAWN_MS,
  );

  it(
    'the base render has no GELDAR_NF_TELEMETRY key, and two base renders are identical',
    () => {
      const first = compose([BASE], 'config', '--format', 'json');
      const second = compose([BASE], 'config', '--format', 'json');
      expect(first.status, first.stderr).toBe(0);
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout).toBe(first.stdout);
      const base: { services: Record<string, Service> } = JSON.parse(first.stdout);
      for (const svc of Object.values(base.services)) {
        expect(envOf(svc)).not.toHaveProperty('GELDAR_NF_TELEMETRY');
      }
    },
    SPAWN_MS,
  );
});
