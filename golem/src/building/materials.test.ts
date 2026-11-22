import { describe, expect, it } from 'vitest';
import { countMaterials, dropOf, holdsToolKind, toolFor } from './materials.ts';

describe('toolFor', () => {
  it('picks the shovel for soft ground, the pickaxe for stone, the axe for wood, the hand otherwise', () => {
    expect(toolFor('dirt')).toBe('shovel');
    expect(toolFor('sand')).toBe('shovel');
    expect(toolFor('gravel')).toBe('shovel');
    expect(toolFor('stone')).toBe('pickaxe');
    expect(toolFor('cobblestone')).toBe('pickaxe');
    expect(toolFor('iron_ore')).toBe('pickaxe');
    expect(toolFor('oak_log')).toBe('axe');
    expect(toolFor('oak_planks')).toBe('axe');
    expect(toolFor('glass')).toBe('none');
    expect(toolFor('poppy')).toBe('none');
  });
});

describe('dropOf', () => {
  it('gives the item a broken block drops, which is the block itself for most', () => {
    expect(dropOf('stone')).toBe('cobblestone');
    expect(dropOf('grass_block')).toBe('dirt');
    expect(dropOf('dirt')).toBe('dirt');
    expect(dropOf('oak_planks')).toBe('oak_planks');
  });
});

describe('countMaterials', () => {
  it('sums the held stacks of one item and ignores the others', () => {
    const held = [
      { name: 'dirt', count: 3 },
      { name: 'stone', count: 5 },
      { name: 'dirt', count: 2 },
    ];
    expect(countMaterials(held, 'dirt')).toBe(5);
    expect(countMaterials(held, 'glass')).toBe(0);
    expect(countMaterials([], 'dirt')).toBe(0);
  });
});

describe('holdsToolKind', () => {
  it('needs no tool for the hand, and matches a tool by the kind at the end of its name', () => {
    expect(holdsToolKind([], 'none')).toBe(true);
    expect(holdsToolKind(['iron_pickaxe'], 'pickaxe')).toBe(true);
    expect(holdsToolKind(['iron_shovel'], 'pickaxe')).toBe(false);
    expect(holdsToolKind(['stone_axe', 'dirt'], 'axe')).toBe(true);
    expect(holdsToolKind([], 'shovel')).toBe(false);
  });
});
