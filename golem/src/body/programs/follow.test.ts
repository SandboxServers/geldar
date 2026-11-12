import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FakeWorld } from '../../perception/perception.fakes.ts';
import type { ProgramContext, StepResult } from '../program.ts';
import { FollowProgram } from './follow.ts';
import { contextFor, newWorld } from './programs.fakes.ts';

/** A program context whose bot is a perception fake world, so the real visibility rule applies. */
function setup() {
  const sight = new FakeWorld();
  const base = contextFor(newWorld());
  const log: string[] = [];
  const ctx: ProgramContext = {
    ...base,
    bot: sight.bot,
    runAction: async (action) => {
      log.push(action.do === 'goto' ? `goto:${JSON.stringify(action.target)}` : action.do);
      return {
        state: 'completed',
        result: { status: 'completed', latency_ms: 0, world_ticks: 0, detail: {} },
      };
    },
  };
  const wall = () => {
    for (const [x, y] of [
      [0, 64],
      [0, 65],
      [1, 64],
      [1, 65],
      [-1, 64],
      [-1, 65],
    ] as const) {
      sight.set('stone', x, y, 1);
    }
  };
  return { sight, ctx, log, wall };
}

const pike = (z: number) => ({ type: 'player', username: 'Pike', position: new Vec3(0.5, 64, z) });

describe('follow', () => {
  it('refuses to start on a target that is not in sight, with one text', async () => {
    const { sight, ctx, wall } = setup();
    sight.entities[2] = pike(4.5);
    wall();
    const walled = await new FollowProgram().start({ target: 'Pike' }, ctx).catch((e) => e.message);
    const absent = await new FollowProgram()
      .start({ target: 'Nobody' }, ctx)
      .catch((e) => e.message);
    expect(walled).toBe('follow: no such agent in sight');
    expect(absent).toBe(walled);
  });

  it('walks to a far target, waits when near, and fails after the unseen limit', async () => {
    const { sight, ctx, log, wall } = setup();
    sight.entities[2] = pike(10.5);
    const program = new FollowProgram();
    await program.start({ target: 'Pike', max_unseen_seconds: 2 }, ctx);
    expect(await program.step(ctx)).toEqual({ status: 'running' });
    expect(log).toEqual(['goto:{"x":0,"y":64,"z":10}']);
    sight.entities[2] = pike(2.5);
    await program.step(ctx);
    expect(log.at(-1)).toBe('wait');
    wall();
    const results: StepResult[] = [];
    for (let i = 0; i < 3; i += 1) results.push(await program.step(ctx));
    expect(results.map((r) => r.status)).toEqual(['running', 'running', 'failed']);
    expect(results[2]).toEqual({
      status: 'failed',
      message: 'not_found: target out of sight for 2 seconds',
    });
  });

  it('resets the unseen count when the target comes back, and survives a checkpoint', async () => {
    const { sight, ctx, wall } = setup();
    sight.entities[2] = pike(2.5);
    const program = new FollowProgram();
    await program.start({ target: 'Pike', max_unseen_seconds: 3 }, ctx);
    wall();
    await program.step(ctx);
    expect(program.checkpoint()).toEqual({ target: 'Pike', maxUnseenSeconds: 3, unseen: 1 });
    const copy = new FollowProgram();
    await copy.resume(JSON.parse(JSON.stringify(program.checkpoint())), ctx);
    sight.clear(0, 64, 1);
    sight.clear(0, 65, 1);
    sight.clear(1, 64, 1);
    sight.clear(1, 65, 1);
    sight.clear(-1, 64, 1);
    sight.clear(-1, 65, 1);
    await copy.step(ctx);
    expect(copy.checkpoint()).toMatchObject({ unseen: 0 });
  });

  it('rejects bad arguments', async () => {
    const { ctx } = setup();
    for (const args of [
      {},
      { target: 'x' },
      { target: 'Pike', extra: 1 },
      { target: 'Pike', max_unseen_seconds: 0 },
    ]) {
      await expect(new FollowProgram().start(args, ctx)).rejects.toMatchObject({
        reason: 'invalid_args',
      });
    }
  });
});
