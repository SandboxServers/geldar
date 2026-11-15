import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Block } from './bot-types.ts';
import { recordOwnPlacement } from './own-placements.ts';
import { setOwnerLookup } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import { EIGHT, unstick } from './unstick.ts';

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Blocks a bare hand cannot drop: stone needs a pickaxe. */
const NEEDS_TOOL = new Set(['stone']);
/** Blocks no hand breaks (hardness -1). `void_rock` is not on the refused-name list: only its hardness refuses it. */
const UNBREAKABLE = new Set(['bedrock', 'void_rock']);
/** Hardness of the blocks the budget tests need heavier than stone (1.5); obsidian is 50 in the game. */
const HARD: Record<string, number> = { obsidian: 50 };

/**
 * A block grid: unlisted cells are air (empty), `water` is empty-boxed, the rest are solid. `bedrock` has
 * hardness -1 (no hand breaks it); `stone` lists a harvest tool (a bare hand digs it and drops nothing).
 */
function blockOf(grid: Grid, cell: Vec3): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  if (name === 'unloaded') return null;
  const boundingBox = name === 'air' || name === 'water' ? 'empty' : 'block';
  const hardness = UNBREAKABLE.has(name) ? -1 : (HARD[name] ?? 1.5);
  const harvestTools = NEEDS_TOOL.has(name) ? { 270: true } : undefined;
  return {
    name,
    boundingBox,
    diggable: true,
    hardness,
    harvestTools,
    position: cell,
  } as unknown as Block;
}

/** The island: one block under the feet at y 63 and nothing else, so every side is a deep drop. */
function island(): Grid {
  return new Map([[key(0, 63, 0), 'stone']]);
}

function fakeBot(grid: Grid, health = 20) {
  const dug: string[] = [];
  const controls: string[] = [];
  let dir = new Vec3(0, 0, 0);
  const bot = {
    health,
    game: { dimension: 'minecraft:the_nether' },
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.62 },
    blockAt: (cell: Vec3) => blockOf(grid, cell),
    async lookAt(target: Vec3) {
      dir = new Vec3(
        target.x - bot.entity.position.x,
        0,
        target.z - bot.entity.position.z,
      ).normalize();
    },
    setControlState(name: string, on: boolean) {
      controls.push(`${name}:${on}`);
    },
    async waitForTicks() {
      if (controls.findLast((c) => c.startsWith('forward:')) !== 'forward:true') return;
      const next = bot.entity.position.plus(dir.scaled(0.3));
      const feet = next.floored();
      const free = [feet, feet.offset(0, 1, 0)].every(
        (cell) => blockOf(grid, cell)?.boundingBox === 'empty',
      );
      if (free) bot.entity.position = next;
    },
    async dig(block: Block) {
      dug.push(block.name);
      grid.delete(key(block.position.x, block.position.y, block.position.z));
    },
    placeBlock() {
      throw new Error('unstick must place no blocks');
    },
  };
  return { bot, dug };
}

function ctxOf(bot: unknown, signal = new AbortController().signal): ActionContext {
  return { bot: bot as Bot, signal, timeScale: 1 };
}

/** The island with a ring of `ring(dir)` at head and feet level on all eight sides: the bot is boxed in. */
function boxedIn(ring: (dir: Vec3) => string): Grid {
  const grid = island();
  for (const dir of EIGHT) {
    grid.set(key(dir.x, 63, dir.z), 'stone');
    for (const y of [64, 65]) grid.set(key(dir.x, y, dir.z), ring(dir));
  }
  return grid;
}

const ownedBy = (owner: string | null) => setOwnerLookup(() => ({ known: true, owner }));

const EAST = new Vec3(1, 0, 0);
const WEST = new Vec3(-1, 0, 0);

describe('own placements are dug last (decision 0330)', () => {
  afterEach(() => setOwnerLookup(null));

  /** The boxed-in ring from `ring`; each built block it names as oak_planks is recorded as this bot's own. */
  function ownRing(ring: (dir: Vec3) => string) {
    const { bot, dug } = fakeBot(boxedIn(ring));
    for (const dir of EIGHT) {
      for (const y of [64, 65]) {
        if (ring(dir) === 'oak_planks') {
          recordOwnPlacement(bot as unknown as Bot, new Vec3(dir.x, y, dir.z), 'oak_planks');
        }
      }
    }
    return { bot, dug };
  }

  it('does not dig its own plank while a natural block is a way out', async () => {
    ownedBy(null);
    const { bot, dug } = ownRing((dir) => (dir.equals(EAST) ? 'stone' : 'oak_planks'));
    await unstick({ ...ctxOf(bot), ownPlanksLast: true });
    expect(dug).toContain('stone');
    expect(dug).not.toContain('oak_planks');
  });

  it('digs its own plank only when no other way out exists', async () => {
    ownedBy(null);
    const { bot, dug } = ownRing(() => 'oak_planks');
    const outcome = await unstick({ ...ctxOf(bot), ownPlanksLast: true });
    expect(dug).toContain('oak_planks');
    expect(JSON.stringify(outcome)).toContain('dig_own');
  });

  it('steps off onto an open cell before it digs its own plank', async () => {
    ownedBy(null);
    const { bot, dug } = ownRing((dir) => (dir.equals(WEST) ? 'air' : 'oak_planks'));
    const outcome = await unstick({ ...ctxOf(bot), ownPlanksLast: true });
    expect(dug).toEqual([]);
    expect(JSON.stringify(outcome)).toContain('step');
  });
});
