import { describe, expect, it } from 'vitest';
import { ghostMaterial } from '../../web/kino/agent-ghost.ts';
import { DEFAULT_ZOOM, ZOOM_LEVELS } from '../../web/kino/camera/lakitu.ts';
import { LABEL_MIN_CLAMP, labelClamp } from '../../web/kino/entities.ts';
import { makeWaterMaterial } from '../../web/kino/fade.ts';
import { isWater, meshSection, softOf, type UvLookup } from '../../web/kino/mesher.ts';

/** three's GreaterDepth constant (tests import no bare packages, see test/import-graph.test.ts). */
const GreaterDepth = 6;

const uv: UvLookup = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

function world(states: Record<string, string>) {
  return {
    stateAt: (x: number, y: number, z: number) => states[`${x},${y},${z}`] ?? 'minecraft:air',
  };
}

describe('the ghost draws only where the figure is occluded', () => {
  it('uses depth test GREATER and no depth write', () => {
    const m = ghostMaterial(0x00ffff);
    expect(m.depthTest).toBe(true);
    expect(m.depthFunc).toBe(GreaterDepth);
    expect(m.depthWrite).toBe(false);
  });
});

describe('water is its own blended pass', () => {
  const states = { '0,0,0': 'minecraft:water[level=0]', '1,0,0': 'minecraft:stone' };
  it('splits the faces by pass', () => {
    const w = world(states);
    expect(meshSection(w, 0, 0, 0, uv, 'water').indices.length).toBeGreaterThan(0);
    const solid = meshSection(w, 0, 0, 0, uv, 'solid');
    const water = meshSection(w, 0, 0, 0, uv, 'water');
    const all = meshSection(w, 0, 0, 0, uv, 'all');
    expect(solid.indices.length + water.indices.length).toBe(all.indices.length);
    expect(solid.soft?.every((s) => s === 0)).toBe(true);
  });
  it('does not dither water and blends it without depth write', () => {
    expect(isWater('minecraft:water[level=0]')).toBe(true);
    expect(isWater('minecraft:waterlogged_thing')).toBe(false);
    expect(softOf('minecraft:water[level=0]')).toBeLessThanOrEqual(0.25);
    expect(softOf('minecraft:oak_leaves[persistent=false]')).toBe(1);
    const m = makeWaterMaterial({} as never);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
  });
});

describe('label clamp and follow offset', () => {
  it('shrinks a close label, caps at 1 far away, and never reaches 0', () => {
    expect(labelClamp(2)).toBeCloseTo(0.208, 2);
    expect(labelClamp(50)).toBe(1);
    expect(labelClamp(0)).toBe(LABEL_MIN_CLAMP);
    expect(labelClamp(-3)).toBe(LABEL_MIN_CLAMP);
  });
  it('follows 6-8 blocks behind and 3-4 above at the default (medium) chase zoom', () => {
    const level = ZOOM_LEVELS[DEFAULT_ZOOM] as { distance: number; height: number };
    expect(level.distance).toBeGreaterThanOrEqual(6);
    expect(level.distance).toBeLessThanOrEqual(8);
    expect(level.height).toBeGreaterThanOrEqual(3);
    expect(level.height).toBeLessThanOrEqual(4);
  });
});
