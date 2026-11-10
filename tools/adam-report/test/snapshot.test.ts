import { describe, expect, it } from 'vitest';
import { toLiteSnapshot } from '../src/snapshot.ts';
import { snap } from './fixture.ts';

describe('toLiteSnapshot reads the contract snapshot keys', () => {
  it('reads hunger, held_item and inventory from the self object', () => {
    const lite = toLiteSnapshot(
      snap({ hunger: 7, held: 'stone_pickaxe', inventory: [['cobblestone', 3]] }),
    );
    expect(lite).toEqual({
      hunger: 7,
      heldItem: 'stone_pickaxe',
      inventory: [{ item: 'cobblestone', count: 3 }],
    });
  });

  it('does not read top-level keys the Body does not write', () => {
    expect(toLiteSnapshot({ hunger: 7, heldItem: 'stone_pickaxe', inventory: [] })).toBeNull();
  });

  it('turns a non-numeric hunger, a non-string held item and a bad slot into null or dropped', () => {
    const raw = {
      self: {
        hunger: '7',
        held_item: null,
        inventory: [{ item: 'stick' }, { item: 'dirt', count: 2 }],
      },
    };
    expect(toLiteSnapshot(raw)).toEqual({
      hunger: null,
      heldItem: null,
      inventory: [{ item: 'dirt', count: 2 }],
    });
  });

  it('returns null for a value that is not an object', () => {
    expect(toLiteSnapshot('{"self":{}}')).toBeNull();
    expect(toLiteSnapshot(null)).toBeNull();
  });
});
