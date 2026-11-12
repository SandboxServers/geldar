import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from './png.ts';

/** Reads the IDAT chunks back and inflates them: the PNG must carry exactly the pixels given. */
function decodeRaw(png: Buffer): Buffer {
  let at = 8;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('ascii');
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return inflateSync(Buffer.concat(idat));
}

describe('encodePng', () => {
  it('writes the signature, the size, and the exact pixels row by row', () => {
    const w = 3;
    const h = 2;
    const rgb = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const png = encodePng(rgb, w, h);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(w);
    expect(png.readUInt32BE(20)).toBe(h);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);
    const raw = decodeRaw(png);
    // Each row is a filter byte (0, none) followed by its pixels.
    expect([...raw]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('refuses pixel data that does not match the size', () => {
    expect(() => encodePng(new Uint8Array(5), 2, 1)).toThrow(RangeError);
  });
});
