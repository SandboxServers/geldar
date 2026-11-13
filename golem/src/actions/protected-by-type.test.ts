import { describe, expect, it } from 'vitest';
import { isBuiltName, refusedByName } from './protected-blocks.ts';

describe('the by-type list covers player redstone, lights and decor (0164, review N7)', () => {
  it.each([
    'lever',
    'stone_button',
    'oak_pressure_plate',
    'redstone_wire',
    'repeater',
    'comparator',
    'glowstone',
    'slime_block',
    'honey_block',
    'chain',
    'lightning_rod',
    'scaffolding',
  ])('treats %s as built material', (name) => {
    expect(isBuiltName(name)).toBe(true);
  });

  it.each(['end_portal_frame', 'barrier', 'structure_block', 'jigsaw', 'reinforced_deepslate'])(
    'refuses %s by name, whoever placed it',
    (name) => {
      expect(refusedByName(name)).toBe(true);
    },
  );
});
