import { beforeEach, describe, expect, it } from 'vitest';
import { TestControl } from '../../test-control.ts';
import type { BenchEnv, RunEnv } from '../types.ts';
import { blockedPath, blockedVerdict, resetBlockedPathRuns } from './blocked-path.ts';
import { findScenario } from './index.ts';

const CENTER = { x: 1312, y: 200, z: 800 };

function fakeEnv(opts: {
  gotoResult: { status: string; reason?: string };
  beside?: boolean;
  tps?: number;
  /** Client x offset from the arena center after the walk; the goal is at +14. */
  endDx?: number;
}) {
  const commands: string[] = [];
  const ctl = new TestControl({
    async command(cmd) {
      commands.push(cmd);
      return '';
    },
  });
  const bot = {
    entity: { position: { x: CENTER.x + (opts.endDx ?? 14), y: CENTER.y, z: CENTER.z } },
    blockAt: () => (opts.beside ? { boundingBox: 'block' } : { boundingBox: 'empty' }),
    time: { age: 0 },
  };
  const env = {
    bot,
    ctl,
    tps: opts.tps ?? 20,
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
    expect(blockedVerdict('detour', { status: 'completed' }, 0)).toEqual({
      passed: true,
      outcome: 'detoured',
    });
    expect(blockedVerdict('detour', { status: 'failed', reason: 'blocked' }, 9)).toEqual({
      passed: true,
      outcome: 'abandoned',
    });
    for (const reason of ['timeout', 'internal', 'interrupted', 'not_found']) {
      expect(blockedVerdict('detour', { status: 'failed', reason }, 0)).toEqual({
        passed: false,
        outcome: 'bad',
      });
    }
    expect(blockedVerdict('detour', { status: 'cancelled' }, 0).passed).toBe(false);
  });

  it('a detour needs the bot within the goal range plus one, whatever goto said', () => {
    const done = { status: 'completed' };
    expect(blockedVerdict('detour', done, 2)).toEqual({ passed: true, outcome: 'detoured' });
    expect(blockedVerdict('detour', done, 2.5)).toEqual({ passed: false, outcome: 'bad' });
  });

  it('sealed passes only on blocked; completed means the wall failed', () => {
    expect(blockedVerdict('sealed', { status: 'failed', reason: 'blocked' }, 9)).toEqual({
      passed: true,
      outcome: 'abandoned',
    });
    expect(blockedVerdict('sealed', { status: 'completed' }, 0)).toEqual({
      passed: false,
      outcome: 'wall_failed',
    });
    expect(blockedVerdict('sealed', { status: 'failed', reason: 'timeout' }, 0)).toEqual({
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

  it('starts every tick rate at detour and alternates within it', async () => {
    const variants: string[] = [];
    for (const tps of [20, 20, 20, 5, 5, 5]) {
      const { env } = fakeEnv({ gotoResult: { status: 'completed' }, tps });
      await blockedPath.prepare(env);
      variants.push((await blockedPath.run(env)).note.split(':')[0] ?? '');
    }
    expect(variants).toEqual(['detour', 'sealed', 'detour', 'detour', 'sealed', 'detour']);
  });

  it('fails a detour whose goto completed far from the goal', async () => {
    const { env } = fakeEnv({ gotoResult: { status: 'completed' }, endDx: 6 });
    await blockedPath.prepare(env);
    const out = await blockedPath.run(env);
    expect(out.passed).toBe(false);
    expect(out.note).toContain('bad');
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
