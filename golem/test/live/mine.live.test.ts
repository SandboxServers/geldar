import { validateActionRecord } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import type { Arena } from '../../src/arena.ts';
import type { TestControl } from '../../src/test-control.ts';
import { withLiveBot } from './fixture.ts';
import { recordFor } from './record.ts';

/** `mine` on 26.1 in slot 1 (GolemMove). Counts come from RCON, not from the bot's own model. */
const NAME = 'GolemMove';
const SLOT = 1;

/** Reads the count from `clear <name> <item> 0`, which reports what the player holds and removes nothing. */
function foundCount(reply: string): number {
  const match = /Found (\d+) matching item/.exec(reply);
  return match ? Number(match[1]) : 0;
}

/** Removes item entities left by an earlier case in this arena (they are not blocks). */
async function clearDrops(ctl: TestControl, arena: Arena): Promise<void> {
  const { x, y, z } = arena.center;
  await ctl.command(`kill @e[type=item,x=${x},y=${y},z=${z},distance=..40]`);
}

/** A column of five oak logs, 4 blocks east of the bot. */
async function logColumn(ctl: TestControl, arena: Arena): Promise<void> {
  const { x, y, z } = arena.center;
  await ctl.fill({ x: x + 4, y, z }, { x: x + 4, y: y + 4, z }, 'oak_log');
}

describe('mine on 26.1', () => {
  it('breaks 3 logs bare-handed and the inventory confirms them', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      await logColumn(ctl, arena);
      const action = { do: 'mine', block: 'oak_log', count: 3 };
      const run = await runAction(createRegistry(), bot, action);

      expect(run.state).toBe('completed');
      expect(Number(run.result.detail.mined)).toBe(3);
      expect(
        Number((run.result.detail.collected as Record<string, number>).oak_log),
      ).toBeGreaterThanOrEqual(3);
      expect(foundCount(await ctl.command(`clear ${NAME} oak_log 0`))).toBeGreaterThanOrEqual(3);
      expect(validateActionRecord(recordFor('mine', { block: 'oak_log', count: 3 }, run)).ok).toBe(
        true,
      );
    });
  }, 180_000);

  it('fails missing_materials for stone bare-handed, then completes with a wooden pickaxe', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      const cx = arena.center.x;
      const cy = arena.center.y;
      // A 3 by 1 by 1 bar of stone, 6 blocks east. The floor is stone_bricks, which `mine stone` skips.
      await ctl.fill(
        { x: cx + 6, y: cy, z: arena.center.z },
        { x: cx + 8, y: cy, z: arena.center.z },
        'stone',
      );

      const bare = await runAction(createRegistry(), bot, { do: 'mine', block: 'stone', count: 1 });
      expect(bare.result).toMatchObject({ status: 'failed', reason: 'missing_materials' });
      expect(foundCount(await ctl.command(`clear ${NAME} cobblestone 0`))).toBe(0);

      await ctl.give(NAME, 'wooden_pickaxe', 1);
      await bot.waitForTicks(10);
      const tooled = await runAction(createRegistry(), bot, {
        do: 'mine',
        block: 'stone',
        count: 3,
      });
      expect(tooled.state).toBe('completed');
      expect(
        Number((tooled.result.detail.collected as Record<string, number>).cobblestone),
      ).toBeGreaterThanOrEqual(3);
      expect(foundCount(await ctl.command(`clear ${NAME} cobblestone 0`))).toBeGreaterThanOrEqual(
        3,
      );
    });
  }, 180_000);

  it('fails not_found with mined 5 when 9 logs are asked and 5 exist', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      await logColumn(ctl, arena);
      const run = await runAction(createRegistry(), bot, {
        do: 'mine',
        block: 'oak_log',
        count: 9,
      });

      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_found' });
      expect(run.result.detail.mined).toBe(5);
    });
  }, 180_000);

  it('fails invalid_args for a name that is not a block', async () => {
    await withLiveBot({ name: NAME, slot: SLOT }, async ({ bot, ctl, arena }) => {
      await clearDrops(ctl, arena);
      const run = await runAction(createRegistry(), bot, {
        do: 'mine',
        block: 'not_a_block',
        count: 1,
      });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'invalid_args' });
    });
  }, 180_000);
});
