import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import type { ItemStack } from './mine.ts';
import { mineAction } from './mine.ts';
import type { ActionContext } from './registry.ts';

// Shared by mine.test.ts and mine-drops.test.ts.

export interface FakeBlock {
  name?: string;
  type: number;
  position: Vec3;
  drops: number[];
  harvestTools: Record<number, boolean> | undefined;
  canHarvest(tool: number | null): boolean;
  /** `'empty'` for air: a drop falls through it. Solid blocks leave it unset. */
  boundingBox?: 'empty';
}

/** A block of `type` at `at`. It can be harvested bare-handed unless `harvestTools` says otherwise. */
export function block(
  type: number,
  at: Vec3,
  drops: number[],
  harvestTools?: Record<number, boolean>,
  name?: string,
): FakeBlock {
  return {
    ...(name ? { name } : {}),
    type,
    position: at,
    drops,
    harvestTools,
    canHarvest: (tool) => !harvestTools || (tool !== null && harvestTools[tool] === true),
  };
}

export const OAK_LOG = 17;
export const STONE = 1;
export const COBBLESTONE = 4;
export const BEDROCK = 7;
export const WATER = 9;
export const GRAVEL = 13;

/**
 * A fake bot with the parts `mine` reads. Digging clears the block and adds its drops to the
 * inventory at once, unless a test replaces `dig`.
 */
export function fakeBot(blocks: FakeBlock[], inventory: ItemStack[] = []) {
  const names: Record<number, string> = {
    [COBBLESTONE]: 'cobblestone',
    [OAK_LOG]: 'oak_log',
    270: 'wooden_pickaxe',
  };
  return {
    entity: { position: new Vec3(0, 64, 0) },
    /** Item entities in view; a test adds a drop here to steer the pickup walk. */
    entities: {} as Record<number, { name: string; position: Vec3 }>,
    time: { age: 0 },
    registry: {
      blocksByName: {
        oak_log: { id: OAK_LOG },
        stone: { id: STONE },
        bedrock: { id: BEDROCK },
        gravel: { id: GRAVEL },
      },
      items: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])),
    },
    inventory: { items: () => inventory },
    // As in Mineflayer, the matcher first sees each block type with a null position (the palette
    // probe), then every cell with its position.
    findBlocks: vi.fn(
      ({ matching, count }: { matching: (b: FakeBlock) => boolean; count: number }) => {
        for (const b of blocks) matching({ ...b, position: null } as unknown as FakeBlock);
        return blocks
          .filter((b) => matching(b))
          .slice(0, count)
          .map((b) => b.position);
      },
    ),
    blockAt: vi.fn((at: Vec3) => blocks.find((b) => b.position.equals(at)) ?? null),
    /** Within Mineflayer's dig reach; a test sets this to true to skip the walk. */
    canDigBlock: vi.fn((_target: FakeBlock | null): boolean => false),
    pathfinder: {
      bestHarvestTool: vi.fn((): null => null),
      stop: vi.fn(),
      setGoal: vi.fn(),
    },
    equip: vi.fn(async () => undefined),
    stopDigging: vi.fn(),
    waitForTicks: vi.fn(async (_ticks: number) => undefined),
    lookAt: vi.fn(async (_at: Vec3) => undefined),
    setControlState: vi.fn(),
    dig: vi.fn(async (target: FakeBlock) => {
      target.type = 0;
      for (const id of target.drops) inventory.push({ name: names[id] ?? '?', count: 1 });
    }),
  };
}

export type Fake = ReturnType<typeof fakeBot>;

export function ctxFor(bot: Fake, signal = new AbortController().signal): ActionContext {
  return { bot: bot as unknown as Bot, signal, timeScale: 1 };
}

export function mine(bot: Fake, count: number, name = 'oak_log', signal?: AbortSignal) {
  return mineAction.run(ctxFor(bot, signal), { do: 'mine', block: name, count });
}
