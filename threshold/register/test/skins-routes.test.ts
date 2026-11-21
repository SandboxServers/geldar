import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { mountSkinRoutes, type SkinStore } from '../src/api/skins.ts';
import { sendProblem } from '../src/problem.ts';
import type { SkinCheck } from '../src/skin-validate.ts';
import { baseDeps, cookie, IDENT, KEY_ALL } from './owner-api-harness.ts';

// The validator has its own table tests (src/skin-validate.test.ts). Here it is a stand-in: a buffer that starts with the
// PNG signature is accepted, anything else is refused, so the route's own order and mapping are what is tested.
vi.mock('../src/skin-validate.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/skin-validate.ts')>();
  return {
    ...real,
    checkSkinPng: (bytes: Uint8Array): SkinCheck => {
      const sig = Buffer.from('89504e470d0a1a0a', 'hex');
      if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(sig)) return { ok: true };
      return { ok: false, code: 'not_png' } as unknown as SkinCheck;
    },
  };
});

const SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const VALID = Buffer.concat([SIG, Buffer.from('valid-stand-in')]);
const SKIN = '/api/v1/agents/p1/skin';
const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((ok) => s.close(() => ok()))));
});

async function start(deps: ApiDeps): Promise<string> {
  const server = createServer((req, res) => {
    void handleApi(req, res, new URL(req.url ?? '/', 'http://local'), deps).then((handled) => {
      if (!handled) sendProblem(res, 'not_found');
    });
  });
  servers.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function fakeStore(submitResult: unknown = { ok: true, uploadId: 7 }, statusResult?: unknown) {
  const submitSkin = vi.fn(async () => submitResult as never);
  const skinStatus = vi.fn(async () => (statusResult ?? { ok: true, row: null }) as never);
  return { submitSkin, skinStatus, store: { submitSkin, skinStatus } as SkinStore };
}

async function boot(store: SkinStore): Promise<string> {
  return start(baseDeps({ routes: mountSkinRoutes(store) }));
}

function post(
  base: string,
  body: BodyInit,
  headers: Record<string, string> = cookie,
  type = 'image/png',
) {
  return fetch(`${base}${SKIN}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': type },
    body,
  });
}

describe('POST /agents/{playerId}/skin (C7-13a)', () => {
  it('a cookie session with a valid PNG is stored pending: 202, the sha256 of the bytes, nothing else', async () => {
    const f = fakeStore();
    const r = await post(await boot(f.store), VALID);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ uploadId: 7, status: 'pending' });
    expect(f.submitSkin).toHaveBeenCalledTimes(1);
    const [identity, player, png, sha] = f.submitSkin.mock.calls[0] as unknown as [
      string,
      string,
      Buffer,
      Buffer,
    ];
    expect(identity).toBe(IDENT);
    expect(player).toBe('p1');
    expect(png.equals(VALID)).toBe(true);
    expect(sha.length).toBe(32);
  });

  it('a bearer key is refused at this cookie-only route and nothing is stored', async () => {
    const f = fakeStore();
    const r = await post(await boot(f.store), VALID, { authorization: `Bearer ${KEY_ALL}` });
    expect(r.status).toBe(401);
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('a cookie write without the CSRF token is 403 and nothing is stored', async () => {
    const f = fakeStore();
    const r = await post(await boot(f.store), VALID, { cookie: cookie.cookie });
    expect(r.status).toBe(403);
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('a content type other than image/png is 422 before any read of the store', async () => {
    const f = fakeStore();
    const r = await post(await boot(f.store), VALID, cookie, 'multipart/form-data');
    expect(r.status).toBe(422);
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('bytes that are not a PNG are 422 with the refusal code only, never the bytes', async () => {
    const f = fakeStore();
    const r = await post(await boot(f.store), Buffer.from('GIF89a-secret-bytes'));
    const text = await r.text();
    expect(r.status).toBe(422);
    expect(text).toContain('not_png');
    expect(text).not.toContain('secret-bytes');
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('a declared body over 32 KiB is refused before it is buffered', async () => {
    const f = fakeStore();
    const big = Buffer.concat([SIG, Buffer.alloc(32 * 1024 + 1 - SIG.length)]);
    const r = await post(await boot(f.store), big);
    expect(r.status).toBe(422);
    expect(r.headers.get('connection')).toBe('close');
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('a streamed body (no Content-Length) over 32 KiB is refused by the running count', async () => {
    const f = fakeStore();
    const big = Buffer.concat([SIG, Buffer.alloc(32 * 1024 + 1 - SIG.length)]);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(big));
        c.close();
      },
    });
    const url = await boot(f.store);
    const r = await fetch(`${url}${SKIN}`, {
      method: 'POST',
      headers: { ...cookie, 'content-type': 'image/png' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(r.status).toBe(422);
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('exactly 32 KiB is not refused as too large (the last allowed size)', async () => {
    const f = fakeStore();
    const edge = Buffer.concat([SIG, Buffer.alloc(32 * 1024 - SIG.length)]);
    const r = await post(await boot(f.store), edge);
    expect(r.status).toBe(202);
    expect(f.submitSkin).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['skin_upload_pending', 409, 'conflict'],
    ['skin_upload_locked', 409, 'conflict'],
    ['skin_upload_wait', 429, 'rate_limited'],
    ['skin_upload_daily', 429, 'rate_limited'],
    ['not_your_agent', 404, 'not_found'],
    ['not_an_owner', 401, 'unauthenticated'],
    ['something_else', 500, 'internal'],
  ])('a store refusal %s is %i %s and names no owner id', async (code, status, problem) => {
    const f = fakeStore({ ok: false, code });
    const r = await post(await boot(f.store), VALID);
    const text = await r.text();
    expect(r.status).toBe(status);
    expect(text).toContain(problem);
    expect(text).not.toContain(IDENT);
  });

  it('the reject wait and the daily cap answer 429 with a Retry-After', async () => {
    const wait = await post(
      await boot(fakeStore({ ok: false, code: 'skin_upload_wait' }).store),
      VALID,
    );
    expect(wait.headers.get('retry-after')).toBe('3600');
    const daily = await post(
      await boot(fakeStore({ ok: false, code: 'skin_upload_daily' }).store),
      VALID,
    );
    expect(daily.headers.get('retry-after')).toBe('86400');
  });
});

/** Sends `chunks` chunks of `size` bytes with no Content-Length (chunked), and resolves with the status and body. */
function postChunked(
  base: string,
  chunks: number,
  size: number,
): Promise<{ status: number; body: string }> {
  const url = new URL(`${base}${SKIN}`);
  return new Promise((ok, fail) => {
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { ...cookie, 'content-type': 'image/png' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => {
          body += d;
        });
        res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', fail);
    for (let i = 0; i < chunks; i++) req.write(Buffer.alloc(size));
    req.end();
  });
}

/** Sends only the headers of a POST with the given Content-Length and no body; resolves with the status line. */
function postDeclaredOnly(base: string, length: number): Promise<string> {
  const url = new URL(base);
  const lines = Object.entries({
    ...cookie,
    'content-type': 'image/png',
    'content-length': String(length),
  }).map(([k, v]) => `${k}: ${v}`);
  return new Promise((ok, fail) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(`POST ${SKIN} HTTP/1.1\r\nHost: ${url.host}\r\n${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.setEncoding('utf8');
    socket.once('data', (d: string) => {
      ok(d.split('\r\n')[0] ?? '');
      socket.destroy();
    });
    socket.on('error', fail);
  });
}

describe('skin body reads and route flags (C7-13a review fix 1)', () => {
  it('a chunked body over 32 KiB is 422 problem, not a connection reset (40 chunks of 64 KiB)', async () => {
    const f = fakeStore();
    const r = await postChunked(await boot(f.store), 40, 64 * 1024);
    expect(r.status).toBe(422);
    expect(r.body).toContain('invalid');
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('a declared Content-Length over 32 KiB is refused with 422 before any body byte is sent', async () => {
    const f = fakeStore();
    const statusLine = await postDeclaredOnly(await boot(f.store), 40_000);
    expect(statusLine).toBe('HTTP/1.1 422 Unprocessable Entity');
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('both skin routes are cookie-only, and only the POST writes', () => {
    const f = fakeStore();
    const routes = mountSkinRoutes(f.store);
    expect(routes.every((r) => r.cookieOnly === true)).toBe(true);
    expect(routes[0]?.write).toBe(true);
    expect(routes[1]?.write).toBe(false);
  });
});

describe('GET /agents/{playerId}/skin (C7-13a)', () => {
  it('returns the newest status and reason code, and no image bytes', async () => {
    const row = {
      uploadId: 9,
      status: 'rejected',
      reason: 'not_a_face',
      createdAt: '2026-11-20T00:00:00Z',
      decidedAt: '2026-11-20T01:00:00Z',
    };
    const f = fakeStore(undefined, { ok: true, row });
    const r = await fetch(`${await boot(f.store)}${SKIN}`, { headers: cookie });
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body).toEqual(row);
    expect(JSON.stringify(body)).not.toContain('png');
  });

  it('an agent with no upload answers status none, not 404', async () => {
    const f = fakeStore();
    const r = await fetch(`${await boot(f.store)}${SKIN}`, { headers: cookie });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'none' });
  });

  it('another owner agent is 404 and a bearer key is refused', async () => {
    const f = fakeStore(undefined, { ok: false, code: 'not_your_agent' });
    const base = await boot(f.store);
    expect((await fetch(`${base}${SKIN}`, { headers: cookie })).status).toBe(404);
    expect(
      (await fetch(`${base}${SKIN}`, { headers: { authorization: `Bearer ${KEY_ALL}` } })).status,
    ).toBe(401);
  });
});

describe('mountSkinRoutes (C7-13a)', () => {
  it('mounts nothing unless the store has both methods', () => {
    const f = fakeStore();
    expect(mountSkinRoutes({ submitSkin: f.submitSkin })).toEqual([]);
    expect(mountSkinRoutes({ skinStatus: f.skinStatus })).toEqual([]);
    expect(mountSkinRoutes(f.store)).toHaveLength(2);
  });
});
