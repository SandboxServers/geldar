import { validateActionRecord } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import type { JsonValue } from '../../src/actions/outcome.ts';
import { runAction } from '../../src/actions/registry.ts';
import { loadConfig, readRconPassword } from '../../src/config.ts';
import { RconClient } from '../../src/rcon.ts';
import { parseItems } from '../../src/test-control.ts';
import { withLiveBot } from './fixture.ts';
import { type RunOutcome, recordFor } from './record.ts';

/** The arena slot and the bot name for the container live tests. */
const SLOT = 4;
const BOT = 'GolemChest';

type Pos = { x: number; y: number; z: number };

/** How many of an item the bot holds, counted by name across its whole inventory. */
function held(bot: Bot, name: string): number {
  return bot.inventory
    .items()
    .filter((item) => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Runs one action through the real registry and checks that its record passes the contract. The
 * bot must have no open window afterwards.
 */
async function act(bot: Bot, action: Record<string, JsonValue>): Promise<RunOutcome> {
  const run = await runAction(createRegistry(), bot, action);
  expect(validateActionRecord(recordFor(String(action.do), action, run)).ok).toBe(true);
  expect(bot.currentWindow).toBeNull();
  return run;
}

/** Places a block with RCON and returns its position. */
async function place(
  ctl: { setblock(x: number, y: number, z: number, block: string): Promise<string> },
  at: Pos,
  block: string,
): Promise<Pos> {
  await ctl.setblock(at.x, at.y, at.z, block);
  return at;
}

describe('open, deposit and withdraw on 26.1', () => {
  it('open on an empty chest completes with no contents', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 3, y: arena.center.y, z: arena.center.z },
        'chest',
      );
      const run = await act(bot, { do: 'open', at });
      expect(run.state).toBe('completed');
      expect(run.result.detail).toEqual({ contents: [] });
    });
  }, 180_000);

  it('deposit moves 10 cobblestone into the chest and the bot keeps none', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 3, y: arena.center.y, z: arena.center.z },
        'chest',
      );
      await ctl.give(BOT, 'cobblestone', 10);
      await bot.waitForTicks(10);
      const run = await act(bot, { do: 'deposit', at, item: 'cobblestone', count: 10 });
      expect(run.state).toBe('completed');
      expect(Number(run.result.detail.moved)).toBe(10);
      expect(await ctl.chestItems(at.x, at.y, at.z)).toEqual(new Map([['cobblestone', 10]]));
      expect(held(bot, 'cobblestone')).toBe(0);
    });
  }, 180_000);

  it('withdraw 4 leaves 6 in the chest and 4 on the bot; 20 more is not_found and moves nothing', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 3, y: arena.center.y, z: arena.center.z },
        'chest',
      );
      await ctl.give(BOT, 'cobblestone', 10);
      await bot.waitForTicks(10);
      await act(bot, { do: 'deposit', at, item: 'cobblestone', count: 10 });

      const taken = await act(bot, { do: 'withdraw', at, item: 'cobblestone', count: 4 });
      expect(taken.state).toBe('completed');
      expect(Number(taken.result.detail.moved)).toBe(4);
      expect(await ctl.chestItems(at.x, at.y, at.z)).toEqual(new Map([['cobblestone', 6]]));
      expect(held(bot, 'cobblestone')).toBe(4);

      const short = await act(bot, { do: 'withdraw', at, item: 'cobblestone', count: 20 });
      expect(short.state).toBe('failed');
      expect(short.result).toMatchObject({ status: 'failed', reason: 'not_found' });
      expect(await ctl.chestItems(at.x, at.y, at.z)).toEqual(new Map([['cobblestone', 6]]));
      expect(held(bot, 'cobblestone')).toBe(4);
    });
  }, 180_000);

  it('deposit of a stick the bot does not hold is missing_materials', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 3, y: arena.center.y, z: arena.center.z },
        'chest',
      );
      const run = await act(bot, { do: 'deposit', at, item: 'stick', count: 1 });
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'missing_materials' });
      expect(await ctl.chestItems(at.x, at.y, at.z)).toEqual(new Map());
    });
  }, 180_000);

  it('deposit at a stone block is not_found', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 3, y: arena.center.y, z: arena.center.z },
        'stone',
      );
      await ctl.give(BOT, 'cobblestone', 1);
      await bot.waitForTicks(10);
      const run = await act(bot, { do: 'deposit', at, item: 'cobblestone', count: 1 });
      expect(run.state).toBe('failed');
      expect(run.result).toMatchObject({ status: 'failed', reason: 'not_found' });
      expect(held(bot, 'cobblestone')).toBe(1);
    });
  }, 180_000);

  it('reaches a chest 12 blocks away by moving first', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 12, y: arena.center.y, z: arena.center.z },
        'chest',
      );
      await ctl.give(BOT, 'cobblestone', 2);
      await bot.waitForTicks(10);
      const run = await act(bot, { do: 'deposit', at, item: 'cobblestone', count: 2 });
      expect(run.state).toBe('completed');
      expect(Number(run.result.detail.moved)).toBe(2);
      expect(await ctl.chestItems(at.x, at.y, at.z)).toEqual(new Map([['cobblestone', 2]]));
    });
  }, 180_000);

  it('parses the real reply of a non-empty chest', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const at = await place(
        ctl,
        { x: arena.center.x + 3, y: arena.center.y, z: arena.center.z },
        'chest',
      );
      await ctl.give(BOT, 'cobblestone', 10);
      await bot.waitForTicks(10);
      await act(bot, { do: 'deposit', at, item: 'cobblestone', count: 10 });

      // A second RCON connection reads the raw `data get block` reply, which `chestItems` parses.
      const cfg = loadConfig();
      const rcon = await RconClient.connect({
        host: cfg.rconHost,
        port: cfg.rconPort,
        password: await readRconPassword(cfg),
      });
      let raw: string;
      try {
        raw = await rcon.command(`data get block ${at.x} ${at.y} ${at.z} Items`);
      } finally {
        await rcon.close();
      }
      expect(raw).toContain('cobblestone');
      expect(parseItems(raw)).toEqual(new Map([['cobblestone', 10]]));
    });
  }, 180_000);
});
