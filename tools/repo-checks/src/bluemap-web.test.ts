import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// C2-07r: BlueMap's file storage writes only .gz files (textures.json.gz, tiles/.../z-1.prbm.gz). The compose
// bluemap-web Caddyfile must serve the plain names from them with Content-Encoding: gzip, and answer a missing
// tile with 204. This runs the pinned caddy image on a temp webroot, Docker-gated like caddy-adapt.
const IMAGE = 'caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const caddyfile = resolve(repo, 'compose/bluemap-web/Caddyfile');

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

describe('bluemap-web Caddyfile', () => {
  it('sets Content-Encoding gzip on the BlueMap .gz files', () => {
    // Caddy's precompressed directive cannot serve a sidecar without the plain file, so the Caddyfile rewrites to the
    // .gz and sets the header itself.
    const text = readFileSync(caddyfile, 'utf8');
    expect(text).toMatch(/header Content-Encoding gzip/);
    expect(text).toMatch(/rewrite \* \{re\.gz\.1\}\.gz/);
  });

  describe.skipIf(skip)('served by the pinned caddy image', () => {
    const root = mkdtempSync(join(tmpdir(), 'bluemap-web-'));
    const name = `geldar-bluemap-web-test-${process.pid}`;
    let port = 0;
    const settings = '{"maps":["world"]}';

    beforeAll(async () => {
      const map = join(root, 'maps', 'world');
      mkdirSync(join(map, 'tiles', '0', 'x-1'), { recursive: true });
      writeFileSync(join(map, 'textures.json.gz'), gzipSync('{"textures":[]}'));
      writeFileSync(
        join(map, 'tiles', '0', 'x-1', 'z-1.prbm.gz'),
        gzipSync(Buffer.from([1, 2, 3])),
      );
      writeFileSync(join(root, 'settings.json'), settings);
      const run = spawnSync(
        'docker',
        [
          'run',
          '-d',
          '--name',
          name,
          '-p',
          '127.0.0.1::8100',
          '-v',
          `${caddyfile}:/etc/caddy/Caddyfile:ro`,
          '-v',
          `${root}:/srv:ro`,
          IMAGE,
        ],
        { encoding: 'utf8' },
      );
      expect(run.status, run.stderr).toBe(0);
      const mapped = spawnSync('docker', ['port', name, '8100/tcp'], { encoding: 'utf8' });
      port = Number(mapped.stdout.trim().split('\n')[0]?.split(':').pop());
      for (let i = 0; i < 50; i++) {
        try {
          await call(port, 'GET', '/settings.json');
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }, 120_000);

    afterAll(() => {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      rmSync(root, { recursive: true, force: true });
    });

    it('serves textures.json from the .gz with Content-Encoding gzip', async () => {
      const r = await call(port, 'GET', '/maps/world/textures.json');
      expect(r.status).toBe(200);
      expect(r.headers['content-encoding']).toBe('gzip');
      expect(r.headers['content-type']).toContain('application/json');
      expect(JSON.parse(gunzipSync(r.body).toString())).toEqual({ textures: [] });
    });

    it('serves a tile from the .prbm.gz as octet-stream with gzip', async () => {
      const r = await call(port, 'GET', '/maps/world/tiles/0/x-1/z-1.prbm');
      expect(r.status).toBe(200);
      expect(r.headers['content-encoding']).toBe('gzip');
      expect(r.headers['content-type']).toContain('application/octet-stream');
      expect([...gunzipSync(r.body)]).toEqual([1, 2, 3]);
    });

    it('answers a missing tile with 204', async () => {
      const r = await call(port, 'GET', '/maps/world/tiles/0/x-9/z-9.prbm');
      expect(r.status).toBe(204);
    });

    it('refuses POST with 405', async () => {
      expect((await call(port, 'POST', '/maps/world/textures.json')).status).toBe(405);
    });

    it('leaves settings.json unchanged', async () => {
      const r = await call(port, 'GET', '/settings.json');
      expect(r.status).toBe(200);
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.body.toString()).toBe(settings);
    });
  });
});
