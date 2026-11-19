import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { isOwnPlacement } from '../../actions/own-placements.ts';
import { ownerRecordAt } from '../../actions/protected-blocks.ts';
import { canSeeBlock } from '../../perception/notable-blocks.ts';
import { readField } from './farm-field.ts';

vi.mock('../../actions/own-placements.ts', () => ({ isOwnPlacement: vi.fn(() => false) }));
vi.mock('../../actions/protected-blocks.ts', () => ({ ownerRecordAt: vi.fn(() => null) }));
vi.mock('../../perception/notable-blocks.ts', () => ({ canSeeBlock: vi.fn(() => true) }));

interface Tile {
  name: string;
  age?: unknown;
}

/** A bot whose world is the given tiles (keyed by `x,y,z`); any other position is unloaded. */
function botWith(tiles: Map<string, Tile>, feet = new Vec3(0, 64, 0)): Bot {
  const read = (pos: Vec3) => {
    const tile = tiles.get(`${pos.x},${pos.y},${pos.z}`);
    if (!tile) return null;
    return {
      name: tile.name,
      position: pos,
      getProperties: () => ({ age: tile.age }),
    };
  };
  return {
    entity: { position: feet },
    blockAt: (pos: Vec3) => read(pos) as never,
  } as unknown as Bot;
}

/** A crop at (x, y, z) on farmland one block below it. */
function crop(
  tiles: Map<string, Tile>,
  x: number,
  y: number,
  z: number,
  name: string,
  age?: number,
) {
  tiles.set(`${x},${y - 1},${z}`, { name: 'farmland' });
  tiles.set(`${x},${y},${z}`, { name, age });
}

function states(bot: Bot, replant = true, radius = 12, maxCells = 16) {
  return readField(bot, radius, maxCells, replant).map((c) => [c.x, c.y, c.z, c.state]);
}

describe('readField', () => {
  it('reads ripe and unripe crops, and the ripeness threshold per crop', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 64, 0, 'wheat', 7);
    crop(tiles, 2, 64, 0, 'wheat', 6);
    crop(tiles, 3, 64, 0, 'beetroots', 3);
    crop(tiles, 4, 64, 0, 'beetroots', 2);
    expect(states(botWith(tiles))).toEqual([
      [1, 64, 0, 'ripe'],
      [2, 64, 0, 'unripe'],
      [3, 64, 0, 'ripe'],
      [4, 64, 0, 'unripe'],
    ]);
  });

  it('treats an unreadable age as unripe', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 64, 0, 'carrots', undefined);
    crop(tiles, 2, 64, 0, 'carrots', 'seven' as unknown as number);
    expect(states(botWith(tiles))).toEqual([
      [1, 64, 0, 'unripe'],
      [2, 64, 0, 'unripe'],
    ]);
  });

  it('leaves out a crop on anything but farmland, and any block that is not a crop', () => {
    const tiles = new Map<string, Tile>();
    tiles.set('1,63,0', { name: 'dirt' });
    tiles.set('1,64,0', { name: 'wheat', age: 7 });
    crop(tiles, 2, 64, 0, 'stone', 7);
    expect(states(botWith(tiles))).toEqual([]);
  });

  it('never reads an unloaded neighbour as a crop', () => {
    const tiles = new Map<string, Tile>();
    tiles.set('5,63,0', { name: 'farmland' });
    expect(states(botWith(tiles))).toEqual([]);
  });

  it('includes empty farmland only when replant is set', () => {
    const tiles = new Map<string, Tile>();
    tiles.set('1,63,0', { name: 'farmland' });
    tiles.set('1,64,0', { name: 'air' });
    const bot = botWith(tiles);
    expect(readField(bot, 12, 16, false)).toEqual([]);
    expect(states(bot, true)).toEqual([[1, 64, 0, 'empty']]);
  });

  it('reaches every axis and sign within the radius, and no further', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 4, 64, 0, 'wheat', 7);
    crop(tiles, -4, 64, 0, 'wheat', 7);
    crop(tiles, 0, 64, 4, 'wheat', 7);
    crop(tiles, 0, 64, -4, 'wheat', 7);
    crop(tiles, 0, 65, 0, 'wheat', 7);
    crop(tiles, 0, 61, 0, 'wheat', 7);
    crop(tiles, 5, 64, 0, 'wheat', 7);
    const found = readField(botWith(tiles), 4, 16).map((c) => [c.x, c.y, c.z]);
    expect(found).toEqual(
      expect.arrayContaining([
        [4, 64, 0],
        [-4, 64, 0],
        [0, 64, 4],
        [0, 64, -4],
        [0, 65, 0],
        [0, 61, 0],
      ]),
    );
    expect(found).toHaveLength(6);
  });

  it('caps the reach at FOOD_RANGE (24) even for a larger radius', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 24, 64, 0, 'wheat', 7);
    crop(tiles, 25, 64, 0, 'wheat', 7);
    expect(states(botWith(tiles), true, 24)).toEqual([[24, 64, 0, 'ripe']]);
  });

  it('keeps the nearest cells first and stops at max_cells', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 3, 64, 0, 'wheat', 7);
    crop(tiles, 1, 64, 0, 'wheat', 7);
    crop(tiles, 2, 64, 0, 'wheat', 7);
    expect(states(botWith(tiles), true, 12, 2)).toEqual([
      [1, 64, 0, 'ripe'],
      [2, 64, 0, 'ripe'],
    ]);
  });

  it('leaves out a crop that the Body cannot see', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 64, 0, 'wheat', 7);
    crop(tiles, 2, 64, 0, 'wheat', 7);
    vi.mocked(canSeeBlock).mockImplementation((_bot, block) => block.position.x !== 1);
    expect(states(botWith(tiles))).toEqual([[2, 64, 0, 'ripe']]);
    vi.mocked(canSeeBlock).mockImplementation(() => true);
  });

  it('marks own, other, world-generated and unknown cells', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 64, 0, 'wheat', 7);
    crop(tiles, 2, 64, 0, 'wheat', 7);
    crop(tiles, 3, 64, 0, 'wheat', 7);
    crop(tiles, 4, 64, 0, 'wheat', 7);
    vi.mocked(isOwnPlacement).mockImplementation((_bot, cell) => cell.x === 1);
    vi.mocked(ownerRecordAt).mockImplementation((pos) => {
      if (pos.x === 2) return { known: true, owner: 'other-player' };
      if (pos.x === 3) return { known: true, owner: null };
      return { known: false };
    });
    const owners = readField(botWith(tiles), 12, 16).map((c) => [c.x, c.owner]);
    expect(owners).toEqual([
      [1, 'own'],
      [2, 'other'],
      [3, 'own'],
      [4, 'unknown'],
    ]);
    vi.mocked(isOwnPlacement).mockImplementation(() => false);
    vi.mocked(ownerRecordAt).mockImplementation(() => null);
  });

  it('marks a cell unknown when the owner record cannot be read at all', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 64, 0, 'wheat', 7);
    vi.mocked(ownerRecordAt).mockImplementation(() => null);
    expect(readField(botWith(tiles), 12, 16).map((c) => c.owner)).toEqual(['unknown']);
  });

  it('reads three blocks above and below the feet and no further', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 67, 0, 'wheat', 7);
    crop(tiles, 2, 68, 0, 'wheat', 7);
    crop(tiles, 3, 61, 0, 'wheat', 7);
    crop(tiles, 4, 60, 0, 'wheat', 7);
    expect(states(botWith(tiles))).toEqual([
      [1, 67, 0, 'ripe'],
      [3, 61, 0, 'ripe'],
    ]);
  });

  it('ray-casts only a crop on farmland, never a block that is not a crop', () => {
    const tiles = new Map<string, Tile>();
    crop(tiles, 1, 64, 0, 'stone', 7);
    tiles.set('5,64,0', { name: 'stone' });
    vi.mocked(canSeeBlock).mockClear();
    expect(states(botWith(tiles))).toEqual([]);
    expect(canSeeBlock).not.toHaveBeenCalled();
  });
});
