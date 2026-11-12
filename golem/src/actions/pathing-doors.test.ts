import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { describe, expect, it, vi } from 'vitest';
import { ensurePathfinder, planReach } from './pathing.ts';

const { Movements } = pathfinderPkg;

/** Real block data for the version the pinned mineflayer supports. */
const registry = minecraftData('1.21.4');

interface Spec {
  name: string;
  boundingBox: 'block' | 'empty';
  shapes: number[][];
}

const STONE: Spec = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] };
const OAK_DOOR: Spec = {
  name: 'oak_door',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 0.1875, 1, 1]],
};
const IRON_DOOR: Spec = {
  name: 'iron_door',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 0.1875, 1, 1]],
};

/** A bot with a stone floor below y 64 and `placed` (keyed `x,y,z`) on top of it. */
function botWith(placed: Record<string, Spec>) {
  const block = (x: number, y: number, z: number) => {
    const spec =
      placed[`${x},${y},${z}`] ??
      (y < 64 ? STONE : { name: 'air', boundingBox: 'empty', shapes: [] });
    const type = registry.blocksByName[spec.name]?.id;
    if (type === undefined) throw new Error(`no such block ${spec.name}`);
    return { type, boundingBox: spec.boundingBox, shapes: spec.shapes, position: { x, y, z } };
  };
  return {
    registry,
    game: { minY: 0 },
    blockAt: (pos: { x: number; y: number; z: number }) => block(pos.x, pos.y, pos.z),
  };
}

const node = { x: 0, y: 64, z: 0, remainingBlocks: 0 };

/** A stub bot whose `loadPlugin` sets a pathfinder that records the movements it is given. */
function pathfinderBot(
  placed: Record<string, Spec>,
  search = vi.fn((_movements: unknown, _goal: unknown) => ({ status: 'success', path: [] })),
) {
  const setMovements = vi.fn((m: unknown) => {
    (bot as unknown as { pathfinder: { movements?: unknown } }).pathfinder.movements = m;
  });
  const bot = Object.assign(botWith(placed), {
    loadPlugin: vi.fn(() => {
      (bot as { pathfinder?: unknown }).pathfinder = {
        setMovements,
        movements: undefined,
        getPathTo: search,
      };
    }),
  });
  return { bot: bot as unknown as Bot, setMovements, search };
}

const OAK_DOOR_ID = registry.blocksByName.oak_door?.id;
const IRON_DOOR_ID = registry.blocksByName.iron_door?.id;

/** The flag the planner reads for the cell one step east of the origin node. */
function eastIsOpenable(placed: Record<string, Spec>): boolean {
  const { bot, setMovements } = pathfinderBot(placed);
  ensurePathfinder(bot);
  const movements = setMovements.mock.calls[0]?.[0] as {
    getBlock(n: typeof node, dx: number, dy: number, dz: number): { openable: boolean };
  };
  return movements.getBlock(node, 1, 0, 0).openable;
}

describe('goto opens doors', () => {
  it('sets canOpenDoors on the movements goto uses', () => {
    const { bot, setMovements } = pathfinderBot({});
    ensurePathfinder(bot);
    const given = setMovements.mock.calls[0]?.[0] as { canOpenDoors: boolean };
    expect(given.canOpenDoors).toBe(true);
  });

  it('marks a closed wooden door openable, which the library alone does not', () => {
    expect(new Movements(pathfinderBot({}).bot).canOpenDoors).toBe(false);
    expect(eastIsOpenable({ '1,64,0': OAK_DOOR })).toBe(true);
  });

  it('keeps an iron door a wall: it is not in the openable set', () => {
    const { bot, setMovements } = pathfinderBot({});
    ensurePathfinder(bot);
    const given = setMovements.mock.calls[0]?.[0] as { openable: Set<number> };
    expect(given.openable.has(IRON_DOOR_ID ?? -1)).toBe(false);
    expect(given.openable.has(OAK_DOOR_ID ?? -1)).toBe(true);
    expect(eastIsOpenable({ '1,64,0': IRON_DOOR })).toBe(false);
  });
});

describe('planReach opens doors', () => {
  const target = { x: 5, y: 64, z: 5 };

  it('plans with canOpenDoors when it does not dig', () => {
    const { bot, search } = pathfinderBot({});
    planReach(bot, target, false);
    const used = search.mock.calls[0]?.[0] as { canOpenDoors: boolean; openable: Set<number> };
    expect(used.canOpenDoors).toBe(true);
    expect(used.openable.has(OAK_DOOR_ID ?? -1)).toBe(true);
  });

  it('plans its own digging movements with canOpenDoors too', () => {
    const { bot, search } = pathfinderBot({});
    planReach(bot, target, true);
    const used = search.mock.calls[0]?.[0] as {
      canDig: boolean;
      canOpenDoors: boolean;
      openable: Set<number>;
    };
    expect(used.canDig).toBe(true);
    expect(used.canOpenDoors).toBe(true);
    expect(used.openable.has(OAK_DOOR_ID ?? -1)).toBe(true);
    expect(used.openable.has(IRON_DOOR_ID ?? -1)).toBe(false);
  });
});
