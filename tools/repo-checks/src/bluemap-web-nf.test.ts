import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// NF-BM-3: the read-only static map server for the NeoForge shard (compose/bluemap-web-nf). It serves tiles from the
// bluemap/web subpath and never serves /maps/<map>/live. Real caddy in Docker (the pinned image of bluemap-web), skipped
// without Docker like bluemap-web.test.ts. The text tests run everywhere.
const IMAGE = 'caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = resolve(repo, 'compose/bluemap-web-nf');
const caddyfile = resolve(dir, 'Caddyfile');
const readme = resolve(dir, 'README.md');
const caddyText = readFileSync(caddyfile, 'utf8');
const readmeText = readFileSync(readme, 'utf8');

/** The first fenced yaml block of the README: the service snippet for the NeoForge overlay. */
function snippet(): string {
  const m = /```yaml\n([\s\S]*?)\n```/.exec(readmeText);
  if (!m?.[1]) throw new Error('no yaml block in compose/bluemap-web-nf/README.md');
  return m[1];
}

const dockerUp =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' })
    .status === 0;
const mustRun = process.env.GELDAR_REQUIRE_DOCKER === '1';
const skip = !dockerUp && !mustRun;

type Reply = { status: number; headers: Record<string, string>; body: Buffer };
function call(port: number, method: string, path: string): Promise<Reply> {
  return new Promise((ok, fail) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { 'accept-encoding': 'gzip' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          ok({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', fail);
    req.end();
  });
}

/** Starts the pinned caddy image on a webroot (mounted read only at /srv) and returns the mapped loopback port. */
async function startCaddy(name: string, webroot: string): Promise<number> {
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      '127.0.0.1::8110',
      '-v',
      `${caddyfile}:/etc/caddy/Caddyfile:ro`,
      '-v',
      `${webroot}:/srv:ro`,
      IMAGE,
    ],
    { encoding: 'utf8' },
  );
  expect(run.status, run.stderr).toBe(0);
  const mapped = spawnSync('docker', ['port', name, '8110/tcp'], { encoding: 'utf8' });
  const port = Number(mapped.stdout.trim().split('\n')[0]?.split(':').pop());
  for (let i = 0; i < 50; i++) {
    try {
      await call(port, 'GET', '/');
      return port;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return port;
}

describe('bluemap-web-nf Caddyfile (text)', () => {
  it('listens on 8110 with admin off and no TLS', () => {
    expect(caddyText).toMatch(/^:8110 \{/m);
    expect(caddyText).toMatch(/admin off/);
    expect(caddyText).toMatch(/auto_https off/);
  });

  it('has no live-player handler that proxies, no pinned assets and no settings pin', () => {
    expect(caddyText).not.toMatch(/reverse_proxy/);
    expect(caddyText).not.toMatch(/\/assets\//);
    expect(caddyText).not.toMatch(/geldar-(settings|chat|sky)/);
    expect(caddyText).not.toMatch(/settings\.json/);
  });

  it('answers /maps/<map>/live and below with 404 before file_server', () => {
    expect(caddyText).toMatch(/@live path_regexp live \^\/maps\/\[\^\/\]\*\/live\(\/\.\*\)\?\$/);
    expect(caddyText).toMatch(/handle @live \{\s*respond 404\s*\}/);
  });

  it('refuses every method but GET and HEAD with 405, and sends nosniff without Server', () => {
    expect(caddyText).toMatch(/@not_allowed not method GET HEAD/);
    expect(caddyText).toMatch(/handle @not_allowed \{\s*respond 405\s*\}/);
    expect(caddyText).toMatch(/X-Content-Type-Options nosniff/);
    expect(caddyText).toMatch(/-Server/);
  });
});

describe('bluemap-web-nf README snippet (text)', () => {
  it('publishes only the loopback port 8110', () => {
    expect(snippet()).toContain('"127.0.0.1:8110:8110"');
    expect(snippet()).not.toMatch(/"8110:8110"|"0\.0\.0\.0:/);
  });

  it('mounts only the bluemap/web subpath of neoforge-data, read only, at /srv', () => {
    const y = snippet();
    expect(y).toMatch(
      /source: neoforge-data\n\s+target: \/srv\n\s+read_only: true\n\s+volume:\n\s+subpath: bluemap\/web/,
    );
  });

  it('never mounts /data or the whole volume', () => {
    const y = snippet();
    // A path that starts at the volume root (/data) as a mount source or target; /tmp/data in the environment is fine.
    expect(y).not.toMatch(/[\s:"'[,]\/data(?![\w.-])/);
    expect(y).not.toMatch(/target: \/data/);
    expect(y).toMatch(/- \.\/bluemap-web-nf\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
  });

  it('keeps the hardening and the start order', () => {
    const y = snippet();
    expect(y).toMatch(/read_only: true/);
    expect(y).toMatch(/cap_drop: \[ALL\]/);
    expect(y).toMatch(/no-new-privileges:true/);
    expect(y).toMatch(/user: "\$\{GELDAR_SERVICE_UID:-1000\}:\$\{GELDAR_SERVICE_UID:-1000\}"/);
    expect(y).toMatch(/neoforge:\n\s+condition: service_healthy/);
    expect(y).toMatch(/restart: unless-stopped/);
  });
});

describe.skipIf(skip)('bluemap-web-nf served by the pinned caddy image', () => {
  const root = mkdtempSync(join(tmpdir(), 'bluemap-web-nf-'));
  const name = `geldar-bluemap-web-nf-test-${process.pid}`;
  let port = 0;

  beforeAll(async () => {
    const map = join(root, 'maps', 'overworld');
    mkdirSync(join(map, 'tiles', '0', 'x-1'), { recursive: true });
    mkdirSync(join(map, 'live'), { recursive: true });
    writeFileSync(join(map, 'textures.json.gz'), gzipSync('{"textures":[]}'));
    writeFileSync(join(map, 'tiles', '0', 'x-1', 'z-1.prbm.gz'), gzipSync(Buffer.from([1, 2, 3])));
    // The live file exists in the webroot: the 404 must come from the rule, not from a missing file.
    writeFileSync(join(map, 'live', 'players.json'), '{"players":[{"name":"Alex"}]}');
    writeFileSync(join(map, 'live', 'markers.json'), '{"markers":[]}');
    port = await startCaddy(name, root);
  }, 120_000);

  afterAll(() => {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    rmSync(root, { recursive: true, force: true });
  });

  it('serves a tile from the .prbm.gz with 200 and Content-Encoding gzip', async () => {
    const r = await call(port, 'GET', '/maps/overworld/tiles/0/x-1/z-1.prbm');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers['content-type']).toContain('application/octet-stream');
  });

  it('serves textures.json from the .gz with 200', async () => {
    const r = await call(port, 'GET', '/maps/overworld/textures.json');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
  });

  it('answers /maps/overworld/live/players.json with 404 even though the file exists', async () => {
    const r = await call(port, 'GET', '/maps/overworld/live/players.json');
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain('Alex');
  });

  it('answers any other live path and the bare live directory with 404', async () => {
    expect((await call(port, 'GET', '/maps/overworld/live/markers.json')).status).toBe(404);
    expect((await call(port, 'GET', '/maps/overworld/live')).status).toBe(404);
    expect((await call(port, 'GET', '/maps/overworld/live/')).status).toBe(404);
    expect((await call(port, 'HEAD', '/maps/overworld/live/players.json')).status).toBe(404);
  });

  it('refuses POST with 405, including on the live path', async () => {
    expect((await call(port, 'POST', '/maps/overworld/textures.json')).status).toBe(405);
    expect((await call(port, 'POST', '/maps/overworld/live/players.json')).status).toBe(405);
  });

  it('sends no Server header and nosniff, on a 200 and on a 404', async () => {
    const ok = await call(port, 'GET', '/maps/overworld/textures.json');
    const miss = await call(port, 'GET', '/maps/overworld/live/players.json');
    for (const r of [ok, miss]) {
      expect(r.headers.server).toBeUndefined();
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
  });
});
