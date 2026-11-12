import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from './bot-types.ts';
import type { ActionContext } from './registry.ts';
import { digDownAllowed, unstick } from './unstick.ts';

type Grid = Map<string, string>;
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

function blockOf(grid: Grid, cell: Vec3): Block | null {
  const name = grid.get(key(cell.x, cell.y, cell.z)) ?? 'air';
  const boundingBox = name === 'air' || name === 'water' ? 'empty' : 'block';
  return { name, boundingBox, diggable: true, position: cell } as unknown as Block;
}

/**
 * A bot at (0, 70, 0) in a canopy: leaves at y 69 to 71 for |x|,|z| <= 2 except its own column's
 * feet and head cells. `ground` is the y of a stone floor (a deep fall or a shallow one);
 * `landing` puts leaves at y 68 so a stair step has something solid to land on.
 */
function canopy(ground: number, landing: boolean): Grid {
  const grid: Grid = new Map();
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      for (let y = 69; y <= 71; y++) grid.set(key(x, y, z), 'oak_leaves');
      if (landing) grid.set(key(x, 68, z), 'oak_leaves');
      grid.set(key(x, ground, z), 'stone');
    }
  }
  grid.delete(key(0, 70, 0));
  grid.delete(key(0, 71, 0));
  return grid;
}

function fakeBot(grid: Grid, health: number) {
  const dug: string[] = [];
  const cells: string[] = [];
  const controls: string[] = [];
  let dir = new Vec3(0, 0, 0);
  const bot = {
    health,
    entity: { position: new Vec3(0.5, 70, 0.5), height: 1.62 },
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
      cells.push(key(block.position.x, block.position.y, block.position.z));
      grid.delete(key(block.position.x, block.position.y, block.position.z));
    },
  };
  return { bot, dug, cells };
}

const ctxOf = (bot: unknown): ActionContext => ({
  bot: bot as Bot,
  signal: new AbortController().signal,
  timeScale: 1,
});

describe('digDownAllowed (health-aware)', () => {
  it('allows a short controlled fall at 2 health and refuses 3 blocks or more', () => {
    expect(digDownAllowed(2, { blocks: 1, lands: 'solid' })).toBe(true);
    expect(digDownAllowed(2, { blocks: 2, lands: 'solid' })).toBe(true);
    expect(digDownAllowed(2, { blocks: 3, lands: 'solid' })).toBe(false);
    expect(digDownAllowed(20, { blocks: 3, lands: 'solid' })).toBe(true);
    expect(digDownAllowed(20, { blocks: 7, lands: 'solid' })).toBe(false);
    expect(digDownAllowed(20, { blocks: 1, lands: 'unsafe' })).toBe(false);
    expect(digDownAllowed(20, { blocks: 1, lands: 'water' })).toBe(true);
  });
});

describe('unstick on a canopy', () => {
  it('digs down through the leaves under the feet at full health when the fall is survivable', async () => {
    const { bot, cells } = fakeBot(canopy(66, false), 20);
    const out = await unstick(ctxOf(bot));
    expect(out.status).toBe('completed');
    expect(out.detail.method).toBe('dig_down');
    expect(cells).toEqual([key(0, 69, 0)]);
    expect(out.detail.tried).toEqual(['walk', 'dig_down']);
  });

  it('stair-digs one block at a time at 2 health instead of digging down', async () => {
    const { bot, cells } = fakeBot(canopy(62, true), 2);
    const out = await unstick(ctxOf(bot));
    expect(out.status).toBe('completed');
    expect(out.detail.method).toBe('stair_dig');
    // The first step goes toward +x: head, feet and one below the feet of the next column.
    expect(cells.slice(0, 3)).toEqual([key(1, 71, 0), key(1, 70, 0), key(1, 69, 0)]);
    expect(out.detail.tried).toEqual(['walk', 'dig_down', 'stair_dig']);
  });

  it('refuses a stair step with no solid block under the landing and fails with what was tried', async () => {
    const { bot, cells } = fakeBot(canopy(62, false), 2);
    const out = await unstick(ctxOf(bot));
    expect(out.status).toBe('failed');
    expect(cells).toEqual([]);
    if (out.status === 'failed') {
      expect(out.message).toBe(
        'unstick: no way out found; tried walk, dig_down, stair_dig, dig_sideways',
      );
    }
  });

  it('refuses a stair step or a dig-down that would land on lava', async () => {
    const grid = canopy(62, false);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) grid.set(key(x, 68, z), 'lava');
    const { bot, cells } = fakeBot(grid, 2);
    const out = await unstick(ctxOf(bot));
    expect(out.status).toBe('failed');
    expect(cells).toEqual([]);
  });
});
