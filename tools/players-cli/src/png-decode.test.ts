import { describe, expect, it } from 'vitest';
import { SkinFileError } from './png.ts';
import { decodeSkinPng } from './png-decode.ts';
import { makeRawPng, packRows } from './skin-fixture.ts';

/** The RGBA pixel at (x, y) of a decoded skin. */
function at(decoded: { width: number; data: Buffer }, x: number, y: number): number[] {
  const o = (y * decoded.width + x) * 4;
  return [...decoded.data.subarray(o, o + 4)];
}

/** One scanline with filter type 1 (Sub) over the packed bytes, one byte per step. */
function subRow(bytes: number[]): Buffer {
  const row = Buffer.alloc(1 + bytes.length);
  row[0] = 1;
  bytes.forEach((v, i) => {
    row[1 + i] = (v - (bytes[i - 1] ?? 0)) & 0xff;
  });
  return row;
}

const PALETTE = Buffer.from([0, 0, 0, 200, 100, 50, 10, 20, 30]);
const cycle = (x: number, y: number) => (x + y) % 3;

describe('decodeSkinPng', () => {
  it('decodes a 4-bit palette skin, with tRNS making index 0 transparent', () => {
    const skin = makeRawPng({
      width: 64,
      height: 64,
      colorType: 3,
      bitDepth: 4,
      rows: packRows(64, 64, 4, cycle),
      palette: PALETTE,
      trns: Buffer.from([0]),
    });
    const decoded = decodeSkinPng(skin);
    expect([decoded.width, decoded.height]).toEqual([64, 64]);
    expect(at(decoded, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(decoded, 1, 0)).toEqual([200, 100, 50, 255]);
    expect(at(decoded, 2, 0)).toEqual([10, 20, 30, 255]);
  });

  it.each([1, 2, 8])('decodes a %i-bit palette skin with no tRNS as opaque', (depth) => {
    const n = 2 ** depth;
    const palette = Buffer.alloc(n * 3);
    for (let i = 0; i < n; i++) palette.set([i, 255 - i, 7], i * 3);
    const index = (x: number, y: number) => (x * 7 + y) % n;
    const decoded = decodeSkinPng(
      makeRawPng({
        width: 64,
        height: 64,
        colorType: 3,
        bitDepth: depth,
        rows: packRows(64, 64, depth, index),
        palette,
      }),
    );
    for (const [x, y] of [
      [5, 3],
      [63, 63],
      [0, 1],
    ] as const) {
      const i = index(x, y);
      expect(at(decoded, x, y)).toEqual([i, 255 - i, 7, 255]);
    }
  });

  it('undoes the Sub filter on packed 4-bit rows', () => {
    const rows = packRows(64, 64, 4, cycle).map((row) => subRow([...row.subarray(1)]));
    const decoded = decodeSkinPng(
      makeRawPng({ width: 64, height: 64, colorType: 3, bitDepth: 4, rows, palette: PALETTE }),
    );
    expect(at(decoded, 2, 0)).toEqual([10, 20, 30, 255]);
    expect(at(decoded, 3, 9)).toEqual([0, 0, 0, 255]);
  });

  it('refuses a palette index past the end of PLTE, and a palette skin without PLTE', () => {
    const past = packRows(64, 64, 4, (x) => (x === 0 ? 5 : 0));
    expect(() =>
      decodeSkinPng(
        makeRawPng({
          width: 64,
          height: 64,
          colorType: 3,
          bitDepth: 4,
          rows: past,
          palette: PALETTE,
        }),
      ),
    ).toThrow('palette index is out of range');
    expect(() =>
      decodeSkinPng(makeRawPng({ width: 64, height: 64, colorType: 3, bitDepth: 4, rows: past })),
    ).toThrow('needs a PLTE chunk');
  });

  it('decodes 8-bit grey with tRNS, and 8-bit grey+alpha', () => {
    const grey = makeRawPng({
      width: 64,
      height: 64,
      colorType: 0,
      bitDepth: 8,
      rows: packRows(64, 64, 8, (x) => x * 4),
      trns: Buffer.from([0, 12]),
    });
    const greyPixels = decodeSkinPng(grey);
    expect(at(greyPixels, 2, 0)).toEqual([8, 8, 8, 255]);
    expect(at(greyPixels, 3, 0)).toEqual([12, 12, 12, 0]);

    const rows = Array.from({ length: 64 }, () => Buffer.alloc(1 + 128));
    for (const row of rows) {
      for (let x = 0; x < 64; x++) {
        row[1 + 2 * x] = x * 4;
        row[2 + 2 * x] = 255 - x;
      }
    }
    const alpha = decodeSkinPng(
      makeRawPng({ width: 64, height: 64, colorType: 4, bitDepth: 8, rows }),
    );
    expect(at(alpha, 3, 0)).toEqual([12, 12, 12, 252]);
  });

  it('refuses 16-bit grey, tRNS on RGBA, an extra chunk and interlace', () => {
    const base = { width: 64, height: 64, rows: [] };
    expect(() => decodeSkinPng(makeRawPng({ ...base, colorType: 0, bitDepth: 16 }))).toThrow(
      'or a palette of 1, 2, 4 or 8 bits',
    );
    expect(() =>
      decodeSkinPng(makeRawPng({ ...base, colorType: 6, bitDepth: 8, trns: Buffer.from([0, 0]) })),
    ).toThrow('tRNS is not allowed');
    const text = { type: 'tEXt', data: Buffer.from('Author\u0000someone') };
    expect(() =>
      decodeSkinPng(makeRawPng({ ...base, colorType: 6, bitDepth: 8, extraChunks: [text] })),
    ).toThrow('may only contain IHDR, PLTE, tRNS, IDAT and IEND');
    expect(() =>
      decodeSkinPng(makeRawPng({ ...base, colorType: 6, bitDepth: 8, interlace: 1 })),
    ).toThrow(SkinFileError);
  });
});
