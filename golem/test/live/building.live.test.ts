import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import { withLiveBot } from './fixture.ts';

/**
 * BLD-28: the break and plan verbs on the real Paper path. Written, not run here: it needs the
 * shard with `body_actions.building` on, so it runs only with `GELDAR_IT=1` (the live lane,
 * `pnpm --filter @geldar/golem test:live`). Bots play survival: the Body's own breaks, places and
 * plan lane make every edit. The server's `setblock` only sets up a cell and perturbs one cell.
 */
const buildingLiveEnabled = process.env.GELDAR_IT === '1';

/** The arena slot for this file (slot 5, the one no live file uses) and the bot that plays it. */
const SLOT = 5;
const BOT = 'GolemBuild';
const FLOOR_Y = 200;
/** A plan runs in the background: two minutes of server ticks at most before a case gives up. */
const PLAN_TICKS = 2400;

const registry = createRegistry();

type Cell = { x: number; y: number; z: number };

/** The failure text every assertion carries: the inventory, the position and the cell in question. */
function diagnostics(bot: Bot, cell: Cell): string {
  const items = bot.inventory
    .items()
    .map((item) => `${item.name}x${item.count}`)
    .join(', ');
  const feet = bot.entity.position;
  const held = bot.blockAt(new Vec3(cell.x, cell.y, cell.z))?.name ?? 'unloaded';
  return (
    `inventory [${items}]; position (${feet.x.toFixed(1)}, ${feet.y.toFixed(1)}, ${feet.z.toFixed(1)}); ` +
    `cell (${cell.x}, ${cell.y}, ${cell.z}) holds ${held}`
  );
}

/** The count of an item the bot holds, from its inventory (survival: nothing is read from the server). */
function countOf(bot: Bot, name: string): number {
  return bot.inventory
    .items()
    .filter((item) => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

/** Waits, in steps of 20 ticks, until `done` holds or `maxTicks` pass. */
async function settle(bot: Bot, done: () => boolean, maxTicks: number): Promise<void> {
  for (let waited = 0; waited < maxTicks && !done(); waited += 20) {
    await bot.waitForTicks(20);
  }
}

/** The block name at every cell is `block`; the first mismatch fails with diagnostics. */
function expectCells(bot: Bot, cells: Cell[], block: string): void {
  for (const cell of cells) {
    const name = bot.blockAt(new Vec3(cell.x, cell.y, cell.z))?.name;
    expect(name, diagnostics(bot, cell)).toBe(block);
  }
}

/** Every cell of the box from `a` to `b` at the floor level, in row order. */
function floorCells(cx: number, cz: number, half: number): Cell[] {
  const cells: Cell[] = [];
  for (let x = cx - half; x <= cx + half; x++) {
    for (let z = cz - half; z <= cz + half; z++) cells.push({ x, y: FLOOR_Y, z });
  }
  return cells;
}

describe.skipIf(!buildingLiveEnabled)('building: break and plan on a real Paper server', () => {
  it('breaks a stone block and the drop lands in the inventory', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      const cell = { x: cx + 2, y: FLOOR_Y, z: cz };
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'iron_pickaxe', 1);
      await ctl.setblock(cell.x, cell.y, cell.z, 'stone');
      const run = await runAction(registry, bot, { do: 'break', at: cell });
      expect(run.state, diagnostics(bot, cell)).toBe('completed');
      expect(bot.blockAt(new Vec3(cell.x, cell.y, cell.z))?.name, diagnostics(bot, cell)).toBe(
        'air',
      );
      expect(countOf(bot, 'cobblestone'), diagnostics(bot, cell)).toBeGreaterThanOrEqual(1);
    });
  });

  it('breaks a block, then places one in the same cell', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      const cell = { x: cx + 3, y: FLOOR_Y, z: cz };
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.setblock(cell.x, cell.y, cell.z, 'dirt');
      const broke = await runAction(registry, bot, { do: 'break', at: cell });
      expect(broke.state, diagnostics(bot, cell)).toBe('completed');
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'dirt', 1);
      const placed = await runAction(registry, bot, { do: 'place', block: 'dirt', at: cell });
      expect(placed.state, diagnostics(bot, cell)).toBe('completed');
      expect(bot.blockAt(new Vec3(cell.x, cell.y, cell.z))?.name, diagnostics(bot, cell)).toBe(
        'dirt',
      );
    });
  });

  it('builds a 5x5 floor with 3-high walls from one plan', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'stone_bricks', 128);
      const floor = floorCells(cx, cz, 2);
      const run = await runAction(registry, bot, {
        do: 'plan',
        op: 'add',
        plan_id: 'floor-walls',
        palette: { s: { block: 'stone_bricks' } },
        steps: [
          {
            op: 'box',
            pal: 's',
            from: { x: cx - 2, y: FLOOR_Y, z: cz - 2 },
            to: { x: cx + 2, y: FLOOR_Y, z: cz + 2 },
          },
          {
            op: 'wall',
            pal: 's',
            from: { x: cx - 2, y: FLOOR_Y + 1, z: cz - 2 },
            to: { x: cx + 2, y: FLOOR_Y + 1, z: cz - 2 },
            height: 3,
          },
        ],
        origin: 'here',
        order: 'bottom_up',
      } as never);
      expect(run.state, diagnostics(bot, floor[0] ?? { x: cx, y: FLOOR_Y, z: cz })).toBe(
        'completed',
      );
      await settle(
        bot,
        () => floor.every((c) => bot.blockAt(new Vec3(c.x, c.y, c.z))?.name === 'stone_bricks'),
        PLAN_TICKS,
      );
      expectCells(bot, floor, 'stone_bricks');
    });
  });

  it('leaves a cell that changed under the plan alone (the plan skips it as changed)', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      const changed = { x: cx, y: FLOOR_Y, z: cz };
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'stone_bricks', 16);
      await ctl.setblock(changed.x, changed.y, changed.z, 'dirt');
      const run = await runAction(registry, bot, {
        do: 'plan',
        op: 'add',
        plan_id: 'changed-cell',
        palette: { s: { block: 'stone_bricks' } },
        steps: [
          {
            op: 'box',
            pal: 's',
            from: { x: cx - 1, y: FLOOR_Y, z: cz },
            to: { x: cx + 1, y: FLOOR_Y, z: cz },
          },
        ],
        origin: 'here',
        order: 'given',
      } as never);
      expect(run.state, diagnostics(bot, changed)).toBe('completed');
      const others = [
        { x: cx - 1, y: FLOOR_Y, z: cz },
        { x: cx + 1, y: FLOOR_Y, z: cz },
      ];
      await settle(
        bot,
        () => others.every((c) => bot.blockAt(new Vec3(c.x, c.y, c.z))?.name === 'stone_bricks'),
        PLAN_TICKS,
      );
      expectCells(bot, others, 'stone_bricks');
      expect(
        bot.blockAt(new Vec3(changed.x, changed.y, changed.z))?.name,
        diagnostics(bot, changed),
      ).toBe('dirt');
    });
  });

  it('refuses to cancel a plan that does not exist, with the reason', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, arena }) => {
      const { x: cx, z: cz } = arena.center;
      const at = { x: cx, y: FLOOR_Y, z: cz };
      const run = await runAction(registry, bot, {
        do: 'plan',
        op: 'cancel',
        plan_id: 'no-such-plan',
      } as never);
      expect(run.result, diagnostics(bot, at)).toMatchObject({
        status: 'failed',
        reason: 'not_possible',
      });
    });
  });
});
