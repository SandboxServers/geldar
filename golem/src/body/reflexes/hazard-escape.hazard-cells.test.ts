import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { findLateralExit, findSafeBlock } from './hazard-escape.ts';

type Block = { name: string; boundingBox: string };
const STONE: Block = { name: 'stone', boundingBox: 'block' };
const WATER: Block = { name: 'water', boundingBox: 'empty' };
const AIR: Block = { name: 'air', boundingBox: 'empty' };
const origin = new Vec3(0.5, 60.2, 0.5);

/** Stone everywhere except the listed cells, keyed "x,y,z". */
function worldOf(cells: Record<string, Block>) {
  return (x: number, y: number, z: number): Block => cells[`${x},${y},${z}`] ?? STONE;
}

/** The origin column (water y 58..61) under a stone cap at y 62, and a water corridor at y 60..61 west to a lake at x -6. */
function westLake(): Record<string, Block> {
  const cells: Record<string, Block> = {};
  for (let y = 58; y <= 61; y++) cells[`0,${y},0`] = WATER;
  for (let k = 1; k < 6; k++) for (const y of [60, 61]) cells[`${-k},${y},0`] = WATER;
  for (const y of [60, 61]) cells[`-6,${y},0`] = WATER;
  for (const y of [62, 63]) cells[`-6,${y},0`] = AIR;
  return cells;
}

describe('findSafeBlock: a lava or fire cell is never a stand', () => {
  // A hazard cell at the feet, air over it and stone under it: it passes isSafeStand unless it is a hazard.
  it.each(['lava', 'fire'])(
    'skips a %s cell at the feet and takes the dry stand beside it',
    (name) => {
      const cells: Record<string, Block> = {
        '0,60,0': { name, boundingBox: 'empty' },
        '0,61,0': AIR,
        '1,60,0': AIR,
        '1,61,0': AIR,
      };
      expect(findSafeBlock(worldOf(cells), { x: 0, y: 60, z: 0 })).toEqual({ x: 1, y: 60, z: 0 });
    },
  );
});

describe('findLateralExit: fire at the feet is a wall, as lava is', () => {
  // The east corridor's first two cells burn; a dry shaft 2 cells east is reachable only through them.
  it.each(['fire', 'soul_fire'])(
    'does not swim through %s at feet level to a shaft 2 cells east',
    (name) => {
      const cells = westLake();
      for (const y of [60, 61]) cells[`1,${y},0`] = { name, boundingBox: 'empty' };
      for (let y = 60; y <= 63; y++) cells[`2,${y},0`] = AIR;
      expect(findLateralExit(worldOf(cells), origin)).toMatchObject({
        x: -6,
        direction: 'west',
        distance: 6,
      });
    },
  );
});
