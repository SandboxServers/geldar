import { beforeEach, describe, expect, it } from 'vitest';
import { TestControl } from '../../test-control.ts';
import type { BenchEnv, RunEnv } from '../types.ts';
import { blockedPath, blockedVerdict, resetBlockedPathRuns } from './blocked-path.ts';
import { findScenario } from './index.ts';

const CENTER = { x: 1312, y: 200, z: 800 };

function fakeEnv(opts: { gotoResult: { status: string; reason?: string }; beside?: boolean }) {
  const commands: string[] = [];
  const ctl = new TestControl({
    async command(cmd) {
      commands.push(cmd);
      return '';
    },
  });
  const bot = {
    entity: { position: { x: CENTER.x + 5 } },
    blockAt: () => (opts.beside ? { boundingBox: 'block' } : { boundingBox: 'empty' }),
    time: { age: 0 },
  };
  const env = {
    bot,
    ctl,
    arena: { center: CENTER },
    timeScale: 1,
    signal: new AbortController().signal,
    async run() {
      return { state: 'x', result: { latency_ms: 7, world_ticks: 1, ...opts.gotoResult } };
    },
  } as unknown as BenchEnv & RunEnv;
  return { env, commands };
}

beforeEach(() => resetBlockedPathRuns());

describe('blockedVerdict', () => {
  it('detour passes on completed and on blocked, fails on the rest', () => {
    expect(blockedVerdict('detour', { status: 'completed' })).toEqual({
      passed: true,
      outcome: 'detoured',
    });
    expect(blockedVerdict('detour', { status: 'failed', reason: 'blocked' })).toEqual({
      passed: true,
      outcome: 'abandoned',
    });
    for (const reason of ['timeout', 'internal', 'interrupted', 'not_found']) {
      expect(blockedVerdict('detour', { status: 'failed', reason })).toEqual({
        passed: false,
        outcome: 'bad',
      });
    }
    expect(blockedVerdict('detour', { status: 'cancelled' }).passed).toBe(false);
  });

  it('sealed passes only on blocked; completed means the wall failed', () => {
    expect(blockedVerdict('sealed', { status: 'failed', reason: 'blocked' })).toEqual({
      passed: true,
      outcome: 'abandoned',
    });
    expect(blockedVerdict('sealed', { status: 'completed' })).toEqual({
      passed: false,
      outcome: 'wall_failed',
    });
    expect(blockedVerdict('sealed', { status: 'failed', reason: 'timeout' })).toEqual({
      passed: false,
      outcome: 'bad',
    });
  });
});

describe('blocked-path', () => {
  it('is ready at once and is registered', () => {
    expect(blockedPath.ready({} as BenchEnv)).toBe(true);
    expect(findScenario('blocked-path')).toBe(blockedPath);
  });

  it('builds a wall with a gap on even runs and a sealed wall on odd runs', async () => {
    const even = fakeEnv({ gotoResult: { status: 'failed', reason: 'blocked' } });
    await blockedPath.prepare(even.env);
    const first = await blockedPath.run(even.env);
    expect(even.commands).toEqual([
      'fill 1321 200 785 1321 203 811 stone_bricks',
      'fill 1321 200 813 1321 203 815 stone_bricks',
    ]);
    expect(first).toEqual({ passed: true, note: expect.stringContaining('detour') });

    const odd = fakeEnv({ gotoResult: { status: 'completed' } });
    await blockedPath.prepare(odd.env);
    const second = await blockedPath.run(odd.env);
    expect(odd.commands).toEqual(['fill 1321 200 785 1321 203 815 stone_bricks']);
    expect(second.passed).toBe(false);
    expect(second.note).toContain('sealed');
    expect(second.note).toContain('the wall did not hold');
  });

  it('marks the run invalid when terrain beside the platform is solid', async () => {
    const { env } = fakeEnv({ gotoResult: { status: 'completed' }, beside: true });
    await blockedPath.prepare(env);
    const result = await blockedPath.run(env);
    expect(result.passed).toBe(false);
    expect(result.note).toContain('invalid');
  });

  it('run does not give, teleport or build', () => {
    const source = blockedPath.run.toString();
    for (const banned of ['.tp(', '.give(', '.setblock(']) expect(source).not.toContain(banned);
  });
});
