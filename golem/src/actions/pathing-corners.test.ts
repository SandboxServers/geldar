import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { describe, expect, it, vi } from 'vitest';
import { ensurePathfinder } from './pathing.ts';

const { Movements } = pathfinderPkg;

/** Real block data for the version the pinned mineflayer supports, so the library's sets are real. */
const registry = minecraftData('1.21.4');

/** What a test block looks like to `getBlock`: the fields prismarine gives a block. */
interface Spec {
  name: string;
  boundingBox: 'block' | 'empty';
  shapes: number[][];
}

const SOLID = [[0, 0, 0, 1, 1, 1]];
const STONE: Spec = { name: 'stone', boundingBox: 'block', shapes: SOLID };
const CRAFTING: Spec = { name: 'crafting_table', boundingBox: 'block', shapes: SOLID };
const FENCE: Spec = {
  name: 'oak_fence',
  boundingBox: 'block',
  shapes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]],
};
const WALL: Spec = {
  name: 'cobblestone_wall',
  boundingBox: 'block',
  shapes: [[0.25, 0, 0.25, 0.75, 1.5, 0.75]],
};
const CARPET: Spec = {
  name: 'white_carpet',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 0.0625, 1]],
};
const empty = (name: string): Spec => ({ name, boundingBox: 'empty', shapes: [] });

/** A bot with a stone floor below y 64 and `placed` (keyed `x,y,z`) on top of it. */
function botWith(placed: Record<string, Spec>) {
  const block = (x: number, y: number, z: number) => {
    const spec = placed[`${x},${y},${z}`] ?? (y < 64 ? STONE : empty('air'));
    const type = registry.blocksByName[spec.name]?.id;
    if (type === undefined) throw new Error(`no such block ${spec.name}`);
    return {
      type,
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

const node = { x: 0, y: 64, z: 0, remainingBlocks: 0 };

/** A stub bot whose `loadPlugin` sets `bot.pathfinder`; `setMovements` records what it was given. */
function pathfinderBot(placed: Record<string, Spec>) {
  const setMovements = vi.fn();
  const bot = Object.assign(botWith(placed), {
    loadPlugin: vi.fn(() => {
      (bot as { pathfinder?: unknown }).pathfinder = { setMovements };
    }),
  });
  return { bot: bot as unknown as Bot, setMovements };
}

/**
 * The cells (`x,z`) one step from the origin node. `wired` runs `ensurePathfinder`'s Movements;
 * otherwise the library's own, to show the block is passable without the rule.
 */
function reach(placed: Record<string, Spec>, wired = true): string[] {
  const { bot, setMovements } = pathfinderBot(placed);
  let movements: { getNeighbors(n: typeof node): { x: number; z: number }[] };
  if (wired) {
    ensurePathfinder(bot);
    movements = setMovements.mock.calls[0]?.[0] as typeof movements;
  } else {
    const plain = new Movements(bot);
    plain.canDig = false;
    movements = plain as unknown as typeof movements;
  }
  return movements.getNeighbors(node).map((m) => `${m.x},${m.z}`);
}

describe('ensurePathfinder wiring', () => {
  it('hands setMovements a Movements whose diagonal move is wrapped', () => {
    const { bot, setMovements } = pathfinderBot({});
    ensurePathfinder(bot);
    const given = setMovements.mock.calls[0]?.[0] as { getMoveDiagonal: unknown };
    expect(given.getMoveDiagonal).not.toBe(Movements.prototype.getMoveDiagonal);
  });
});

describe('corner rule on real Movements', () => {
  const diagonal = '1,1';

  it('keeps the diagonal on an open field', () => {
    expect(reach({}, false)).toContain(diagonal);
    expect(reach({})).toContain(diagonal);
  });

  it('removes only the diagonal beside a crafting table, not the cardinal moves', () => {
    const placed = { '1,64,0': CRAFTING };
    expect(reach(placed, false)).toContain(diagonal);
    const cells = reach(placed);
    expect(cells).not.toContain(diagonal);
    expect(cells).toContain('0,1');
    expect(cells).toContain('-1,0');
  });

  it('forbids the diagonal for stone, a fence, a wall, fire and lava at the side cell', () => {
    for (const spec of [STONE, FENCE, WALL, empty('fire'), empty('lava')]) {
      expect(reach({ '0,64,1': spec }), spec.name).not.toContain(diagonal);
    }
  });

  it('keeps the diagonal over carpet, air and water at the side cells', () => {
    for (const spec of [CARPET, empty('air'), empty('water')]) {
      const placed = { '1,64,0': spec, '0,64,1': spec };
      expect(reach(placed), spec.name).toContain(diagonal);
    }
  });

  it('forbids the diagonal when a solid block overhangs a side cell at head height', () => {
    expect(reach({ '1,65,0': STONE })).not.toContain(diagonal);
    expect(reach({ '0,65,1': STONE })).not.toContain(diagonal);
  });
});
