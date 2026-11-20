// CAP-4: each container case has its own block position (the take payloads' coordinates name the case). The offsets are
// a fixed table; these tests check that the table covers the block-placing cases, that no two cases share a cell (a
// double chest fills two), and that every cell is inside the arena platform with bot A's stance (2 blocks west).
import { describe, expect, it } from 'vitest';
import { CAPTURE_CASES, CASE_BLOCK_OFFSET, caseBlockPosition, findCase } from './capture-cases.ts';

const CENTRE = { x: 1312, z: 800 };
/** The platform's half width (arena.ts HALF_WIDTH): every block and bot A's stance must stay inside it. */
const HALF_WIDTH = 15;

/** The cells a case fills: its block, and the second half for the double chest. */
function cellsOf(id: keyof typeof CASE_BLOCK_OFFSET): Array<[number, number]> {
  const { x, z } = caseBlockPosition(id, CENTRE);
  return id === 'chest-double'
    ? [
        [x, z],
        [x + 1, z],
      ]
    : [[x, z]];
}

describe('CASE_BLOCK_OFFSET covers the block-placing cases', () => {
  it('names only cases that exist in the table', () => {
    for (const id of Object.keys(CASE_BLOCK_OFFSET)) {
      expect(findCase(id), id).toBeDefined();
    }
  });

  it('has every container case and none of the cases that place no container', () => {
    const containers = [
      'chest-single',
      'chest-double',
      'chest-shift-click',
      'chest-number-key',
      'furnace',
      'brewing-stand',
      'crafting-table',
      'anvil',
      'enchanting-table',
    ];
    expect(Object.keys(CASE_BLOCK_OFFSET).sort()).toEqual([...containers].sort());
    const others = CAPTURE_CASES.map((c) => c.id).filter((id) => !containers.includes(id));
    expect(others).toEqual([
      'toss',
      'break-coreprotect-absent',
      'break-coreprotect-present',
      'kill',
      'survived',
      'player-2x2',
    ]);
  });
});

describe('every container case has its own position', () => {
  it('no two cases share a cell (a double chest fills two cells)', () => {
    const seen = new Map<string, string>();
    for (const id of Object.keys(CASE_BLOCK_OFFSET) as Array<keyof typeof CASE_BLOCK_OFFSET>) {
      for (const [x, z] of cellsOf(id)) {
        const key = `${x},${z}`;
        expect(seen.get(key), `${id} and ${seen.get(key)} both at ${key}`).toBeUndefined();
        seen.set(key, id);
      }
    }
    expect(seen.size).toBe(10);
  });

  it('every cell and bot A stance (2 blocks west) is inside the arena platform', () => {
    for (const id of Object.keys(CASE_BLOCK_OFFSET) as Array<keyof typeof CASE_BLOCK_OFFSET>) {
      for (const [x, z] of cellsOf(id)) {
        expect(Math.abs(x - CENTRE.x), `${id} x`).toBeLessThanOrEqual(HALF_WIDTH);
        expect(Math.abs(x - 2 - CENTRE.x), `${id} stance x`).toBeLessThanOrEqual(HALF_WIDTH);
        expect(Math.abs(z - CENTRE.z), `${id} z`).toBeLessThanOrEqual(HALF_WIDTH);
      }
    }
  });
});

describe('caseBlockPosition adds the case offset to the centre', () => {
  it('places the single chest, the double chest and the anvil at their own cells', () => {
    expect(caseBlockPosition('chest-single', CENTRE)).toEqual({ x: 1314, z: 800 });
    expect(caseBlockPosition('chest-double', CENTRE)).toEqual({ x: 1316, z: 800 });
    expect(caseBlockPosition('anvil', CENTRE)).toEqual({ x: 1316, z: 802 });
  });
});
