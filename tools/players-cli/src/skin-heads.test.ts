import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.ts';
import { makeRawPng, packRows } from './skin-fixture.ts';
import { offlineUuid, writeHeads } from './skin-heads.ts';

type Px = [number, number, number, number];

/** A synthetic RGBA skin: every pixel `base`, with `set` overrides keyed "x,y". */
function skin(height: number, base: Px, set: Record<string, Px> = {}): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + 64 * 4);
    for (let x = 0; x < 64; x++) Buffer.from(set[`${x},${y}`] ?? base).copy(row, 1 + x * 4);
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reads pixel (x, y) from a 32x32 RGBA head PNG written by the tool. */
function headPixel(png: Buffer, x: number, y: number): Px {
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    if (png.subarray(o + 4, o + 8).toString('latin1') === 'IDAT')
      idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  expect(png.readUInt32BE(16)).toBe(32);
  const i = y * (1 + 32 * 4) + 1 + x * 4;
  return [raw[i] ?? -1, raw[i + 1] ?? -1, raw[i + 2] ?? -1, raw[i + 3] ?? -1];
}

function setup(files: Record<string, Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'heads-'));
  const skins = join(root, 'skins');
  mkdirSync(skins);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(skins, name), bytes);
  return { skins, out: join(root, 'out') };
}

const FACE: Px = [10, 20, 30, 255];
const CLEAR: Px = [0, 0, 0, 0];

describe('offlineUuid', () => {
  it('matches the live server for ag_jason_01', () => {
    expect(offlineUuid('ag_jason_01')).toBe('a380937d-20dd-39b8-83ae-4219fa1c156d');
  });
});

describe('writeHeads', () => {
  it('lets an opaque hat pixel win and a transparent hat show the face', () => {
    const s = skin(64, CLEAR, {
      '8,8': FACE,
      '9,8': FACE,
      '40,8': [200, 100, 50, 255],
    });
    const { skins, out } = setup({ 'ag_jason_01.png': s });
    const lines = writeHeads(skins, out, 'overworld');
    expect(lines).toEqual(['ag_jason_01 a380937d-20dd-39b8-83ae-4219fa1c156d']);
    const file = join(
      out,
      'maps',
      'overworld',
      'assets',
      'playerheads',
      'a380937d-20dd-39b8-83ae-4219fa1c156d.png',
    );
    const png = readFileSync(file);
    expect(headPixel(png, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(headPixel(png, 3, 3)).toEqual([200, 100, 50, 255]);
    expect(headPixel(png, 4, 0)).toEqual(FACE);
    expect(headPixel(png, 7, 0)).toEqual(FACE);
  });

  it('reads a legacy 64x32 skin', () => {
    const { skins, out } = setup({ 'ag_old_01.png': skin(32, CLEAR, { '8,8': FACE }) });
    writeHeads(skins, out, 'overworld');
    const dir = join(out, 'maps', 'overworld', 'assets', 'playerheads');
    const [name] = readdirSync(dir);
    expect(headPixel(readFileSync(join(dir, name ?? '')), 0, 0)).toEqual(FACE);
  });

  it('refuses bad names, bad sizes and bad map ids', () => {
    expect(() =>
      writeHeads(setup({ 'Bad Name.png': skin(64, FACE) }).skins, '/x', 'overworld'),
    ).toThrow(/not a valid agent id/);
    const wrong = skin(64, FACE).subarray(0, 40);
    expect(() => writeHeads(setup({ 'ag_x_01.png': wrong }).skins, '/x', 'overworld')).toThrow();
    const ok = setup({ 'ag_x_01.png': skin(64, FACE) });
    expect(() => writeHeads(ok.skins, ok.out, '../etc')).toThrow(/map id/);
  });

  it('reads a 4-bit palette skin, and a transparent palette entry shows through', () => {
    // Index 1 is the hat pixel (40,8), index 2 is the face at x 8..11, index 0 (transparent) elsewhere.
    const at = (x: number, y: number) =>
      x === 40 && y === 8 ? 1 : x >= 8 && x < 12 && y >= 8 && y < 16 ? 2 : 0;
    const palette = Buffer.from([0, 0, 0, 200, 100, 50, 10, 20, 30]);
    const s = makeRawPng({
      width: 64,
      height: 64,
      colorType: 3,
      bitDepth: 4,
      rows: packRows(64, 64, 4, at),
      palette,
      trns: Buffer.from([0]),
    });
    const { skins, out } = setup({ 'ag_jason_01.png': s });
    writeHeads(skins, out, 'overworld');
    const file = join(
      out,
      'maps',
      'overworld',
      'assets',
      'playerheads',
      `${offlineUuid('ag_jason_01')}.png`,
    );
    const png = readFileSync(file);
    expect(headPixel(png, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(headPixel(png, 4, 0)).toEqual([10, 20, 30, 255]);
    expect(headPixel(png, 16, 0)).toEqual([0, 0, 0, 0]);
  });

  it('prints usage and exits 2 without the directories', async () => {
    const lines: string[] = [];
    const code = await runCli(['skin', 'heads'], { out: (l: string) => lines.push(l) } as never);
    expect(code).toBe(2);
    expect(lines[0]).toContain('usage');
  });
});
