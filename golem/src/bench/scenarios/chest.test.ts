import { describe, expect, it } from 'vitest';
import { TestControl } from '../../test-control.ts';
import type { BenchEnv } from '../types.ts';
import { chest, chestVerdict } from './chest.ts';
import { findScenario } from './index.ts';

const CENTER = { x: 1312, y: 200, z: 800 };

function fakeEnv(opts: { chest?: boolean; cobble?: number } = {}) {
  const commands: string[] = [];
  const ctl = new TestControl({
    async command(cmd) {
      commands.push(cmd);
      return '';
    },
  });
  const bot = {
    username: 'GolemBenchB',
    blockAt: (p: { x: number; y: number; z: number }) =>
      opts.chest && p.x === CENTER.x + 3 && p.y === CENTER.y && p.z === CENTER.z
        ? { name: 'chest' }
        : { name: 'air' },
    inventory: { items: () => (opts.cobble ? [{ name: 'cobblestone', count: opts.cobble }] : []) },
  };
  return { env: { bot, ctl, arena: { center: CENTER } } as unknown as BenchEnv, commands };
}

const four = [{ name: 'cobblestone', count: 4 }];

describe('chestVerdict', () => {
  it('passes for 6 in the chest and 4 on the bot', () => {
    expect(chestVerdict(new Map([['cobblestone', 6]]), four)).toBe(true);
    expect(
      chestVerdict(new Map([['cobblestone', 6]]), [
        { name: 'cobblestone', count: 3 },
        { name: 'cobblestone', count: 1 },
      ]),
    ).toBe(true);
  });

  it('fails for a wrong count, an extra item, a missing item or a wrong inventory', () => {
    expect(chestVerdict(new Map([['cobblestone', 7]]), four)).toBe(false);
    expect(
      chestVerdict(
        new Map([
          ['cobblestone', 6],
          ['dirt', 1],
        ]),
        four,
      ),
    ).toBe(false);
    expect(chestVerdict(new Map(), four)).toBe(false);
    expect(chestVerdict(new Map([['cobblestone', 6]]), [])).toBe(false);
    expect(chestVerdict(new Map([['cobblestone', 6]]), [{ name: 'cobblestone', count: 5 }])).toBe(
      false,
    );
  });
});

describe('chest', () => {
  it('prepare builds the chest and gives the cobblestone', async () => {
    const { env, commands } = fakeEnv();
    await chest.prepare(env);
    expect(commands).toEqual(['setblock 1315 200 800 chest', 'give GolemBenchB cobblestone 10']);
  });

  it('is ready only with the chest and the cobblestone', () => {
    expect(chest.ready(fakeEnv().env)).toBe(false);
    expect(chest.ready(fakeEnv({ chest: true }).env)).toBe(false);
    expect(chest.ready(fakeEnv({ cobble: 10 }).env)).toBe(false);
    expect(chest.ready(fakeEnv({ chest: true, cobble: 10 }).env)).toBe(true);
  });

  it('is registered', () => {
    expect(findScenario('chest')).toBe(chest);
  });

  it('run does not give, teleport or build', () => {
    const source = chest.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(']) expect(source).not.toContain(banned);
  });
});
