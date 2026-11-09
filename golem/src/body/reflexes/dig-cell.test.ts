import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot } from '../body.fakes.ts';
import { digCell, digCellWhy } from './dig-cell.ts';
import { reflexContext, settableView } from './reflexes.fakes.ts';

const CELL = new Vec3(1, 64, 0);

/** A context over a bot whose `blockAt` answers with `block` and whose `dig` is `dig`. */
function digContext(block: unknown, dig: () => Promise<void>) {
  const bot = fakeBot() as unknown as Record<string, unknown>;
  bot.blockAt = () => block;
  bot.dig = dig;
  bot.stopDigging = () => undefined;
  return reflexContext(bot as never, settableView(), new ActionRegistry());
}

const STONE = { name: 'stone', boundingBox: 'block', diggable: true, position: CELL };

describe('digCellWhy', () => {
  it('refuses a cell that is not loaded instead of treating it as open', async () => {
    let dug = 0;
    const ctx = digContext(null, async () => {
      dug += 1;
    });
    expect(await digCellWhy(ctx, CELL)).toEqual({ ok: false, cause: 'cell not loaded' });
    expect(await digCell(ctx, CELL)).toBe(false);
    expect(dug).toBe(0);
  });

  it('puts the error of a failed dig into the cause', async () => {
    const ctx = digContext(STONE, async () => {
      throw new Error('digging aborted');
    });
    expect(await digCellWhy(ctx, CELL)).toEqual({
      ok: false,
      cause: 'dig failed: digging aborted',
    });
  });

  it('names a block outside the allowlist and treats an empty cell as open', async () => {
    const ore = digContext({ ...STONE, name: 'diamond_ore' }, async () => undefined);
    expect(await digCellWhy(ore, CELL)).toEqual({
      ok: false,
      cause: 'diamond_ore is not diggable',
    });
    const air = digContext({ name: 'air', boundingBox: 'empty' }, async () => undefined);
    expect(await digCellWhy(air, CELL)).toEqual({ ok: true });
  });
});
