import { describe, expect, it, vi } from 'vitest';
import { fakeFurnace, fakeTransfer, furnaceBot, smeltCtx } from './smelt.fakes.ts';

const calls: string[] = [];
vi.mock('./container-transfer.ts', () => ({
  transferItems: (...args: unknown[]) => transferStandIn.current(...args),
}));
const transferStandIn = vi.hoisted(() => ({
  current: (..._args: unknown[]): Promise<unknown> =>
    Promise.resolve({ error: null, aborted: false }),
}));

const { craftAction } = await import('./craft.ts');

/** The furnace bot plus an empty grid-recipe lookup: no grid recipe makes anything. */
function setup(item: string) {
  calls.length = 0;
  const f = fakeFurnace();
  const { bot } = furnaceBot(f, { perPoll: 20 });
  const transfer = fakeTransfer(f, calls);
  transferStandIn.current = (...args) =>
    (transfer as (...a: unknown[]) => Promise<unknown>)(...args);
  Object.assign(bot, { recipesFor: () => [], recipesAll: () => [] });
  return { bot, ctx: smeltCtx(bot), action: { do: 'craft' as const, item, count: 2 } };
}

describe('craft falls back to a furnace', () => {
  it('routes an item with only a known smelting recipe to the furnace', async () => {
    const { bot, ctx, action } = setup('iron_ingot');
    const out = await craftAction.run(ctx, action);
    expect(out.status).toBe('completed');
    expect(bot.openContainer).toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith('deposit:'))).toBe(true);
  });

  it('keeps the existing refusal when no smelting recipe is known', async () => {
    const { bot, ctx, action } = setup('iron_pickaxe');
    const out = await craftAction.run(ctx, action);
    expect(out).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(bot.openContainer).not.toHaveBeenCalled();
  });
});
