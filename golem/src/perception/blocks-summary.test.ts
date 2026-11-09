import { describe, expect, it } from 'vitest';
import { compass, summarizeBlocks } from './blocks-summary.ts';

describe('compass', () => {
  // Minecraft: north is -z, south +z, east +x, west -x. Every axis and both signs.
  it.each([
    [0, -5, 'north'],
    [0, 5, 'south'],
    [5, 0, 'east'],
    [-5, 0, 'west'],
    [5, -5, 'north_east'],
    [5, 5, 'south_east'],
    [-5, 5, 'south_west'],
    [-5, -5, 'north_west'],
  ])('offset (%d, %d) is %s', (dx, dz, expected) => {
    expect(compass(dx, dz)).toBe(expected);
  });

  it('puts a mostly-north offset on north and a mostly-east one on east', () => {
    expect(compass(1, -10)).toBe('north');
    expect(compass(-1, 10)).toBe('south');
    expect(compass(10, 1)).toBe('east');
    expect(compass(-10, -1)).toBe('west');
  });

  it('says here when the offset is under half a block on both axes', () => {
    expect(compass(0.3, -0.4)).toBe('here');
    expect(compass(0.6, 0)).toBe('east');
  });
});

const ORIGIN = { x: 0.5, y: 64, z: 0.5 };

describe('summarizeBlocks', () => {
  it('is empty for no blocks', () => {
    expect(summarizeBlocks(ORIGIN, [])).toBe('');
  });

  it('writes a single block as kind, distance and direction', () => {
    expect(summarizeBlocks(ORIGIN, [{ type: 'chest', x: 3, y: 64, z: 0 }])).toBe('chest 3 east');
  });

  it('writes several of a kind with a count and the nearest', () => {
    const logs = Array.from({ length: 12 }, (_, i) => ({
      type: 'oak_log',
      x: 0,
      y: 64,
      z: -7 - i,
    }));
    expect(summarizeBlocks(ORIGIN, logs)).toBe('oak_log x12, nearest 7 north');
  });

  it('orders kinds by distance, then by name, and joins them with a semicolon', () => {
    const text = summarizeBlocks(ORIGIN, [
      { type: 'water', x: 0, y: 64, z: 9 },
      { type: 'white_bed', x: -9, y: 64, z: 0 },
      { type: 'chest', x: 2, y: 64, z: 0 },
      { type: 'barrel', x: 0, y: 64, z: -12 },
    ]);
    expect(text).toBe('chest 2 east; water 9 south; white_bed 9 west; barrel 12 north');
  });

  it('names a diagonal with a hyphen', () => {
    expect(summarizeBlocks(ORIGIN, [{ type: 'furnace', x: -4, y: 64, z: -4 }])).toBe(
      'furnace 6 north-west',
    );
  });

  it('is byte-stable: the input order and repeated calls give the same bytes', () => {
    const blocks = [
      { type: 'chest', x: 4, y: 64, z: 0 },
      { type: 'barrel', x: -4, y: 64, z: 0 },
      { type: 'oak_log', x: 0, y: 64, z: 4 },
      { type: 'oak_log', x: 0, y: 64, z: -4 },
    ];
    const first = summarizeBlocks(ORIGIN, blocks);
    expect(summarizeBlocks(ORIGIN, [...blocks].reverse())).toBe(first);
    expect(summarizeBlocks(ORIGIN, blocks)).toBe(first);
    // Equal distances: the kind name decides, and the nearest of a kind is chosen by coordinates.
    expect(first).toBe('barrel 4 west; chest 4 east; oak_log x2, nearest 4 north');
  });
});
