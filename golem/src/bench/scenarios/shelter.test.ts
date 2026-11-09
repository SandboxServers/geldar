import { describe, expect, it } from 'vitest';
import type { BenchEnv, RunEnv } from '../types.ts';
import { findScenario } from './index.ts';
import { isEnclosed, type Offset, SHELTER_OFFSETS, shelter } from './shelter.ts';

const BASE = { x: 800, y: 200, z: 800 };
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** A getBlock with these offsets solid. */
function solid(offsets: readonly Offset[]) {
  const set = new Set(offsets.map(([x, y, z]) => key(x, y, z)));
  return (dx: number, dy: number, dz: number) =>
    set.has(key(dx, dy, dz)) ? { boundingBox: 'block' } : { boundingBox: 'empty' };
}

const FULL: Offset[] = [...SHELTER_OFFSETS, [0, -1, 0]];

describe('isEnclosed', () => {
  it('is true with sides, roof and floor', () => {
    expect(isEnclosed(solid(FULL))).toBe(true);
  });

  it('is false with one head-level block missing', () => {
    expect(isEnclosed(solid(FULL.filter((o) => key(o[0], o[1], o[2]) !== '1,1,0')))).toBe(false);
  });

  it('is false with the roof missing', () => {
    expect(isEnclosed(solid(FULL.filter((o) => key(o[0], o[1], o[2]) !== '0,2,0')))).toBe(false);
  });

  it('is false without a floor and for unknown cells', () => {
    expect(isEnclosed(solid(SHELTER_OFFSETS))).toBe(false);
    expect(isEnclosed(() => null)).toBe(false);
  });
});

describe('SHELTER_OFFSETS', () => {
  it('has 10 distinct entries, lower layer first', () => {
    expect(new Set(SHELTER_OFFSETS.map(([x, y, z]) => key(x, y, z))).size).toBe(10);
    const heights = SHELTER_OFFSETS.map((o) => o[1]);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });
});

describe('shelter ready', () => {
  const env = (count: number | null) =>
    ({
      bot: {
        inventory: { items: () => (count === null ? [] : [{ name: 'dirt', count }]) },
      },
    }) as unknown as BenchEnv;

  it('needs the dirt', () => {
    expect(shelter.ready(env(null))).toBe(false);
    expect(shelter.ready(env(9))).toBe(false);
    expect(shelter.ready(env(16))).toBe(true);
  });
});

/** Run env: placing works for the offsets in `placed`; the server holds `serverHas`. */
const floored = {
  ...BASE,
  offset: (dx: number, dy: number, dz: number) => ({
    x: BASE.x + dx,
    y: BASE.y + dy,
    z: BASE.z + dz,
  }),
};

function runEnv(opts: { failAt?: number; serverMissing?: string }) {
  const calls: { x: number; y: number; z: number }[] = [];
  const placedKeys = new Set<string>();
  const env = {
    bot: {
      username: 'GolemBenchA',
      entity: { position: { floored: () => floored } },
      blockAt: (p: { x: number; y: number; z: number }) =>
        placedKeys.has(key(p.x, p.y, p.z)) || p.y === BASE.y - 1
          ? { boundingBox: 'block' }
          : { boundingBox: 'empty' },
    },
    signal: new AbortController().signal,
    timeScale: 1,
    ctl: {
      blockIs: async (x: number, y: number, z: number) =>
        key(x - BASE.x, y - BASE.y, z - BASE.z) !== opts.serverMissing,
    },
    async run(action: { at: { x: number; y: number; z: number } }) {
      if (opts.failAt === calls.length) {
        return {
          state: 'failed',
          result: { status: 'failed', reason: 'no_reference', message: 'nope', detail: {} },
        };
      }
      calls.push(action.at);
      placedKeys.add(key(action.at.x, action.at.y, action.at.z));
      return { state: 'completed', result: { status: 'completed', detail: {} } };
    },
  };
  return { env: env as unknown as RunEnv, calls };
}

describe('shelter run', () => {
  it('places the ten blocks in order with absolute positions and passes', async () => {
    const { env, calls } = runEnv({});
    const verdict = await shelter.run(env);
    expect(verdict.passed).toBe(true);
    expect(calls).toHaveLength(10);
    expect(calls[0]).toEqual({ x: 801, y: 200, z: 800 });
    expect(calls[9]).toEqual({ x: 800, y: 202, z: 800 });
  });

  it('fails when the server lacks a block the client sees, and says so', async () => {
    const { env } = runEnv({ serverMissing: '0,1,1' });
    const verdict = await shelter.run(env);
    expect(verdict.passed).toBe(false);
    expect(verdict.note).toContain('disagree');
    expect(verdict.note).toContain('(0,1,1)');
  });

  it('names a failed place step and stops', async () => {
    const { env, calls } = runEnv({ failAt: 3 });
    const verdict = await shelter.run(env);
    expect(verdict.passed).toBe(false);
    expect(verdict.note).toContain('place dirt at (0,0,-1) failed (no_reference: nope)');
    expect(calls).toHaveLength(3);
  });

  it('never moves the bot or gives items from run', () => {
    const source = shelter.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(', "do: 'goto'"]) {
      expect(source).not.toContain(banned);
    }
  });
});

describe('shelter registration', () => {
  it('is registered', () => {
    expect(findScenario('shelter')).toBe(shelter);
  });
});
