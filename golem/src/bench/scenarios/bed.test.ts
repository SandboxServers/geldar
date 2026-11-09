import { describe, expect, it } from 'vitest';
import { TestControl } from '../../test-control.ts';
import type { BenchEnv } from '../types.ts';
import { bed, bedVerdict } from './bed.ts';
import { findScenario } from './index.ts';

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

  it('passes only when sleep completed and the client is in the bed', () => {
    expect(bedVerdict('completed', true)).toBe(true);
    expect(bedVerdict('completed', false)).toBe(false);
    expect(bedVerdict('failed', true)).toBe(false);
  });

  it('is registered', () => {
    expect(findScenario('bed')).toBe(bed);
  });

  it('run does not give, teleport or build', () => {
    const source = bed.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(']) expect(source).not.toContain(banned);
  });
});
