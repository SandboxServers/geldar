/**
 * The app icons under public/icons are generated (app-icon.ts): the sigil of "Glass" in the page's amber on
 * its dark ground. These tests hold the committed files to the generator, pixel for pixel, and the maskable
 * icon to the circle a launcher may crop it to.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIGIL_CELLS, sigilOf } from '../src/render-sigil.ts';
import { decodePng, encodePng, ICONS, iconPixels } from './app-icon.ts';

const committed = (file: string): Buffer =>
  readFileSync(new URL(`../public/icons/${file}`, import.meta.url));

/** The pixel at (x, y) as "r,g,b,a". */
function pixel(rgba: Uint8Array, size: number, x: number, y: number): string {
  return rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4).join(',');
}

const GROUND = '12,15,11,255';
const INK = '245,165,36,255';

describe('the app icons', () => {
  it.each(ICONS)('$file is the generated picture, pixel for pixel', (spec) => {
    const { size, rgba } = decodePng(committed(spec.file));
    expect(size).toBe(spec.size);
    expect(Buffer.from(rgba).equals(Buffer.from(iconPixels(spec)))).toBe(true);
  });

  it('use two colours only: the dark ground of the page and its amber', () => {
    for (const spec of ICONS) {
      const { size, rgba } = decodePng(committed(spec.file));
      const seen = new Set<string>();
      for (let i = 0; i < size * size; i += 97)
        seen.add(pixel(rgba, size, i % size, (i / size) | 0));
      expect([...seen].sort(), spec.file).toEqual([GROUND, INK]);
    }
  });

  it('draw the sigil of "Glass", centred', () => {
    const { cells } = sigilOf('Glass');
    for (const spec of ICONS) {
      const { size, rgba } = decodePng(committed(spec.file));
      const origin = (size - SIGIL_CELLS * spec.cell) / 2;
      expect(Number.isInteger(origin), spec.file).toBe(true);
      cells.forEach((lit, index) => {
        const x = origin + (index % SIGIL_CELLS) * spec.cell + spec.cell / 2;
        const y = origin + Math.floor(index / SIGIL_CELLS) * spec.cell + spec.cell / 2;
        expect(pixel(rgba, size, x, y), `${spec.file} cell ${index}`).toBe(lit ? INK : GROUND);
      });
      // The corners are ground: the sigil has a margin.
      expect(pixel(rgba, size, 0, 0)).toBe(GROUND);
      expect(pixel(rgba, size, size - 1, size - 1)).toBe(GROUND);
    }
  });

  it('keeps the maskable sigil inside the middle 80% circle a launcher may crop to', () => {
    const spec = ICONS.find((icon) => icon.file === 'maskable-512.png');
    expect(spec).toBeDefined();
    if (spec === undefined) return;
    const { size, rgba } = decodePng(committed(spec.file));
    const centre = (size - 1) / 2;
    let farthest = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (pixel(rgba, size, x, y) !== INK) continue;
        farthest = Math.max(farthest, Math.hypot(x - centre, y - centre));
      }
    }
    expect(farthest).toBeGreaterThan(size * 0.25);
    expect(farthest).toBeLessThan(size * 0.4);
  });

  it('round-trips through its own PNG writer and reader', () => {
    const rgba = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
    const png = encodePng(2, rgba);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(decodePng(png)).toEqual({ size: 2, rgba });
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/not a PNG/);
  });
});
