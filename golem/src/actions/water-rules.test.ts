import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { describe, expect, it, vi } from 'vitest';
import { ensurePathfinder } from './pathing.ts';
import { allowWaterExit, EXIT_COST } from './water-rules.ts';

const { Movements } = pathfinderPkg;

/** Real block data for the version the pinned mineflayer supports. */
const registry = minecraftData('1.21.4');

interface Spec {
  name: string;
  boundingBox: 'block' | 'empty';
  shapes: number[][];
}

const SOLID = [[0, 0, 0, 1, 1, 1]];
const STONE: Spec = { name: 'stone', boundingBox: 'block', shapes: SOLID };
const GRAVEL: Spec = { name: 'gravel', boundingBox: 'block', shapes: SOLID };
const MAGMA: Spec = { name: 'magma_block', boundingBox: 'block', shapes: SOLID };
const CACTUS: Spec = { name: 'cactus', boundingBox: 'block', shapes: SOLID };
const WATER: Spec = { name: 'water', boundingBox: 'empty', shapes: [] };
const AIR: Spec = { name: 'air', boundingBox: 'empty', shapes: [] };

/**
 * A fake world: stone below y 64 and air above, with `placed` (keyed `x,y,z`) on top. Every
 * cell is a plain block record, the fields prismarine gives a block.
 */
function botWith(placed: Record<string, Spec>) {
  const block = (x: number, y: number, z: number) => {
    const spec = placed[`${x},${y},${z}`] ?? (y < 64 ? STONE : AIR);
    const type = registry.blocksByName[spec.name]?.id;
    if (type === undefined) throw new Error(`no such block ${spec.name}`);
    return {
      type,
      name: spec.name,
      boundingBox: spec.boundingBox,
      shapes: spec.shapes,
      position: { x, y, z },
    };
  };
  return {
    registry,
    game: { minY: 0 },
    blockAt: (pos: { x: number; y: number; z: number }) => block(pos.x, pos.y, pos.z),
  };
}

/** A lake edge: the feet float in water at (0,64,0), the water under them at (0,63,0), and a bank
 * floor at (1,64,0) whose top is one block above the surface. */
const LAKE: Record<string, Spec> = {
  '0,64,0': WATER,
  '0,63,0': WATER,
  '1,64,0': STONE,
};

/** Feet at (0,64,0) in the water; the step goes towards +x. */
const feet = { x: 0, y: 64, z: 0, remainingBlocks: 0 };
const EAST = { x: 1, z: 0 };

/** The cells the library's jump-up adds for one step, with the bot wrapped or not. */
function jumpUps(placed: Record<string, Spec>, wrapped: boolean) {
  const bot = botWith(placed) as unknown as Bot;
  const movements = new Movements(bot);
  if (wrapped) allowWaterExit(movements, bot);
  const out: { x: number; y: number; z: number; cost: number }[] = [];
  movements.getMoveJumpUp(feet, EAST, out as never);
  return out.map(({ x, y, z, cost }) => ({ x, y, z, cost }));
}

describe('allowWaterExit (decision 0194 c)', () => {
  it('the library refuses a bank one block above the water without the wrap', () => {
    expect(jumpUps(LAKE, false)).toEqual([]);
  });

  it('with the wrap, a dry bank one block above the water is an exit onto the bank cell', () => {
    const exits = jumpUps(LAKE, true);
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ x: 1, y: 65, z: 0 });
  });

  it('prices the exit at EXIT_COST or more', () => {
    expect(jumpUps(LAKE, true)[0]?.cost).toBeGreaterThanOrEqual(EXIT_COST);
  });

  it('gives no exit from dry feet: the wrap applies only to a swim node', () => {
    const dryFeet = { ...LAKE, '0,64,0': AIR };
    expect(jumpUps(dryFeet, true)).toEqual([]);
  });

  it('gives no exit when a solid block fills the cell the Body steps into', () => {
    expect(jumpUps({ ...LAKE, '1,65,0': STONE }, true)).toEqual([]);
  });

  it('gives no exit when a falling block sits above the exit', () => {
    expect(jumpUps({ ...LAKE, '1,67,0': GRAVEL }, true)).toEqual([]);
  });

  it('gives no exit onto magma', () => {
    expect(jumpUps({ ...LAKE, '1,64,0': MAGMA }, true)).toEqual([]);
  });

  it('gives no exit onto cactus', () => {
    expect(jumpUps({ ...LAKE, '1,64,0': CACTUS }, true)).toEqual([]);
  });

  it('restores getBlock after the call, also when the step is refused', () => {
    const bot = botWith({ ...LAKE, '1,64,0': MAGMA }) as unknown as Bot;
    const movements = new Movements(bot);
    const before = movements.getBlock;
    allowWaterExit(movements, bot);
    movements.getMoveJumpUp(feet, EAST, [] as never);
    expect(movements.getBlock).toBe(before);
  });
});

describe('ensurePathfinder wires the exit into tier 1', () => {
  it('the planner it hands the pathfinder climbs out onto the bank', () => {
    const bot = Object.assign(botWith(LAKE), {
      loadPlugin: vi.fn(() => {
        (bot as { pathfinder?: unknown }).pathfinder = { setMovements };
      }),
    });
    const setMovements = vi.fn();
    ensurePathfinder(bot as unknown as Bot);
    const given = setMovements.mock.calls[0]?.[0] as {
      getMoveJumpUp: (n: typeof feet, d: typeof EAST, o: unknown[]) => void;
    };
    const out: { x: number; y: number; z: number }[] = [];
    given.getMoveJumpUp(feet, EAST, out as never);
    expect(out.map(({ x, y, z }) => ({ x, y, z }))).toEqual([{ x: 1, y: 65, z: 0 }]);
  });
});
