import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Proxy as AliasProxy,
  loadAliases,
  NEUTRAL_LABEL,
  rewritePlayers,
  startProxy,
} from '../alias-proxy/alias-proxy.ts';

// The BlueMap alias proxy: player names in live/players.json become private aliases, never the username.
// Every username and alias here is made up.
const PLAYERS = {
  players: [
    {
      uuid: 'u-1',
      name: 'ag_test_01',
      foreign: false,
      position: { x: 1.5, y: 64, z: -2 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
    },
    {
      uuid: 'u-2',
      name: 'ag_test_02',
      foreign: false,
      position: { x: 3, y: 70, z: 4 },
      rotation: { pitch: 1, yaw: 2, roll: 0 },
    },
  ],
};
const MARKERS = '{"x":1.0,"note":"ag_test_01 stays"}';

let dir: string;
let upstream: Server;
let upstreamPort = 0;
let upstreamBody = JSON.stringify(PLAYERS);
const proxies: AliasProxy[] = [];

function fetchText(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    }).on('error', fail);
  });
}

async function proxyFor(aliasesFile: string | undefined, log: string[] = []): Promise<number> {
  const p = await startProxy({
    listen: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort,
    aliasesFile,
    log: (l) => log.push(l),
  });
  proxies.push(p);
  return p.port();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'alias-proxy-'));
  upstream = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url?.endsWith('/markers.json') ? MARKERS : upstreamBody);
  });
  await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
  const addr = upstream.address();
  upstreamPort = typeof addr === 'object' && addr ? addr.port : 0;
});
afterAll(() => {
  for (const p of proxies) p.close();
  upstream.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('alias proxy', () => {
  it('replaces names with aliases and leaks no username anywhere in the output', async () => {
    const file = join(dir, 'a.json');
    writeFileSync(file, JSON.stringify({ ag_test_01: 'TestRanger', ag_test_02: 'OtherRanger' }));
    const r = await fetchText(await proxyFor(file), '/maps/overworld/live/players.json');
    expect(r.status).toBe(200);
    const doc = JSON.parse(r.body) as typeof PLAYERS;
    expect(doc.players.map((p) => p.name)).toEqual(['TestRanger', 'OtherRanger']);
    expect(r.body).not.toContain('ag_test');
  });

  it('keeps every non-name field identical', async () => {
    const file = join(dir, 'b.json');
    writeFileSync(file, JSON.stringify({ ag_test_01: 'TestRanger' }));
    const r = await fetchText(await proxyFor(file), '/maps/overworld/live/players.json');
    const out = JSON.parse(r.body) as typeof PLAYERS;
    const strip = (d: typeof PLAYERS) => d.players.map(({ name: _n, ...rest }) => rest);
    expect(strip(out)).toEqual(strip(PLAYERS));
    expect(JSON.stringify(strip(out))).toBe(JSON.stringify(strip(PLAYERS)));
  });

  it('gives a player without an alias the neutral label', async () => {
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({ ag_test_01: 'TestRanger' }));
    const r = await fetchText(await proxyFor(file), '/maps/overworld/live/players.json');
    const doc = JSON.parse(r.body) as typeof PLAYERS;
    expect(doc.players.map((p) => p.name)).toEqual(['TestRanger', NEUTRAL_LABEL]);
    expect(r.body).not.toContain('ag_test');
  });

  it.each([
    ['missing', join(tmpdir(), 'alias-proxy-does-not-exist.json')],
    ['not json', 'bad.json'],
    ['an array', 'arr.json'],
    ['a non-string alias', 'num.json'],
  ])('fails closed when the file is %s', async (kind, name) => {
    const file = kind === 'missing' ? name : join(dir, name);
    if (kind === 'not json') writeFileSync(file, '{oops');
    if (kind === 'an array') writeFileSync(file, '["TestRanger"]');
    if (kind === 'a non-string alias') writeFileSync(file, '{"ag_test_01":7}');
    const log: string[] = [];
    const r = await fetchText(await proxyFor(file, log), '/maps/overworld/live/players.json');
    const doc = JSON.parse(r.body) as typeof PLAYERS;
    expect(doc.players.map((p) => p.name)).toEqual([NEUTRAL_LABEL, NEUTRAL_LABEL]);
    expect(r.body).not.toContain('ag_test');
    expect(log).toHaveLength(1);
    expect(log.join('')).not.toContain('ag_test');
  });

  it('fails closed when no alias file is configured', async () => {
    const r = await fetchText(await proxyFor(undefined), '/maps/overworld/live/players.json');
    expect(r.body).not.toContain('ag_test');
    expect(loadAliases(undefined)).toBeNull();
  });

  it('passes other live files through byte-identical', async () => {
    const r = await fetchText(await proxyFor(undefined), '/maps/overworld/live/markers.json');
    expect(r.body).toBe(MARKERS);
  });

  it('answers 502 and never the raw body when players.json has an unexpected shape', async () => {
    upstreamBody = '{"people":["ag_test_01"]}';
    const r = await fetchText(await proxyFor(undefined), '/maps/overworld/live/players.json');
    upstreamBody = JSON.stringify(PLAYERS);
    expect(r.status).toBe(502);
    expect(r.body).not.toContain('ag_test');
    expect(rewritePlayers('not json', null)).toBeNull();
  });

  it('serves nothing outside the live path', async () => {
    const r = await fetchText(await proxyFor(undefined), '/maps/overworld/../../x');
    expect(r.status).toBe(404);
  });
});

describe('compose wiring', () => {
  const read = (rel: string) =>
    readFileSync(join(import.meta.dirname, '..', '..', '..', rel), 'utf8');

  it('the Caddy @live handler proxies to the alias proxy, never straight to Paper', () => {
    const caddy = read('compose/bluemap-web/Caddyfile');
    const live = /handle @live \{([\s\S]*?)\n\t\}/.exec(caddy)?.[1] ?? '';
    expect(live).toContain('reverse_proxy bluemap-alias:8102');
    expect(live).not.toContain('paper:8101');
    expect(caddy.replace(/#.*$/gm, '')).not.toContain('paper:8101');
  });

  it('serves the head stylesheet with a fixed square size', () => {
    const css = read('plugins/bluemap/web/geldar.css').replace(/\s+/g, '');
    expect(css).toContain('.bm-marker-playerimg{width:32px;height:32px;object-fit:contain;}');
    expect(read('compose/bluemap-web/Caddyfile')).toContain('/assets/geldar.css');
  });
});
