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

/** A context over a grid of named cells (air elsewhere); the Body stands at (0,64,0); `dig` empties its cell. */
function gridContext(named: Map<string, string>, dug: string[]) {
  const key = (c: Vec3): string => `${c.x},${c.y},${c.z}`;
  const bot = fakeBot() as unknown as Record<string, unknown>;
  bot.entity = { position: new Vec3(0.5, 64, 0.5), height: 1.62 };
  bot.blockAt = (cell: Vec3) => {
    const name = named.get(key(cell)) ?? 'air';
    return name === 'air'
      ? { name, boundingBox: 'empty' }
      : { name, boundingBox: 'block', diggable: true, position: cell };
  };
  bot.dig = async (block: { name: string; position: Vec3 }) => {
    dug.push(block.name);
    named.delete(key(block.position));
  };
  bot.stopDigging = () => undefined;
  return reflexContext(bot as never, settableView(), new ActionRegistry());
}

describe('digCellWhy: the dig-safety guard', () => {
  it('refuses to dig a cell with water on a face, and digs the same cell with stone beside it', async () => {
    const dug: string[] = [];
    const wet = new Map([
      ['1,64,0', 'stone'],
      ['1,64,1', 'water'],
    ]);
    const ctx = gridContext(wet, dug);
    expect(await digCellWhy(ctx, CELL)).toEqual({
      ok: false,
      cause: 'stone is unsafe to dig: water would flow in on you',
    });
    expect(dug).toEqual([]);
    const dry = gridContext(new Map([['1,64,0', 'stone']]), dug);
    expect(await digCell(dry, CELL)).toBe(true);
    expect(dug).toEqual(['stone']);
  });

  it('refuses to dig a cell with gravel above it while the Body stands under it', async () => {
    const dug: string[] = [];
    const capped = new Map([
      ['1,64,0', 'stone'],
      ['1,65,0', 'gravel'],
    ]);
    expect(await digCellWhy(gridContext(capped, dug), CELL)).toEqual({
      ok: false,
      cause: 'stone is unsafe to dig: gravel above it would fall on you',
    });
    expect(dug).toEqual([]);
    // The same cell with nothing above it digs (the control).
    expect(await digCell(gridContext(new Map([['1,64,0', 'stone']]), dug), CELL)).toBe(true);
    expect(dug).toEqual(['stone']);
  });
});
