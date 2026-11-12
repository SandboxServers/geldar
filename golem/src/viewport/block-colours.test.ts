import { describe, expect, it } from 'vitest';
import { blockName, colourFor, lookOf } from './block-colours.ts';

describe('baked block colours', () => {
  it('draws air as pass-through, water as see-through and stone as opaque', () => {
    expect(lookOf('minecraft:air').kind).toBe(0);
    expect(lookOf('minecraft:water').kind).toBe(2);
    expect(lookOf('minecraft:stone').kind).toBe(1);
  });

  it('strips the namespace and state properties before the colour lookup', () => {
    expect(blockName('minecraft:oak_log[axis=y]')).toBe('oak_log');
    expect(blockName('stone')).toBe('stone');
    expect(lookOf('minecraft:oak_log[axis=y]').rgb).toEqual(colourFor('oak_log'));
  });

  it('gives an unlisted block a stable, opaque colour from its name', () => {
    const a = lookOf('minecraft:mystery_block');
    expect(a.kind).toBe(1);
    expect(lookOf('minecraft:mystery_block').rgb).toEqual(a.rgb);
    expect(colourFor('mystery_block')).toEqual(a.rgb);
  });
});
