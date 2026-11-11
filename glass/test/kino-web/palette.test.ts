import { describe, expect, it } from 'vitest';
import { cellIndex, decodePaletteIndices, encodePaletteIndices } from '../../web/kino/palette.ts';

const states = (n: number): string[] => Array.from({ length: n }, (_, i) => `minecraft:block_${i}`);

describe('palette-v1 decoding', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))('round-trips at %i bits', (bits) => {
    const n = 2 ** bits;
    const want = new Uint16Array(4096).map((_, i) => (i * 2654435761) % n);
    const data = encodePaletteIndices(want, bits);
    expect(Buffer.from(data, 'base64').length).toBe(Math.ceil((4096 * bits) / 8));
    const got = decodePaletteIndices({ palette: states(n), bits, data });
    expect([...got]).toEqual([...want]);
  });

  it('bits 0: one entry, every cell is it, data empty', () => {
    const got = decodePaletteIndices({ palette: ['minecraft:stone'], bits: 0, data: '' });
    expect(got.length).toBe(4096);
    expect(got.every((v) => v === 0)).toBe(true);
  });

  it('bits 0 rejects a second entry or data', () => {
    expect(() => decodePaletteIndices({ palette: ['a:b', 'a:c'], bits: 0, data: '' })).toThrow();
    expect(() => decodePaletteIndices({ palette: ['a:b'], bits: 0, data: 'AA==' })).toThrow();
  });

  it('reads least significant bit first from hand-built bytes', () => {
    // bits 2: cell 0 = 3 (bits 0-1 of byte 0), cell 1 = 1 (bits 2-3), cell 5 = 2 (bits 10-11 -> byte 1 bits 2-3)
    const bytes = new Uint8Array(1024);
    bytes[0] = 0b0000_0111;
    bytes[1] = 0b0000_1000;
    const got = decodePaletteIndices({
      palette: states(4),
      bits: 2,
      data: Buffer.from(bytes).toString('base64'),
    });
    expect([got[0], got[1], got[5], got[2]]).toEqual([3, 1, 2, 0]);
  });

  it('cell order is (y * 16 + z) * 16 + x', () => {
    expect(cellIndex(1, 0, 0)).toBe(1);
    expect(cellIndex(0, 0, 1)).toBe(16);
    expect(cellIndex(0, 1, 0)).toBe(256);
    expect(cellIndex(15, 15, 15)).toBe(4095);
  });

  it('rejects a bad length and an index outside the palette', () => {
    expect(() => decodePaletteIndices({ palette: states(2), bits: 1, data: 'AAAA' })).toThrow();
    const bytes = new Uint8Array(1024);
    bytes[0] = 0b11; // index 3 with a 2-entry palette at 2 bits
    expect(() =>
      decodePaletteIndices({
        palette: states(2),
        bits: 2,
        data: Buffer.from(bytes).toString('base64'),
      }),
    ).toThrow();
  });
});
