import { describe, expect, it } from 'vitest';
import type { BenchEnv, RunEnv } from '../types.ts';
import { food, foodRose } from './food.ts';
import { findScenario } from './index.ts';

const CENTER = { x: 800, y: 200, z: 800 };

function readyEnv(opts: { melon?: boolean; items?: number }) {
  return {
    arena: { center: CENTER },
    bot: {
      blockAt: (p: { x: number; y: number; z: number }) =>
        opts.melon && p.x === 805 && p.y === 200 && p.z === 800 ? { name: 'melon' } : null,
      inventory: { items: () => new Array(opts.items ?? 0).fill({ name: 'dirt', count: 1 }) },
    },
  } as unknown as BenchEnv;
}

/** A run env: `bot.food` starts at 10 and `eat` raises it by `gain`; `failStep` makes that action fail. */
function runEnv(opts: { gain: number; failStep?: string; startFood?: number }) {
  const calls: string[] = [];
  const bot = { username: 'GolemBenchA', food: opts.startFood ?? 10 };
  const env = {
    bot,
    signal: new AbortController().signal,
    timeScale: 1,
    ctl: {
      effect: async (...args: unknown[]) => calls.push(`effect ${args.slice(1).join(' ')}`),
      effectClear: async () => calls.push('effectClear'),
    },
    async run(action: { do: string }) {
      calls.push(action.do);
      if (action.do === 'eat') bot.food += opts.gain;
      if (opts.failStep === action.do) {
        return {
          state: 'failed',
          result: { status: 'failed', reason: 'not_found', message: 'none', detail: {} },
        };
      }
      return { state: 'completed', result: { status: 'completed', detail: {} } };
    },
  } as unknown as RunEnv;
  return { env, calls };
}

describe('foodRose', () => {
  it('needs a strictly higher food level', () => {
    expect(foodRose(10, 10)).toBe(false);
    expect(foodRose(10, 9)).toBe(false);
    expect(foodRose(10, 12)).toBe(true);
  });
});

describe('food ready', () => {
  it('is false without the melon and true with it', () => {
    expect(food.ready(readyEnv({}))).toBe(false);
    expect(food.ready(readyEnv({ melon: true }))).toBe(true);
  });

  it('is false when the bot already holds something', () => {
    expect(food.ready(readyEnv({ melon: true, items: 1 }))).toBe(false);
  });
});

describe('food run', () => {
  it('lowers hunger, clears it, mines, eats and records the food levels', async () => {
    const { env, calls } = runEnv({ gain: 2 });
    const verdict = await food.run(env);
    expect(verdict).toEqual({ passed: true, note: 'food_before 10, food_after 12' });
    expect(calls).toEqual(['effect hunger 30 255', 'effectClear', 'mine', 'eat']);
  });

  it('fails when eating did not raise the food level', async () => {
    const { env } = runEnv({ gain: 0 });
    expect((await food.run(env)).passed).toBe(false);
  });

  it('names a failed action step and does not go on', async () => {
    const { env, calls } = runEnv({ gain: 2, failStep: 'mine' });
    const verdict = await food.run(env);
    expect(verdict.passed).toBe(false);
    expect(verdict.note).toContain('mine melon failed (not_found: none)');
    expect(calls).not.toContain('eat');
  });

  it('never moves the bot or gives items from run', () => {
    const source = food.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(']) expect(source).not.toContain(banned);
  });
});

describe('food registration', () => {
  it('is registered', () => {
    expect(findScenario('food')).toBe(food);
  });
});
