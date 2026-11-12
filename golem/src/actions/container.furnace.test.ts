import { describe, expect, it, vi } from 'vitest';
import { AT, ctxFor, harness } from './container.fakes.ts';
import { openAction, rememberedContainers } from './container.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

type Stack = { name: string; count: number } | null;

/** A fake furnace window: the three slots, the progress fraction (or null before the server sends it). */
function fakeFurnace(slots: [Stack, Stack, Stack], progress: number | null) {
  return {
    type: 'minecraft:furnace',
    slots,
    progress,
    containerItems: () =>
      slots.flatMap((slot) => (slot ? [{ name: slot.name, count: slot.count }] : [])),
    close: vi.fn(async () => undefined),
  };
}

/** A harness whose furnace block opens with the given fake furnace window. */
function furnaceHarness(furnace: ReturnType<typeof fakeFurnace>) {
  const h = harness({ blockName: 'furnace' });
  const openFurnace = vi.fn(async () => furnace);
  Object.assign(h.bot, { openFurnace });
  return { ...h, openFurnace };
}

describe('open on a furnace', () => {
  it('reports input, fuel, output and progress as a whole percent', async () => {
    const furnace = fakeFurnace(
      [{ name: 'iron_ore', count: 2 }, { name: 'coal', count: 1 }, null],
      0.5,
    );
    const h = furnaceHarness(furnace);
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(h.openFurnace).toHaveBeenCalledOnce();
    expect(outcome).toEqual({
      status: 'completed',
      detail: {
        contents: [
          { item: 'iron_ore', count: 2 },
          { item: 'coal', count: 1 },
        ],
        furnace: {
          input: { item: 'iron_ore', count: 2 },
          fuel: { item: 'coal', count: 1 },
          output: null,
          progress: 50,
        },
      },
    });
    expect(furnace.close).toHaveBeenCalledOnce();
  });

  it('reads progress as 0 before the server has sent a progress value', async () => {
    const h = furnaceHarness(fakeFurnace([{ name: 'sand', count: 1 }, null, null], null));
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'completed', detail: { furnace: { progress: 0 } } });
  });

  it('reports the output slot when the furnace has smelted', async () => {
    const h = furnaceHarness(fakeFurnace([null, null, { name: 'iron_ingot', count: 3 }], 1));
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(outcome).toMatchObject({
      status: 'completed',
      detail: {
        furnace: {
          input: null,
          fuel: null,
          output: { item: 'iron_ingot', count: 3 },
          progress: 100,
        },
      },
    });
  });

  it('remembers the furnace it opened, with its slots', async () => {
    const h = furnaceHarness(fakeFurnace([null, { name: 'coal', count: 4 }, null], 0.25));
    await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(rememberedContainers(h.bot).recall(AT, Date.now())).toMatchObject({
      status: 'known',
      age_days: 0,
      furnace: { fuel: { item: 'coal', count: 4 }, progress: 25 },
    });
  });
});
