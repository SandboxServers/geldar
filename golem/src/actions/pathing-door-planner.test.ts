import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { ensurePathfinder } from './pathing.ts';

/** Real block data for the version the pinned mineflayer supports. */
const registry = minecraftData('1.21.4');

interface Spec {
  name: string;
  boundingBox: 'block' | 'empty';
  shapes: number[][];
  props?: Record<string, unknown>;
}

const STONE: Spec = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] };
const AIR: Spec = { name: 'air', boundingBox: 'empty', shapes: [] };

/** One half of a door: prismarine's shape and the `half` and `open` properties. */
const door = (name: string, half: 'lower' | 'upper', open: boolean): Spec => ({
  name,
  boundingBox: 'block',
  shapes: [[0, 0, 0, 0.1875, 1, 1]],
  props: { half, open, facing: 'east' },
});

/** A world with a stone floor below y 64, the `cells` (keyed `x,y,z`) on top of it. */
function worldWith(cells: Record<string, Spec>) {
  const block = (x: number, y: number, z: number) => {
    const spec = cells[`${x},${y},${z}`] ?? (y < 64 ? STONE : AIR);
    const type = registry.blocksByName[spec.name]?.id;
    if (type === undefined) throw new Error(`no such block ${spec.name}`);
    return {
      type,
      boundingBox: spec.boundingBox,
      shapes: spec.shapes,
      position: { x, y, z },
      getProperties: () => spec.props ?? {},
    };
  };
  const setMovements = vi.fn();
  const bot = {
    registry,
    game: { minY: 0 },
    blockAt: (pos: { x: number; y: number; z: number }) => block(pos.x, pos.y, pos.z),
    loadPlugin: () => {
      (bot as unknown as { pathfinder: unknown }).pathfinder = { setMovements };
    },
  };
  return { bot: bot as unknown as Bot, setMovements };
}

const node = { x: 0, y: 64, z: 0, remainingBlocks: 0 };

/** The move `goto` plans one step east of the origin, or undefined when the planner drops it. */
function eastMove(cells: Record<string, Spec>) {
  const { bot, setMovements } = worldWith(cells);
  ensurePathfinder(bot);
  const movements = setMovements.mock.calls[0]?.[0] as {
    getNeighbors(
      n: typeof node,
    ): { x: number; z: number; toPlace: { x: number; y: number; z: number; useOne?: boolean }[] }[];
  };
  return movements.getNeighbors(node).find((m) => m.x === 1 && m.z === 0);
}

describe('goto plans through doors', () => {
  it('a closed oak door: the move exists and clicks the lower half open', () => {
    const move = eastMove({
      '1,64,0': door('oak_door', 'lower', false),
      '1,65,0': door('oak_door', 'upper', false),
    });
    expect(move).toBeDefined();
    expect(move?.toPlace.some((p) => p.useOne && p.x === 1 && p.y === 64 && p.z === 0)).toBe(true);
  });

  it('an open oak door: the move exists and does not click it shut', () => {
    const move = eastMove({
      '1,64,0': door('oak_door', 'lower', true),
      '1,65,0': door('oak_door', 'upper', true),
    });
    expect(move).toBeDefined();
    expect(move?.toPlace).toHaveLength(0);
  });

  it('a closed iron door: no move, it is a wall', () => {
    const move = eastMove({
      '1,64,0': door('iron_door', 'lower', false),
      '1,65,0': door('iron_door', 'upper', false),
    });
    expect(move).toBeUndefined();
  });
});
