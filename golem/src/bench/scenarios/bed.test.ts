import { describe, expect, it } from 'vitest';
import { TestControl } from '../../test-control.ts';
import type { BenchEnv, RunEnv } from '../types.ts';
import { bed, bedClear, bedVerdict } from './bed.ts';
import { findScenario, scenarios, visibleScenarios } from './index.ts';

const CENTER = { x: 1312, y: 200, z: 800 };

function fakeEnv(opts: { table?: boolean; wool?: number; planks?: number } = {}) {
  const commands: string[] = [];
  const ctl = new TestControl({
    async command(cmd) {
      commands.push(cmd);
      return '';
    },
  });
  const items = [
    { name: 'white_wool', count: opts.wool ?? 0 },
    { name: 'oak_planks', count: opts.planks ?? 0 },
  ];
  const bot = {
    username: 'GolemBenchB',
    isSleeping: false,
    blockAt: (p: { x: number; y: number; z: number }) =>
      opts.table && p.x === CENTER.x + 2 && p.y === CENTER.y && p.z === CENTER.z
        ? { name: 'crafting_table' }
        : { name: 'air' },
    inventory: { items: () => items },
  };
  return { env: { bot, ctl, arena: { center: CENTER } } as unknown as BenchEnv, commands };
}

describe('bed', () => {
  it('prepare builds the table and gives the wool and planks', async () => {
    const { env, commands } = fakeEnv();
    await bed.prepare(env);
    expect(commands).toEqual([
      'setblock 1314 200 800 crafting_table',
      'give GolemBenchB white_wool 3',
      'give GolemBenchB oak_planks 3',
    ]);
    // Item ids match the contract ItemName pattern.
    for (const c of commands.slice(1)) expect(c.split(' ')[2]).toMatch(/^[a-z0-9_]{1,64}$/);
  });

  it('is ready only with the table and the materials', () => {
    expect(bed.ready(fakeEnv().env)).toBe(false);
    expect(bed.ready(fakeEnv({ table: true, wool: 3 }).env)).toBe(false);
    expect(bed.ready(fakeEnv({ table: true, wool: 2, planks: 3 }).env)).toBe(false);
    expect(bed.ready(fakeEnv({ wool: 3, planks: 3 }).env)).toBe(false);
    expect(bed.ready(fakeEnv({ table: true, wool: 3, planks: 3 }).env)).toBe(true);
  });

  it('passes only when sleep completed and client and server both say in bed', () => {
    expect(bedVerdict('completed', true, true)).toBe(true);
    expect(bedVerdict('completed', false, true)).toBe(false);
    expect(bedVerdict('completed', true, false)).toBe(false);
    expect(bedVerdict('failed', true, true)).toBe(false);
  });

  it('run asks the server and names a disagreement in the note', async () => {
    const run = async (server: boolean) => {
      const asked: string[] = [];
      const ctl = {
        timeSet: async () => undefined,
        isSleeping: async (name: string) => {
          asked.push(name);
          return server;
        },
      };
      const bot = {
        username: 'GolemBenchB',
        isSleeping: true,
        time: { timeOfDay: 14_000 },
        wake: async () => undefined,
      };
      const env = {
        bot,
        ctl,
        arena: { center: CENTER },
        run: async () => ({ result: { status: 'completed' } }),
        signal: new AbortController().signal,
      } as unknown as RunEnv;
      return { out: await bed.run(env), asked };
    };
    const agree = await run(true);
    expect(agree.asked).toEqual(['GolemBenchB']);
    expect(agree.out.passed).toBe(true);
    expect(agree.out.note).not.toContain('disagree');
    const split = await run(false);
    expect(split.out.passed).toBe(false);
    expect(split.out.note).toContain('client and server disagree');
  });

  it('places the bed at the arena center plus the scenario offset', async () => {
    for (const [scenario, dx] of [
      [bed, 2],
      [bedClear, -2],
    ] as const) {
      const actions: unknown[] = [];
      const env = {
        bot: { username: 'GolemBenchB', isSleeping: false, time: { timeOfDay: 14_000 } },
        ctl: { timeSet: async () => undefined, isSleeping: async () => true },
        arena: { center: CENTER },
        run: async (action: unknown) => {
          actions.push(action);
          return { result: { status: 'completed' } };
        },
        signal: new AbortController().signal,
      } as unknown as RunEnv;
      await scenario.run(env);
      expect(actions[1]).toEqual({
        do: 'place',
        block: 'white_bed',
        at: { x: CENTER.x + dx, y: CENTER.y, z: CENTER.z + 2 },
      });
    }
  });

  it('wakes the bot and sets day after a run, and fails when the client never saw night', async () => {
    const calls: string[] = [];
    const env = {
      bot: {
        username: 'GolemBenchB',
        isSleeping: true,
        time: { timeOfDay: 1000 },
        on: () => undefined,
        removeListener: () => undefined,
        _client: { write: () => calls.push('wake') },
      entity: { id: 1 },
        wake: async () => {
          calls.push('wake');
        },
      },
      ctl: {
        timeSet: async (t: string) => {
          calls.push(`time ${t}`);
        },
        isSleeping: async () => true,
      },
      arena: { center: CENTER },
      tps: 20,
      timeScale: 0.001,
      run: async () => ({ result: { status: 'completed' } }),
      signal: new AbortController().signal,
    } as unknown as RunEnv;
    const out = await bed.run(env);
    expect(out.passed).toBe(false);
    expect(out.note).toBe('client never saw night');
    expect(calls).toEqual(['time night', 'wake', 'time day']);
  });

  it('registers bed visible and bed-clear hidden', () => {
    expect(findScenario('bed-clear')).toBe(bedClear);
    expect(bedClear.hidden).toBe(true);
    expect(bed.hidden).toBeUndefined();
    expect(scenarios).toContain(bedClear);
    expect(visibleScenarios()).not.toContain(bedClear);
  });
  it('is registered', () => {
    expect(findScenario('bed')).toBe(bed);
  });

  it('run does not give, teleport or build', () => {
    const source = bed.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(']) expect(source).not.toContain(banned);
  });
});
