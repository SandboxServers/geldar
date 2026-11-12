import { describe, expect, it } from 'vitest';
import { pitScene } from './fixtures.ts';
import { encodePng } from './png.ts';
import { renderViewport } from './render.ts';

const eye = { x: 4.5, y: 65.62, z: 4.5 };
const east = (-90 * Math.PI) / 180;

describe('viewport knowledge boundary', () => {
  it('an entity behind a wall does not change a single pixel', () => {
    const { world, entities } = pitScene();
    const with_ = renderViewport(world, eye, east, 0, entities, { width: 80, height: 45 });
    const without = renderViewport(world, eye, east, 0, [], { width: 80, height: 45 });
    expect(Buffer.from(with_.rgb).equals(Buffer.from(without.rgb))).toBe(true);
  });

  it('the same entity in the open does change pixels', () => {
    const { world } = pitScene();
    const zombie = { type: 'zombie', x: 4.5, y: 64, z: 1.0, width: 0.6, height: 1.95 };
    const a = renderViewport(world, { x: 4.5, y: 65.62, z: 5.5 }, 0, 0, [zombie], {
      width: 80,
      height: 45,
    });
    const b = renderViewport(world, { x: 4.5, y: 65.62, z: 5.5 }, 0, 0, [], {
      width: 80,
      height: 45,
    });
    expect(Buffer.from(a.rgb).equals(Buffer.from(b.rgb))).toBe(false);
  });

  it('unloaded space renders as sky only, never as blocks', () => {
    const empty = { stateAt: () => undefined };
    const img = renderViewport(empty, eye, 0, -0.5, [], { width: 40, height: 20 });
    const sameAsSky = renderViewport(empty, eye, 0, -0.5, [], { width: 40, height: 20 });
    expect(Buffer.from(img.rgb).equals(Buffer.from(sameAsSky.rgb))).toBe(true);
    for (let i = 0; i < img.rgb.length; i += 3)
      expect(img.rgb[i + 2] as number).toBeGreaterThan(200);
  });

  it('writes a valid PNG', () => {
    const png = encodePng(new Uint8Array(4 * 4 * 3), 4, 4);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
