import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { defaultBlock, registry } from './door-blocks.fakes.ts';
import { applyDigRules, DigTally } from './goto-dig.ts';
import { isOwnPlacement } from './own-placements.ts';
import { planReach } from './pathing.ts';
import { edgeCell } from './pillar.ts';

/**
 * The tier-2 hooks that the real library and the real helpers run through (decision 0164): the
 * pillar's headroom refusal, the tally's own-scaffold record, the plan for a reach, and the
 * `safeToBreak` that `applyDigRules` installs on a real `Movements`.
 */

const { Movements } = pathfinderPkg;

/** A world of air with the cells in `solid` (`x,y,z` to a block name). */
function world(solid: Record<string, string>) {
  return (pos: Vec3) => {
    const name = solid[`${pos.x},${pos.y},${pos.z}`] ?? 'air';
    // A real prismarine block (shapes and flags), so the library's own reads work on it.
    const block = defaultBlock(name);
    block.position = pos;
    return block;
  };
}

/** A body standing at (0.5, 65, 0.5) over the column x=0, z=0, reading `solid` for its world. */
function body(solid: Record<string, string>, extra: Record<string, unknown> = {}): Bot {
  return Object.assign(
    new EventEmitter(),
    {
      username: 'self',
      registry,
      version: '26.1',
      health: 20,
      entities: {},
      entity: { position: new Vec3(0.5, 65, 0.5) },
      blockAt: world(solid),
    },
    extra,
  ) as never as Bot;
}

describe('pillar headroom refuses a protected ceiling (0164, review N4)', () => {
  it('a player-built block two cells above the edge refuses that edge', () => {
    // The edge cell (1,64,0) has solid ground under it and open air at its feet and head; the
    // ceiling two cells up is the player's planks.
    const bot = body({ '1,63,0': 'stone', '1,66,0': 'oak_planks' });
    expect(edgeCell(bot, new Vec3(0, 64, 0), true)).toBeNull();
    expect(edgeCell(bot, new Vec3(0, 64, 0))).toEqual(new Vec3(1, 64, 0));
  });

  it('a clear ceiling keeps the same edge', () => {
    const bot = body({ '1,63,0': 'stone' });
    expect(edgeCell(bot, new Vec3(0, 64, 0), true)).toEqual(new Vec3(1, 64, 0));
  });
});

describe('the tally records the scaffold the walk places (0164, review F10)', () => {
  it('a placement the walk makes is the bot own work, at the cell it filled', async () => {
    const bot = body({});
    const placed = vi.fn(async () => undefined);
    Object.assign(bot, { placeBlock: placed, heldItem: { name: 'cobblestone' } });
    const emitter = bot as unknown as { placeBlock: (...args: unknown[]) => Promise<unknown> };
    const tally = new DigTally();
    tally.start(bot);
    await emitter.placeBlock({ position: new Vec3(0, 63, 0) }, new Vec3(0, 1, 0));
    tally.stop();
    expect(placed).toHaveBeenCalledTimes(1);
    expect(tally.placed).toEqual(['cobblestone']);
    expect(isOwnPlacement(bot, { x: 0, y: 64, z: 0 })).toBe(true);
    expect(isOwnPlacement(bot, { x: 0, y: 65, z: 0 })).toBe(false);
  });
});

describe('planReach plans with the plain movements (0164, review F11)', () => {
  it('a reach plan after a digging walk does not use the digging movements', () => {
    const getPathTo = vi.fn((_movements: unknown, _goal: unknown) => ({
      status: 'success',
      path: [],
      visitedNodes: 1,
    }));
    const digging = { canDig: true, allow1by1towers: true, marker: 'tier two' };
    const pathfinder = {
      movements: undefined as unknown,
      setMovements: vi.fn(),
      getPathTo,
      thinkTimeout: 0,
      tickTimeout: 0,
    };
    // The first plan loads the plugin (which sets the plain movements); a later walk then leaves
    // its digging movements on the pathfinder.
    const bot = body({}, { loadPlugin: () => Object.assign(bot, { pathfinder }) });
    planReach(bot, { x: 5, y: 64, z: 5 }, false);
    pathfinder.movements = digging;
    planReach(bot, { x: 5, y: 64, z: 5 }, false);
    const used = getPathTo.mock.calls[1]?.[0];
    expect(used).toBeDefined();
    expect(used).not.toBe(digging);
  });
});

describe('safeToBreak on a real Movements (0164, review F3)', () => {
  it('refuses a player-built plank and allows natural stone', () => {
    const solid = {
      '0,64,0': 'stone',
      '0,63,0': 'stone',
      '0,62,0': 'stone',
      '0,61,0': 'stone',
    };
    const bot = body(solid);
    const m = new Movements(bot) as unknown as Record<string, unknown>;
    applyDigRules(m, bot);
    const safeToBreak = m.safeToBreak as (block: unknown) => boolean;
    const plank = {
      name: 'oak_planks',
      type: registry.blocksByName.oak_planks?.id,
      position: new Vec3(1, 64, 0),
    };
    const stone = {
      name: 'stone',
      type: registry.blocksByName.stone?.id,
      position: new Vec3(0, 64, 0),
    };
    expect(safeToBreak(plank)).toBe(false);
    expect(safeToBreak(stone)).toBe(true);
  });
});
