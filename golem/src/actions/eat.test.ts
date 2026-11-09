import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { bestFood, eatHandler, type FoodInfo } from './eat.ts';

/** Food numbers for the fake registry; `chorus_fruit` would win on points but is banned. */
const FOODS: Record<string, FoodInfo> = {
  apple: { foodPoints: 4, saturation: 2.4 },
  cooked_beef: { foodPoints: 8, saturation: 12.8 },
  rotten_flesh: { foodPoints: 4, saturation: 0.8 },
  chorus_fruit: { foodPoints: 20, saturation: 0 },
};

interface FakeOptions {
  food?: number;
  items?: string[];
  /** The rejection `consume()` makes, if any. */
  consumeError?: string;
  /** Wall ms after `consume()` until the food level rises (the health packet). */
  riseAfterMs?: number;
}

/** A fake bot with a food level, an inventory and a `consume` that can reject or raise the food later. */
function fakeBot(options: FakeOptions = {}): Bot {
  let food = options.food ?? 10;
  let held: { name: string; count: number } | null = null;
  const bot = {
    get food() {
      return food;
    },
    get heldItem() {
      return held;
    },
    registry: { foodsByName: FOODS },
    inventory: { items: () => (options.items ?? []).map((name) => ({ name, count: 1 })) },
    equip: vi.fn(async (stack: { name: string; count: number }) => {
      held = stack;
    }),
    consume: vi.fn(async () => {
      if (options.riseAfterMs !== undefined) setTimeout(() => (food = 16), options.riseAfterMs);
      if (options.consumeError) throw new Error(options.consumeError);
    }),
    waitForTicks: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }),
  };
  return bot as unknown as Bot;
}

/** Runs the `eat` handler with a fresh abort signal. */
function eat(bot: Bot, timeScale = 1) {
  return eatHandler.run({ bot, signal: new AbortController().signal, timeScale }, { do: 'eat' });
}

describe('bestFood', () => {
  it('prefers the most food points', () => {
    expect(bestFood(['apple', 'cooked_beef'], FOODS, [])).toBe('cooked_beef');
  });

  it('skips banned foods even when they rank highest', () => {
    expect(
      bestFood(['rotten_flesh', 'chorus_fruit', 'apple'], FOODS, ['rotten_flesh', 'chorus_fruit']),
    ).toBe('apple');
    expect(
      bestFood(['rotten_flesh', 'chorus_fruit'], FOODS, ['rotten_flesh', 'chorus_fruit']),
    ).toBeNull();
  });

  it('breaks a tie on points by saturation, then by name', () => {
    const foods = {
      bread: { foodPoints: 8, saturation: 6 },
      cooked_porkchop: { foodPoints: 8, saturation: 12.8 },
    };
    expect(bestFood(['bread', 'cooked_porkchop'], foods, [])).toBe('cooked_porkchop');
    const even = {
      bread: { foodPoints: 8, saturation: 6 },
      carrot: { foodPoints: 8, saturation: 6 },
    };
    expect(bestFood(['bread', 'carrot'], even, [])).toBe('bread');
  });

  it('ignores names with no food entry', () => {
    expect(bestFood(['stone', 'apple'], FOODS, [])).toBe('apple');
    expect(bestFood([], FOODS, [])).toBeNull();
  });
});

describe('eat', () => {
  it('fails with not_possible when the bot is full', async () => {
    const outcome = await eat(fakeBot({ food: 20, items: ['apple'] }));
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'not hungry',
    });
  });

  it('fails with missing_materials when there is no food', async () => {
    const outcome = await eat(fakeBot({ food: 10, items: ['stone'] }));
    expect(outcome).toMatchObject({ status: 'failed', reason: 'missing_materials' });
  });

  it('completes when the food rises after consume resolves', async () => {
    const bot = fakeBot({ food: 10, items: ['cooked_beef'], riseAfterMs: 100 });
    const outcome = await eat(bot);
    expect(outcome).toEqual({
      status: 'completed',
      detail: { item: 'cooked_beef', food_before: 10, food_after: 16 },
    });
    expect(bot.consume).toHaveBeenCalledTimes(1);
  });

  it('fails with timeout when consume times out and the food never rises', async () => {
    const bot = fakeBot({ food: 10, items: ['apple'], consumeError: 'Consume timeout' });
    const outcome = await eat(bot, 0.01);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('fails with interrupted when consume is cancelled and the food never rises', async () => {
    const bot = fakeBot({ food: 10, items: ['apple'], consumeError: 'Consume was cancelled' });
    const outcome = await eat(bot, 0.01);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'interrupted' });
  });
});
