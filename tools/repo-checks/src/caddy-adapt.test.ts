import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Adapts each public site file with the pinned caddy image (the digest in validate.sh and
// docs/analysis/phase1/worknotes/C2-04.md) and reads the JSON, so route order is checked as Caddy
// sees it and not as the text reads. Docker is used only for `docker run --rm` of that image.
const IMAGE = 'caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'deploy/caddy');

const dockerUp =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    stdio: 'ignore',
  }).status === 0;
// CI sets GELDAR_REQUIRE_DOCKER=1, so a missing Docker there fails instead of skipping.
const mustRun = process.env.GELDAR_REQUIRE_DOCKER === '1';
const skip = !dockerUp && !mustRun;

type Handler = {
  handler?: string;
  status_code?: number;
  routes?: Route[];
  request?: { delete?: string[]; set?: Record<string, string[]> };
  headers?: { request?: { set?: Record<string, string[]> } };
};
type Route = { handle?: Handler[] };

/** The handlers of a route tree in the order Caddy runs them. */
function flatten(routes: Route[]): Handler[] {
  return routes.flatMap((r) =>
    (r.handle ?? []).flatMap((h) => (h.handler === 'subroute' ? flatten(h.routes ?? []) : [h])),
  );
}

function adapt(site: string): Handler[] {
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'GELDAR_DOMAIN=example.test',
      '-e',
      'GELDAR_MAP_UPSTREAM=map.example.test:8100',
      '-e',
      'GELDAR_GLASS_UPSTREAM=glass.example.test:8080',
      '-e',
      'GELDAR_MCP_UPSTREAM=mcp.example.test:8788',
      '-e',
      'GELDAR_REGISTER_UPSTREAM=register.example.test:8090',
      '-v',
      `${dir}:/etc/caddy:ro`,
      IMAGE,
      'caddy',
      'adapt',
      '--adapter',
      'caddyfile',
      '--config',
      `/etc/caddy/${site}.caddy`,
    ],
    { encoding: 'utf8' },
  );
  expect(run.status, run.stderr).toBe(0);
  const json = JSON.parse(run.stdout) as {
    apps: { http: { servers: Record<string, { routes: Route[] }> } };
  };
  const server = Object.values(json.apps.http.servers)[0] as { routes: Route[] };
  return flatten(server.routes);
}

describe.each(['map', 'glass', 'mcp', 'register'])('caddy adapt: %s.caddy', (site) => {
  it.skipIf(skip)(
    'runs the 405 before any proxy or 404 route, and strips then sets the client address',
    { timeout: 120_000 },
    () => {
      const chain = adapt(site);
      const at405 = chain.findIndex(
        (h) => h.handler === 'static_response' && h.status_code === 405,
      );
      const firstProxy = chain.findIndex((h) => h.handler === 'reverse_proxy');
      const first404 = chain.findIndex(
        (h) => h.handler === 'static_response' && h.status_code === 404,
      );
      expect(at405).toBeGreaterThanOrEqual(0);
      expect(firstProxy).toBeGreaterThan(at405);
      if (first404 >= 0) expect(first404).toBeGreaterThan(at405);

      const deletes = chain.flatMap((h, i) =>
        (h.request?.delete ?? []).map((name) => ({ name: name.toLowerCase(), i })),
      );
      for (const name of ['x-geldar-client-ip', 'x-forwarded-for', 'cf-connecting-ip']) {
        const d = deletes.find((x) => x.name === name);
        expect(d, `${site}: ${name} is deleted`).toBeDefined();
        expect(d?.i).toBeLessThan(firstProxy);
      }

      const proxies = chain.filter((h) => h.handler === 'reverse_proxy');
      expect(proxies.length).toBeGreaterThan(0);
      for (const p of proxies) {
        const keys = Object.keys(p.headers?.request?.set ?? {}).map((k) => k.toLowerCase());
        expect(keys).toContain('x-geldar-client-ip');
      }
    },
  );
});
