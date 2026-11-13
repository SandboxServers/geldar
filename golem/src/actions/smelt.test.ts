import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { fakeFurnace, fakeTransfer, furnaceBot, ID, smeltCtx } from './smelt.fakes.ts';
import { burnTicks, fuelLimit, fuelNeeded, MAX_SMELT, pickFuel, smeltTicks } from './smelt-fuel.ts';

const calls: string[] = [];
vi.mock('./container-transfer.ts', () => ({
  transferItems: (...args: unknown[]) => transferStandIn.current(...args),
}));
const transferStandIn = vi.hoisted(() => ({
  current: (..._args: unknown[]): Promise<unknown> =>
    Promise.resolve({ error: null, aborted: false }),
}));
// The carried furnace: the place and mine handlers are stubbed so the test sees the calls and
// whether the furnace is in the world.
const spare = vi.hoisted(() => ({
  placed: false,
  placeFails: false,
  placeCalls: [] as unknown[],
  mineCalls: [] as unknown[],
}));
vi.mock('./place.ts', () => ({
  placeAction: {
    run: async (_ctx: unknown, action: unknown) => {
      spare.placeCalls.push(action);
      if (spare.placeFails)
        return { status: 'failed', reason: 'blocked', message: 'place refused' };
      spare.placed = true;
      return { status: 'completed' };
    },
  },
}));
vi.mock('./mine.ts', () => ({
  mineAction: {
    run: async (_ctx: unknown, action: unknown) => {
      spare.mineCalls.push(action);
      spare.placed = false;
      return { status: 'completed' };
    },
  },
}));

const { smeltAtFurnace } = await import('./smelt.ts');

function setup(opts: Parameters<typeof fakeFurnace>[0] = {}) {
  calls.length = 0;
  const f = fakeFurnace(opts);
  const { bot, waits } = furnaceBot(f, opts);
  const transfer = fakeTransfer(f, calls);
  transferStandIn.current = (...args) =>
    (transfer as (...a: unknown[]) => Promise<unknown>)(...args);
  return { f, bot, waits };
}

/** A bot with no furnace in the world but a furnace carried (item 6); the placed one is found. */
function carried(opts: Parameters<typeof fakeFurnace>[0] = {}) {
  spare.placed = false;
  spare.placeFails = false;
  spare.placeCalls.length = 0;
  spare.mineCalls.length = 0;
  const a = setup({ inv: { 1: 20, 3: 5, 6: 1 }, ...opts });
  const block = { name: 'furnace', position: new Vec3(1, 64, 0) };
  (a.bot.findBlock as ReturnType<typeof vi.fn>).mockImplementation(() =>
    spare.placed ? block : null,
  );
  Object.assign(a.bot, {
    blockAt: (p: { y: number }) => ({ name: p.y >= 64 ? 'air' : 'stone' }),
  });
  return a;
}

describe('fuel math', () => {
  it('coal smelts 8 and a plank 1.5, rounded up to whole items', () => {
    expect(burnTicks('coal')).toBe(1600);
    expect(fuelNeeded(8, 1600)).toBe(1);
    expect(fuelNeeded(9, 1600)).toBe(2);
    expect(fuelNeeded(3, burnTicks('oak_planks'))).toBe(2);
    expect(fuelNeeded(1, burnTicks('oak_planks'))).toBe(1);
    expect(fuelNeeded(16, burnTicks('oak_planks'))).toBe(11);
    expect(fuelNeeded(4, 0)).toBe(0);
    expect(smeltTicks(8)).toBe(1800);
  });

  it('prefers coal, skips the input and damageable items', () => {
    const held = [
      { name: 'oak_planks', count: 12, damageable: false },
      { name: 'iron_pickaxe', count: 1, damageable: true },
      { name: 'coal', count: 1, damageable: false },
      { name: 'raw_iron', count: 9, damageable: false },
    ];
    expect(pickFuel(held, 'raw_iron', 8).choice).toEqual({ name: 'coal', count: 1 });
    // coal runs short for 16 (needs 2): the planks are next
    expect(pickFuel(held, 'raw_iron', 16).choice).toEqual({ name: 'oak_planks', count: 11 });
    expect(pickFuel(held.slice(1, 2), 'raw_iron', 4).choice).toBeNull();
  });

  it('fuelLimit is what the best single fuel smelts whole', () => {
    const coal = (count: number) => ({ name: 'coal', count, damageable: false });
    const planks = (count: number) => ({ name: 'oak_planks', count, damageable: false });
    expect(fuelLimit([coal(1)], 'raw_iron')).toBe(8);
    expect(fuelLimit([planks(1)], 'raw_iron')).toBe(1);
    expect(fuelLimit([coal(1), planks(4)], 'raw_iron')).toBe(8);
    expect(
      fuelLimit([coal(5), { name: 'raw_iron', count: 30, damageable: false }], 'raw_iron'),
    ).toBe(40);
    expect(fuelLimit([{ name: 'iron_pickaxe', count: 1, damageable: true }], 'raw_iron')).toBe(0);
    expect(fuelLimit([], 'raw_iron')).toBe(0);
  });
});

describe('smeltAtFurnace', () => {
  it('smelts, collects the output, returns unused fuel, closes the window', async () => {
    const { f, bot } = setup({ perPoll: 8 });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 8 });
    expect(result.status).toBe('completed');
    expect(f.inv.get(ID.ironIngot)).toBe(8);
    expect(calls[0]).toBe(`deposit:${ID.rawIron}:8:0`);
    expect(calls[1]).toBe(`deposit:${ID.coal}:1:1`);
    expect(f.window.close).toHaveBeenCalledTimes(1);
    expect(f.slots).toEqual([null, null, null]);
  });

  it('caps 17 at 16 and says so', async () => {
    const { f, bot } = setup({ perPoll: 99, inv: { 1: 40, 3: 5 } });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 17 });
    expect(MAX_SMELT).toBe(16);
    expect(calls[0]).toBe(`deposit:${ID.rawIron}:16:0`);
    expect(result.status).toBe('completed');
    expect(JSON.stringify(result)).toContain('capped at 16, 17 were requested');
    expect(f.inv.get(ID.ironIngot)).toBe(16);
  });

  it('makes the 3 raw iron it holds when 8 are asked, and says it made fewer', async () => {
    const { f, bot } = setup({ perPoll: 8, inv: { 1: 3, 3: 5 } });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 8 });
    expect(calls[0]).toBe(`deposit:${ID.rawIron}:3:0`);
    expect(result).toMatchObject({
      status: 'completed',
      detail: { message: 'made fewer than asked; materials ran out' },
    });
    expect(f.inv.get(ID.ironIngot)).toBe(3);
  });

  it('makes what the coal allows: 1 coal smelts 8, so 16 asked makes 8', async () => {
    const { f, bot } = setup({ perPoll: 99, inv: { 1: 40, 3: 1 } });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 16 });
    expect(calls[0]).toBe(`deposit:${ID.rawIron}:8:0`);
    expect(calls[1]).toBe(`deposit:${ID.coal}:1:1`);
    expect(result).toMatchObject({
      status: 'completed',
      detail: { message: 'made fewer than asked; materials ran out' },
    });
    expect(f.inv.get(ID.ironIngot)).toBe(8);
  });

  it('makes what 1 plank allows: 1 plank smelts 1.5, so 16 asked makes 1', async () => {
    const { f, bot } = setup({ perPoll: 99, inv: { 1: 40, 4: 1 } });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 16 });
    expect(calls[0]).toBe(`deposit:${ID.rawIron}:1:0`);
    expect(calls[1]).toBe(`deposit:${ID.plank}:1:1`);
    expect(result).toMatchObject({
      status: 'completed',
      detail: { message: 'made fewer than asked; materials ran out' },
    });
    expect(f.inv.get(ID.ironIngot)).toBe(1);
  });

  it('refuses a furnace holding another item with zero clicks and leaves its items', async () => {
    const { f, bot } = setup({ slots: [null, { type: ID.plank, count: 3 }, null] });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 4 });
    expect(result).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(calls).toEqual([]);
    expect(f.slots[1]).toEqual({ type: ID.plank, count: 3 });
    expect(f.window.close).toHaveBeenCalledTimes(1);
  });

  it('times out with a partial collect and cleans up', async () => {
    const { f, bot } = setup({ perPoll: 0 });
    // the furnace finishes 2 of 4, then stalls
    const real = bot.waitForTicks;
    let n = 0;
    bot.waitForTicks = vi.fn(async (t: number) => {
      if (n++ === 0) f.slots[2] = { type: ID.ironIngot, count: 2 };
      await real.call(bot, t);
    });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 4 });
    expect(result).toMatchObject({ status: 'failed', reason: 'timeout', detail: { smelted: 2 } });
    expect(f.inv.get(ID.ironIngot)).toBe(2);
    expect(f.slots).toEqual([null, null, null]);
    expect(f.inv.get(ID.rawIron)).toBe(20);
    expect(f.inv.get(ID.coal)).toBe(5);
    expect(f.window.close).toHaveBeenCalledTimes(1);
  });

  it('cleans up on abort during the wait', async () => {
    const abort = new AbortController();
    const { f, bot } = setup({ perPoll: 0, abortOnWait: abort });
    const result = await smeltAtFurnace(smeltCtx(bot, abort.signal), {
      item: 'iron_ingot',
      count: 4,
    });
    expect(result.status).toBe('cancelled');
    expect(f.slots).toEqual([null, null, null]);
    expect(f.inv.get(ID.rawIron)).toBe(20);
    expect(f.window.close).toHaveBeenCalledTimes(1);
  });

  it('closes the window when a load fails and returns what was loaded', async () => {
    const { f, bot } = setup({ perPoll: 8 });
    const good = transferStandIn.current;
    transferStandIn.current = async (...args: unknown[]) => {
      if (args[2] === 'deposit' && args[3] === ID.coal) return { error: 'boom', aborted: false };
      return good(...args);
    };
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 8 });
    expect(result).toMatchObject({ status: 'failed', reason: 'internal' });
    expect(f.inv.get(ID.rawIron)).toBe(20);
    expect(f.window.close).toHaveBeenCalledTimes(1);
  });

  it('gives fixed-text reasons for no furnace, no recipe, no input, no fuel', async () => {
    const a = setup();
    (a.bot.findBlock as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(await smeltAtFurnace(smeltCtx(a.bot), { item: 'iron_ingot', count: 1 })).toMatchObject({
      reason: 'not_found',
      message: 'no furnace within reach',
    });
    const b = setup();
    expect(await smeltAtFurnace(smeltCtx(b.bot), { item: 'oak_planks', count: 1 })).toMatchObject({
      reason: 'not_possible',
    });
    const c = setup({ inv: { 3: 5 } });
    expect(await smeltAtFurnace(smeltCtx(c.bot), { item: 'iron_ingot', count: 1 })).toMatchObject({
      reason: 'missing_materials',
      message: 'no raw_iron to smelt into iron_ingot',
    });
    expect(calls).toEqual([]);
  });

  it('says there is not enough fuel in words, with no digits', async () => {
    const d = setup({ inv: { 1: 4 } });
    const result = await smeltAtFurnace(smeltCtx(d.bot), { item: 'iron_ingot', count: 4 });
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
      message: 'there is not enough fuel',
    });
    expect(JSON.stringify(result)).not.toMatch(/\d/);
    expect(calls).toEqual([]);
  });
});

describe('smeltAtFurnace with a carried furnace', () => {
  it('places the furnace beside the bot, smelts, and mines it back', async () => {
    const { f, bot } = carried({ perPoll: 4 });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 4 });
    expect(result).toMatchObject({ status: 'completed' });
    expect(spare.placeCalls).toEqual([
      { do: 'place', block: 'furnace', at: { x: 1, y: 64, z: 0 } },
    ]);
    expect(spare.mineCalls).toEqual([{ do: 'mine', block: 'furnace', count: 1 }]);
    expect(spare.placed).toBe(false);
    expect(f.inv.get(ID.ironIngot)).toBe(4);
  });

  it('refuses with no free space beside the bot and places nothing', async () => {
    const { bot } = carried();
    Object.assign(bot, { blockAt: () => ({ name: 'stone' }) });
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 4 });
    expect(result).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(spare.placeCalls).toEqual([]);
    expect(spare.mineCalls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('returns the placement outcome and mines nothing when the place is refused', async () => {
    const { bot } = carried();
    spare.placeFails = true;
    const result = await smeltAtFurnace(smeltCtx(bot), { item: 'iron_ingot', count: 4 });
    expect(result).toMatchObject({ status: 'failed', message: 'place refused' });
    expect(spare.mineCalls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('mines the furnace back when the smelt is cancelled during the wait', async () => {
    const abort = new AbortController();
    const { f, bot } = carried({ perPoll: 0, abortOnWait: abort });
    const result = await smeltAtFurnace(smeltCtx(bot, abort.signal), {
      item: 'iron_ingot',
      count: 4,
    });
    expect(result.status).toBe('cancelled');
    expect(f.window.close).toHaveBeenCalledTimes(1);
    expect(spare.mineCalls).toEqual([{ do: 'mine', block: 'furnace', count: 1 }]);
    expect(spare.placed).toBe(false);
  });
});
