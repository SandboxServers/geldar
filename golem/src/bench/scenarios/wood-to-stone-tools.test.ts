import { describe, expect, it } from 'vitest';
import type { BenchEnv, RunEnv } from '../types.ts';
import { findScenario } from './index.ts';
import { failedStepNote, holdsStonePickaxe, woodToStoneTools } from './wood-to-stone-tools.ts';

const CENTER = { x: 800, y: 200, z: 800 };

function envWith(opts: { blocks?: Record<string, string>; items?: string[] }) {
  return {
    arena: { center: CENTER },
    bot: {
      username: 'GolemBenchA',
      blockAt: (p: { x: number; y: number; z: number }) => {
        const name = opts.blocks?.[`${p.x},${p.y},${p.z}`];
        return name ? { name } : null;
      },
      inventory: { items: () => (opts.items ?? []).map((name) => ({ name, count: 1 })) },
    },
  } as unknown as BenchEnv;
}

const fixture = {
  '806,200,800': 'oak_log',
  '806,203,800': 'oak_log',
  '806,200,803': 'oak_log',
  '806,203,803': 'oak_log',
  '810,200,800': 'cobblestone',
  '812,200,802': 'cobblestone',
};

describe('holdsStonePickaxe', () => {
  it('is true only with a stone pickaxe', () => {
    expect(holdsStonePickaxe([{ name: 'stone_pickaxe', count: 1 }])).toBe(true);
    expect(holdsStonePickaxe([{ name: 'wooden_pickaxe', count: 1 }])).toBe(false);
    expect(holdsStonePickaxe([])).toBe(false);
  });
});

describe('failedStepNote', () => {
  it('names the step and the result', () => {
    const note = failedStepNote(3, 'place crafting_table', {
      status: 'failed',
      reason: 'blocked',
      message: 'target occupied',
    });
    expect(note).toBe('step 4 (place crafting_table) failed (blocked: target occupied)');
  });
});

describe('wood-to-stone-tools ready', () => {
  it('is false on an empty world and true with the fixture', () => {
    expect(woodToStoneTools.ready(envWith({}))).toBe(false);
    expect(woodToStoneTools.ready(envWith({ blocks: fixture }))).toBe(true);
  });

  it('is false when the bot holds something or a trunk is short', () => {
    expect(woodToStoneTools.ready(envWith({ blocks: fixture, items: ['dirt'] }))).toBe(false);
    expect(woodToStoneTools.ready(envWith({ blocks: { ...fixture, '806,203,803': 'air' } }))).toBe(
      false,
    );
  });
});

describe('wood-to-stone-tools run', () => {
  const runEnv = (failAt: number | null, items: string[]) => {
    const actions: Array<Record<string, unknown>> = [];
    const env = {
      ...envWith({ items }),
      async run(action: Record<string, unknown>) {
        actions.push(action);
        const failed = failAt === actions.length;
        return {
          state: failed ? 'failed' : 'completed',
          result: failed
            ? { status: 'failed', reason: 'not_found', message: 'nothing', detail: {} }
            : { status: 'completed', detail: {} },
        };
      },
    } as unknown as RunEnv;
    return { env, actions };
  };

  it('plays the eight steps in order and passes with a stone pickaxe', async () => {
    const { env, actions } = runEnv(null, ['stone_pickaxe']);
    const verdict = await woodToStoneTools.run(env);
    expect(verdict.passed).toBe(true);
    expect(actions.map((a) => `${a.do} ${a.block ?? a.item}`)).toEqual([
      'mine oak_log',
      'craft oak_planks',
      'craft crafting_table',
      'place crafting_table',
      'craft stick',
      'craft wooden_pickaxe',
      'mine cobblestone',
      'craft stone_pickaxe',
    ]);
    expect(actions[3]?.at).toEqual({ x: 801, y: 200, z: 800 });
  });

  it('stops at the first failed step and names it', async () => {
    const { env, actions } = runEnv(6, []);
    const verdict = await woodToStoneTools.run(env);
    expect(verdict.passed).toBe(false);
    expect(verdict.note).toContain('step 6 (craft wooden_pickaxe)');
    expect(actions).toHaveLength(6);
  });

  it('fails when every step completes but there is no stone pickaxe', async () => {
    const { env } = runEnv(null, ['wooden_pickaxe']);
    expect((await woodToStoneTools.run(env)).passed).toBe(false);
  });

  it('never moves the bot or gives items from run', () => {
    const source = woodToStoneTools.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(']) expect(source).not.toContain(banned);
  });
});

describe('wood-to-stone-tools registration', () => {
  it('is registered', () => {
    expect(findScenario('wood-to-stone-tools')).toBe(woodToStoneTools);
  });
});
