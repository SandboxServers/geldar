import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { mountSkinRoutes, type SkinStore } from '../src/api/skins.ts';
import { sendProblem } from '../src/problem.ts';
import { baseDeps, cookie } from './owner-api-harness.ts';

// No vi.mock here: these cases run the real checkSkinPng, so the route and the validator meet as they do in production.
// The refusal codes asserted below are the SkinRefusal values of src/skin-validate.ts.

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const SKIN = '/api/v1/agents/p1/skin';
const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((ok) => s.close(() => ok()))));
});

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** An 8-bit RGB PNG of black pixels: one filter byte per row, then 3 bytes per pixel. */
function skinPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const VALID = skinPng(64, 64);

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

function fakeStore() {
  const submitSkin = vi.fn(async () => ({ ok: true, uploadId: 7 }) as never);
  const skinStatus = vi.fn(async () => ({ ok: true, row: null }) as never);
  return { submitSkin, store: { submitSkin, skinStatus } as SkinStore };
}

function post(base: string, body: Buffer) {
  return fetch(`${base}${SKIN}`, {
    method: 'POST',
    headers: { ...cookie, 'content-type': 'image/png' },
    body,
  });
}

describe('POST /agents/{playerId}/skin with the real validator (C7-13a)', () => {
  it('a real 64x64 PNG is accepted: 202, and the store gets the exact bytes and their sha256', async () => {
    const f = fakeStore();
    const base = await start(baseDeps({ routes: mountSkinRoutes(f.store) }));
    const r = await post(base, VALID);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ uploadId: 7, status: 'pending' });
    expect(f.submitSkin).toHaveBeenCalledTimes(1);
    const [, , png, sha] = f.submitSkin.mock.calls[0] as unknown as [
      string,
      string,
      Buffer,
      Buffer,
    ];
    expect(Buffer.from(png).equals(VALID)).toBe(true);
    expect(Buffer.from(sha).equals(createHash('sha256').update(VALID).digest())).toBe(true);
  });

  it('a real PNG of the wrong size is refused 422 with the validator code bad_size and never reaches the store', async () => {
    const f = fakeStore();
    const base = await start(baseDeps({ routes: mountSkinRoutes(f.store) }));
    const r = await post(base, skinPng(64, 32));
    expect(r.status).toBe(422);
    expect(await r.text()).toContain('bad_size');
    expect(f.submitSkin).not.toHaveBeenCalled();
  });

  it('bytes that are not a PNG are refused 422 with the validator code not_png and never reach the store', async () => {
    const f = fakeStore();
    const base = await start(baseDeps({ routes: mountSkinRoutes(f.store) }));
    const r = await post(base, Buffer.from('this is plain text, not a skin'));
    expect(r.status).toBe(422);
    expect(await r.text()).toContain('not_png');
    expect(f.submitSkin).not.toHaveBeenCalled();
  });
});
