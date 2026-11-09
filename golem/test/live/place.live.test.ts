import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runAction } from '../../src/actions/registry.ts';
import type { TestControl } from '../../src/test-control.ts';
import { withLiveBot } from './fixture.ts';

/** The arena slot for this file (P0-09a: slot 3) and the bot that plays it. */
const SLOT = 3;
const BOT = 'GolemPlace';

const registry = createRegistry();

/** The count of an item the bot holds, read from the `clear <name> <item> 0` reply (removes nothing). */
async function heldCount(ctl: TestControl, name: string, item: string): Promise<number> {
  const reply = await ctl.command(`clear ${name} ${item} 0`);
  const found = /Found (\d+) matching/.exec(reply);
  return found ? Number(found[1]) : 0;
}

describe('place: the place action against a real server', () => {
  it('places dirt two blocks away and the world agrees', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'dirt', 3);
      const target = { x: cx + 2, y: 200, z: cz };
      const run = await runAction(registry, bot, { do: 'place', block: 'dirt', at: target });
      expect(run.state).toBe('completed');
      expect(bot.blockAt(new Vec3(target.x, target.y, target.z))?.name).toBe('dirt');
      expect(await heldCount(ctl, BOT, 'dirt')).toBe(2);
    });
  });

  it('places dirt on top of a placed block', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.setblock(cx + 2, 200, cz, 'dirt');
      await ctl.give(BOT, 'dirt', 1);
      const run = await runAction(registry, bot, {
        do: 'place',
        block: 'dirt',
        at: { x: cx + 2, y: 201, z: cz },
      });
      expect(run.state).toBe('completed');
      expect(bot.blockAt(new Vec3(cx + 2, 201, cz))?.name).toBe('dirt');
    });
  });

  it('fails as blocked when the target holds stone', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.setblock(cx + 2, 200, cz, 'stone');
      await ctl.give(BOT, 'dirt', 1);
      const run = await runAction(registry, bot, {
        do: 'place',
        block: 'dirt',
        at: { x: cx + 2, y: 200, z: cz },
      });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'blocked' });
    });
  });

  it('fails as missing_materials with no dirt in the inventory', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      const run = await runAction(registry, bot, {
        do: 'place',
        block: 'dirt',
        at: { x: cx + 2, y: 200, z: cz },
      });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'missing_materials' });
    });
  });

  it('places a torch at feet, and the cell the feet are in holds it', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'torch', 1);
      const run = await runAction(registry, bot, { do: 'place', block: 'torch', at: 'feet' });
      expect(run.state).toBe('completed');
      const feet = bot.entity.position;
      const cell = bot.blockAt(
        new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z)),
      );
      expect(cell?.name).toBe('torch');
    });
  });

  it('fails as blocked when dirt is placed at feet', async () => {
    await withLiveBot({ name: BOT, slot: SLOT }, async ({ bot, ctl, arena }) => {
      const { x: cx, z: cz } = arena.center;
      await ctl.command(`kill @e[type=item,x=${cx},y=200,z=${cz},distance=..40]`);
      await ctl.give(BOT, 'dirt', 1);
      const run = await runAction(registry, bot, { do: 'place', block: 'dirt', at: 'feet' });
      expect(run.result).toMatchObject({ status: 'failed', reason: 'blocked' });
    });
  });
});
