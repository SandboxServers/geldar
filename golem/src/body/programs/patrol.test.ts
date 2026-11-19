import { describe, expect, it } from 'vitest';
import type { ProgramCheckpoint } from '../program.ts';
import { PatrolProgram } from './patrol.ts';
import {
  contextFor,
  drive,
  expectResumeEverywhere,
  type FakeWorld,
  newWorld,
} from './programs.fakes.ts';

const TWO_POINTS = [
  { x: 10, y: 64, z: 0 },
  { x: 10, y: 64, z: 10 },
];
/** Four points with negative x and z, so every axis and sign is walked. */
const FOUR_POINTS = [
  { x: -3, y: 64, z: 2 },
  { x: 5, y: 64, z: -4 },
  { x: -6, y: 64, z: -7 },
  { x: 1, y: 64, z: 3 },
];
const SAVED = { route: TWO_POINTS, loop: true, laps: 2, leg: 0, laps_done: 0 };
const factory = () => new PatrolProgram();

function gotos(world: FakeWorld): number {
  return world.log.filter((line) => line.startsWith('goto:')).length;
}

function gotoTargets(world: FakeWorld): string[] {
  return world.log
    .filter((line) => line.startsWith('goto:'))
    .map((line) => line.slice('goto:'.length));
}

function target(p: { x: number; y: number; z: number }): string {
  return JSON.stringify(p);
}

function points(count: number) {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: 64, z: 0 }));
}

async function refused(args: Record<string, unknown>): Promise<void> {
  await expect(factory().start(args, contextFor(newWorld()))).rejects.toMatchObject({
    reason: 'invalid_args',
    program: 'patrol',
  });
}

async function resumeRefused(saved: ProgramCheckpoint): Promise<void> {
  await expect(factory().resume(saved, contextFor(newWorld()))).rejects.toMatchObject({
    reason: 'invalid_args',
    program: 'patrol',
  });
}

describe('patrol arguments', () => {
  it('refuses an empty, one-point and nine-point route', async () => {
    await refused({ route: [] });
    await refused({ route: [TWO_POINTS[0]] });
    await refused({ route: points(9) });
  });

  it('refuses a missing, non-array or malformed route', async () => {
    await refused({});
    await refused({ route: 'x' });
    await refused({ route: [TWO_POINTS[0], { x: 1.5, y: 64, z: 0 }] });
    await refused({ route: [TWO_POINTS[0], null] });
  });

  it('refuses an unknown field', async () => {
    await refused({ route: TWO_POINTS, target: 'x' });
  });

  it('accepts two and eight points', async () => {
    await expect(
      factory().start({ route: TWO_POINTS }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
    await expect(
      factory().start({ route: points(8) }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
  });

  it('bounds laps at five and refuses a bad loop flag', async () => {
    await expect(
      factory().start({ route: TWO_POINTS, loop: true, laps: 5 }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
    await refused({ route: TWO_POINTS, loop: true, laps: 6 });
    await refused({ route: TWO_POINTS, loop: true, laps: 0 });
    await refused({ route: TWO_POINTS, loop: true, laps: 1.5 });
    await refused({ route: TWO_POINTS, loop: 'yes' });
  });

  it('accepts laps with loop omitted (loop defaults to true) and with loop false', async () => {
    await expect(
      factory().start({ route: TWO_POINTS, laps: 3 }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
    await expect(
      factory().start({ route: TWO_POINTS, loop: false, laps: 3 }, contextFor(newWorld())),
    ).resolves.toBeUndefined();
  });
});

describe('patrol run', () => {
  it('stops at laps: two laps of a loop make four walks and complete', async () => {
    const world = newWorld();
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 2, stopped: 'laps' } });
    expect(gotos(world)).toBe(4);
  });

  it('loop omitted runs the laps: three laps make six walks', async () => {
    const world = newWorld();
    const done = await drive(factory, { route: TWO_POINTS, laps: 3 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 3, stopped: 'laps' } });
    expect(gotos(world)).toBe(6);
  });

  it('without loop laps does not apply: one walk, laps 1', async () => {
    const world = newWorld();
    const done = await drive(factory, { route: TWO_POINTS, loop: false, laps: 3 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 1, stopped: 'laps' } });
    expect(gotos(world)).toBe(2);
  });

  it('walks a route once without loop and completes', async () => {
    const world = newWorld();
    const done = await drive(factory, { route: TWO_POINTS, loop: false }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 1, stopped: 'laps' } });
    expect(gotos(world)).toBe(2);
  });

  it('walks the supplied points in order, wrapping on a loop', async () => {
    const world = newWorld();
    await drive(factory, { route: FOUR_POINTS, loop: true, laps: 2 }, world);
    const order = [...FOUR_POINTS, ...FOUR_POINTS].map(target);
    expect(gotoTargets(world)).toEqual(order);
  });

  it('walks the supplied points once in order without loop', async () => {
    const world = newWorld();
    await drive(factory, { route: FOUR_POINTS, loop: false }, world);
    expect(gotoTargets(world)).toEqual(FOUR_POINTS.map(target));
  });

  it('starting within 2 blocks of a point advances without a goto', async () => {
    const world = newWorld({ position: { x: 8, y: 64, z: 0 } });
    await drive(factory, { route: TWO_POINTS, loop: false }, world);
    expect(gotoTargets(world)).toEqual([target(TWO_POINTS[1] as (typeof TWO_POINTS)[1])]);
  });

  it('starting 3 blocks from a point still walks to it', async () => {
    const world = newWorld({ position: { x: 7, y: 64, z: 0 } });
    await drive(factory, { route: TWO_POINTS, loop: false }, world);
    expect(gotoTargets(world)[0]).toBe(target(TWO_POINTS[0] as (typeof TWO_POINTS)[0]));
  });

  it('resumes at every boundary with the same result and no repeated walk', async () => {
    const steps = await expectResumeEverywhere(
      factory,
      { route: TWO_POINTS, loop: true, laps: 2 },
      () => newWorld(),
    );
    expect(steps).toBeGreaterThan(1);
  });

  it('resumes a route without loop at every boundary', async () => {
    const steps = await expectResumeEverywhere(
      factory,
      { route: TWO_POINTS, loop: false, laps: 3 },
      () => newWorld(),
    );
    expect(steps).toBeGreaterThan(1);
  });

  it('refuses a bad checkpoint: unknown field, leg past the route, nine points, no route, laps_done past laps', async () => {
    await resumeRefused({ ...SAVED, extra: 1 } as ProgramCheckpoint);
    await resumeRefused({ ...SAVED, leg: 2 } as ProgramCheckpoint);
    await resumeRefused({ ...SAVED, route: points(9) } as ProgramCheckpoint);
    await resumeRefused({ leg: 0, laps_done: 0, laps: 2, loop: true } as ProgramCheckpoint);
    await resumeRefused({ ...SAVED, laps_done: 3 } as ProgramCheckpoint);
    await resumeRefused({ ...SAVED, laps: 6 } as ProgramCheckpoint);
  });

  it('a cancelled leg leaves the program running at the same point', async () => {
    const abort = new AbortController();
    abort.abort();
    const world = newWorld();
    const ctx = contextFor(world, abort.signal);
    const program = factory();
    await program.start({ route: TWO_POINTS, loop: false }, ctx);
    expect(await program.step(ctx)).toEqual({ status: 'running' });
    expect(program.checkpoint()).toMatchObject({ leg: 0, laps_done: 0 });
    expect(gotos(world)).toBe(0);
  });

  it('a hostile within 8 blocks ends with danger, even at good health', async () => {
    const world = newWorld({
      hostiles: [{ name: 'zombie', distance: 3, position: { x: 1, y: 64, z: 1 } }],
    });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 0, stopped: 'danger' } });
    expect(gotos(world)).toBe(0);
  });

  it('a hostile nearby with low health ends with danger', async () => {
    const world = newWorld({
      health: 6,
      hostiles: [{ name: 'zombie', distance: 3, position: { x: 1, y: 64, z: 1 } }],
    });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 0, stopped: 'danger' } });
    expect(gotos(world)).toBe(0);
  });

  it('low health with no hostile in sight ends with danger', async () => {
    const world = newWorld({ health: 7 });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 0, stopped: 'danger' } });
    expect(gotos(world)).toBe(0);
  });

  it('a hostile beyond 8 blocks at good health keeps walking', async () => {
    const world = newWorld({
      hostiles: [{ name: 'zombie', distance: 9, position: { x: 1, y: 64, z: 1 } }],
    });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last).toEqual({ status: 'completed', detail: { laps: 2, stopped: 'laps' } });
  });

  it('a danger after a lap reports the laps done', async () => {
    const world = newWorld();
    const ctx = contextFor(world);
    const program = factory();
    await program.start({ route: TWO_POINTS, loop: true, laps: 2 }, ctx);
    for (let i = 0; i < 20 && program.checkpoint()?.laps_done !== 1; i += 1) {
      await program.step(ctx);
    }
    expect(program.checkpoint()).toMatchObject({ laps_done: 1 });
    world.hostiles.push({ name: 'zombie', distance: 3, position: { x: 1, y: 64, z: 1 } });
    expect(await program.step(ctx)).toEqual({
      status: 'completed',
      detail: { laps: 1, stopped: 'danger' },
    });
  });

  it('never attacks, even with a hostile in reach', async () => {
    for (const [health, distance] of [
      [10, 2],
      [6, 3],
    ] as const) {
      const kinds: string[] = [];
      const world = newWorld({
        health,
        hostiles: [{ name: 'zombie', distance, position: { x: 1, y: 64, z: 1 } }],
      });
      const ctx = contextFor(world);
      const run = ctx.runAction;
      ctx.runAction = (action, signal) => {
        kinds.push(action.do);
        return run(action, signal);
      };
      const program = factory();
      await program.start({ route: TWO_POINTS, loop: true, laps: 2 }, ctx);
      expect(await program.step(ctx)).toEqual({
        status: 'completed',
        detail: { laps: 0, stopped: 'danger' },
      });
      expect(kinds).not.toContain('attack');
      expect(world.log.some((line) => line.includes('attack'))).toBe(false);
    }
  });

  it('a blocked leg fails through stopOf and does not loop', async () => {
    const world = newWorld({ failing: { goto: 'blocked' } });
    const done = await drive(factory, { route: TWO_POINTS, loop: true, laps: 2 }, world);
    expect(done.last.status).toBe('failed');
    expect(done.last).toMatchObject({ message: expect.stringMatching(/^blocked:/) });
    // One step tried the leg and stopped: the failed goto is not logged, so the step count is the proof.
    expect(done.steps).toBe(1);
    expect(world.position).toEqual({ x: 0, y: 64, z: 0 });
  });
});
